import os
import datetime
import requests
from flask import Flask, redirect, request, session, url_for, render_template
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ======================
# FLASK CONFIGURATION
# ======================
app = Flask(__name__)
app.secret_key = os.urandom(24)
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'  # LOCAL DEV ONLY!

# ======================
# GOOGLE API SETTINGS
# ======================
SCOPES = [
    'https://www.googleapis.com/auth/photoslibrary',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/spreadsheets'
]
CLIENT_SECRETS_FILE = "credentials.json"
REDIRECT_URI = 'http://127.0.0.1:5000/oauth2callback'
PHOTOS_BASE = 'https://photoslibrary.googleapis.com/v1'

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

@app.route('/policy')
def policy():
    return render_template('policy.html')

@app.route('/authorize')
def authorize():
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE, scopes=SCOPES, redirect_uri=REDIRECT_URI
    )
    auth_url, _ = flow.authorization_url(
        access_type='offline', prompt='consent', include_granted_scopes=False
    )
    return redirect(auth_url)

@app.route('/oauth2callback')
def oauth2callback():
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE, scopes=SCOPES, redirect_uri=REDIRECT_URI
    )
    flow.fetch_token(authorization_response=request.url)
    creds = flow.credentials

    try:
        validate_credentials(creds)
    except Exception as e:
        session.clear()
        return render_template('error.html',
                               message="Scope Validation Failed",
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
    return redirect(url_for('albums'))

@app.route('/albums')
def albums():
    creds = get_creds()
    if not creds or not validate_credentials(creds):
        return redirect(url_for('authorize'))

    resp = requests.get(
        f'{PHOTOS_BASE}/albums?pageSize=50',
        headers={'Authorization': f'Bearer {creds.token}'}
    )
    if resp.status_code != 200:
        return render_template('error.html',
                               message="Google Photos API Error",
                               details=resp.text), resp.status_code

    return render_template('albums.html', albums=resp.json().get('albums', []))

@app.route('/photo/<photo_id>')
def photo_metadata(photo_id):
    creds = get_creds()
    if not creds or not validate_credentials(creds):
        return redirect(url_for('authorize'))

    resp = requests.get(
        f'{PHOTOS_BASE}/mediaItems/{photo_id}',
        headers={'Authorization': f'Bearer {creds.token}'}
    )
    if resp.status_code != 200:
        return render_template('error.html',
                               message="Photo Metadata Error",
                               details=resp.text), resp.status_code

    return render_template('photo_metadata.html', photo=resp.json())

@app.route('/albums/export-docs')
def export_album_info_to_docs():
    creds = get_creds()
    validate_credentials(creds)

    # Fetch albums
    resp = requests.get(
        f'{PHOTOS_BASE}/albums?pageSize=50',
        headers={'Authorization': f'Bearer {creds.token}'}
    )
    albums = resp.json().get('albums', [])

    # Create Docs
    docs = build('docs', 'v1', credentials=creds)
    doc = docs.documents().create(body={"title": "Google Photos Albums"}).execute()

    # Batch insert album info
    requests_body = []
    idx = 1
    for a in albums:
        text = f"{a['title']} ({a.get('mediaItemsCount',0)} items)\n"
        requests_body.append({"insertText": {"location": {"index": idx}, "text": text}})
        idx += len(text)
    docs.documents().batchUpdate(
        documentId=doc['documentId'],
        body={"requests": requests_body}
    ).execute()

    return redirect(f"https://docs.google.com/document/d/{doc['documentId']}")

@app.route('/albums/export-sheets')
def export_album_info_to_sheets():
    creds = get_creds()
    validate_credentials(creds)

    resp = requests.get(
        f'{PHOTOS_BASE}/albums?pageSize=50',
        headers={'Authorization': f'Bearer {creds.token}'}
    )
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

@app.route('/force-reauth')
def force_reauth():
    session.clear()
    return redirect(url_for('authorize'))

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
    app.run(host='0.0.0.0', port=5000, debug=True)
