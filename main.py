import os
import datetime
import requests
import time
from flask import Flask, redirect, request, session, url_for, render_template
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from werkzeug.middleware.proxy_fix import ProxyFix

# ======================
# FLASK CONFIGURATION
# ======================
app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", os.urandom(24))
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# ======================
# GOOGLE API SETTINGS
# ======================
SCOPES = [
    'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
    'https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata',
    'https://www.googleapis.com/auth/photoslibrary.appendonly',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets'
]
REDIRECT_URI = 'https://your-cloud-run-url/oauth2callback'
PHOTOS_BASE = 'https://photoslibrary.googleapis.com/v1'
PICKER_BASE = 'https://photospicker.googleapis.com/v1'

# Build the client config dynamically from env vars
CLIENT_CONFIG = {
    "web": {
        "client_id": os.environ['GOOGLE_CLIENT_ID'],
        "client_secret": os.environ['GOOGLE_CLIENT_SECRET'],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [REDIRECT_URI]
    }
}

# ======================
# HELPERS
# ======================
def validate_credentials(creds):
    if not creds or not creds.valid:
        return False
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    if not set(SCOPES).issubset(set(creds.scopes or [])):
        raise ValueError("Missing required scopes")
    return True

def get_creds():
    data = session.get('credentials')
    if not data:
        return None
    expiry = datetime.datetime.fromisoformat(data['expiry']) if data.get('expiry') else None
    return Credentials(
        token=data['token'],
        refresh_token=data.get('refresh_token'),
        token_uri=data['token_uri'],
        client_id=data['client_id'],
        client_secret=data['client_secret'],
        scopes=data['scopes'],
        expiry=expiry
    )

# ======================
# ROUTES
# ======================
@app.route('/')
def home():
    return render_template('home.html')

@app.route('/authorize')
def authorize():
    flow = Flow.from_client_config(
        CLIENT_CONFIG,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI
    )
    auth_url, _ = flow.authorization_url(
        access_type='offline',
        prompt='consent',
        include_granted_scopes=False
    )
    return redirect(auth_url)

@app.route('/oauth2callback')
def oauth2callback():
    flow = Flow.from_client_config(
        CLIENT_CONFIG,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI
    )
    flow.fetch_token(authorization_response=request.url)
    creds = flow.credentials

    try:
        validate_credentials(creds)
    except Exception as e:
        session.clear()
        return render_template('error.html',
                               message="Scope validation failed",
                               details=str(e)), 400

    session['credentials'] = {
        'token': creds.token,
        'refresh_token': creds.refresh_token,
        'token_uri': creds.token_uri,
        'client_id': creds.client_id,
        'client_secret': creds.client_secret,
        'scopes': creds.scopes,
        'expiry': creds.expiry.isoformat() if creds.expiry else None
    }
    return redirect(url_for('start_picker_session'))

@app.route('/start-picker-session')
def start_picker_session():
    creds = get_creds()
    if not creds or not validate_credentials(creds):
        return redirect(url_for('authorize'))

    # Create a new Picker API session
    session_payload = {
        "supportSharing": False
    }
    resp = requests.post(
        f'{PICKER_BASE}/sessions',
        headers={
            'Authorization': f'Bearer {creds.token}',
            'Content-Type': 'application/json'
        },
        json=session_payload
    )
    if resp.status_code != 200:
        return render_template('error.html',
                               message="Failed to create Picker session",
                               details=resp.text), resp.status_code

    picker_session = resp.json()
    session['picker_session_id'] = picker_session['sessionId']
    session['picker_uri'] = picker_session['pickerUri']
    return redirect(picker_session['pickerUri'])

@app.route('/poll-picker-session')
def poll_picker_session():
    creds = get_creds()
    if not creds or not validate_credentials(creds):
        return redirect(url_for('authorize'))

    session_id = session.get('picker_session_id')
    if not session_id:
        return render_template('error.html',
                               message="No Picker session found",
                               details="Please start a new Picker session."), 400

    # Poll the session until mediaItemsSet is True
    for _ in range(10):  # Poll up to 10 times
        resp = requests.get(
            f'{PICKER_BASE}/sessions/{session_id}',
            headers={'Authorization': f'Bearer {creds.token}'}
        )
        if resp.status_code != 200:
            return render_template('error.html',
                                   message="Failed to poll Picker session",
                                   details=resp.text), resp.status_code

        session_info = resp.json()
        if session_info.get('mediaItemsSet'):
            break
        time.sleep(2)  # Wait before polling again
    else:
        return render_template('error.html',
                               message="Timeout polling Picker session",
                               details="User did not select media items in time."), 408

    # Retrieve selected media items
    resp = requests.get(
        f'{PICKER_BASE}/mediaItems?sessionId={session_id}',
        headers={'Authorization': f'Bearer {creds.token}'}
    )
    if resp.status_code != 200:
        return render_template('error.html',
                               message="Failed to retrieve media items",
                               details=resp.text), resp.status_code

    media_items = resp.json().get('mediaItems', [])
    return render_template('media_items.html', media_items=media_items)

@app.route('/albums/export-docs')
def export_album_info_to_docs():
    creds = get_creds()
    if not creds or not validate_credentials(creds):
        return redirect(url_for('authorize'))

    # Fetch albums created by the app
    resp = requests.get(
        f'{PHOTOS_BASE}/albums?pageSize=50',
        headers={'Authorization': f'Bearer {creds.token}'}
    )
    if resp.status_code != 200:
        return render_template('error.html',
                               message="Failed to fetch albums",
                               details=resp.text), resp.status_code

    albums = resp.json().get('albums', [])

    docs = build('docs', 'v1', credentials=creds)
    doc = docs.documents().create(body={"title": "Google Photos Albums"}).execute()

    # Batch insert
    reqs, idx = [], 1
    for a in albums:
        text = f"{a['title']} ({a.get('mediaItemsCount',0)} items)\n"
        reqs.append({"insertText": {"location": {"index": idx}, "text": text}})
        idx += len(text)
    docs.documents().batchUpdate(documentId=doc['documentId'], body={"requests": reqs}).execute()

    return redirect(f"https://docs.google.com/document/d/{doc['documentId']}")

@app.route('/albums/export-sheets')
def export_album_info_to_sheets():
    creds = get_creds()
    if not creds or not validate_credentials(creds):
        return redirect(url_for('authorize'))

    # Fetch albums created by the app
    resp = requests.get(
        f'{PHOTOS_BASE}/albums?pageSize=50',
        headers={'Authorization': f'Bearer {creds.token}'}
    )
    if resp.status_code != 200:
        return render_template('error.html',
                               message="Failed to fetch albums",
                               details=resp.text), resp.status_code

    albums = resp.json().get('albums', [])

    sheets = build('sheets', 'v4', credentials=creds)
    sheet = sheets.spreadsheets().create(body={
        "properties": {"title": "Google Photos Album Export"}
    }).execute()

    values = [["Title", "ID", "URL"]]
    for a in albums:
        values.append([a['title'], a['id'], a.get('productUrl','')])

    sheets.spreadsheets().values().update(
        spreadsheetId=sheet['spreadsheetId'],
        range="Sheet1!A1",
        valueInputOption="RAW",
        body={"values": values}
    ).execute()

    return redirect(f"https://docs.google.com/spreadsheets/d/{sheet['spreadsheetId']}")

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

@app.errorhandler(404)
def not_found(e):
    return render_template('error.html',
                           message="Page not found",
                           details=str(e)), 404

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
