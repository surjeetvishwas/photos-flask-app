import os
import datetime
import requests
from flask import Flask, redirect, request, session, url_for, render_template
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

# ======================
# FLASK CONFIGURATION
# ======================
app = Flask(__name__)
app.secret_key = os.urandom(24)
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'  # LOCAL DEV ONLY!

# ======================
# GOOGLE API SETTINGS
# ======================
SCOPES = ['https://www.googleapis.com/auth/photoslibrary']  # Full read/write
CLIENT_SECRETS_FILE = "credentials.json"
REDIRECT_URI = 'http://127.0.0.1:5000/oauth2callback'
API_BASE_URL = 'https://photoslibrary.googleapis.com/v1'

# ======================
# CORE HELPERS
# ======================
def validate_credentials(creds):
    if not creds or not creds.valid:
        return False
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    required = set(SCOPES)
    granted = set(creds.scopes or [])
    if not required.issubset(granted):
        missing = required - granted
        raise ValueError(f"Missing scopes: {', '.join(missing)}")
    return True

def get_credentials_from_session():
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
def index():
    return redirect(url_for('albums')) if 'credentials' in session else redirect(url_for('authorize'))

@app.route('/authorize')
def authorize():
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI
    )
    auth_url, _ = flow.authorization_url(
        access_type='offline',
        prompt='consent',            # force Google to show consent screen
        include_granted_scopes=False # do NOT reuse old scopes
    )
    return redirect(auth_url)

@app.route('/oauth2callback')
def oauth2callback():
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE,
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
                               message="Scope Validation Failed",
                               details=str(e)), 400

    # Save validated credentials into session
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
    creds = get_credentials_from_session()
    if not creds or not validate_credentials(creds):
        return redirect(url_for('authorize'))

    # Fetch albums
    headers = {'Authorization': f'Bearer {creds.token}'}
    resp = requests.get(
        f'{API_BASE_URL}/albums',
        headers=headers,
        params={'pageSize': 50}
    )
    if resp.status_code != 200:
        error = resp.json().get('error', {}).get('message', resp.text)
        return render_template('error.html',
                               message="Google Photos API Error",
                               details=f"{error} (HTTP {resp.status_code})"), resp.status_code

    albums = resp.json().get('albums', [])
    return render_template('albums.html', albums=albums)

@app.route('/force-reauth')
def force_reauth():
    session.clear()
    return redirect(url_for('authorize'))

# ======================
# DEBUG ROUTES
# ======================
@app.route('/debug/scopes')
def debug_scopes():
    creds = get_credentials_from_session()
    if not creds:
        return "<p>No credentials in session.</p>"
    return (
        f"<p><strong>Required SCOPES:</strong> {SCOPES}</p>"
        f"<p><strong>Granted SCOPES:</strong> {creds.scopes}</p>"
    )

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/')

# ======================
# ERROR HANDLER
# ======================
@app.errorhandler(404)
def not_found(e):
    return render_template('error.html',
                           message="Page not found",
                           details=str(e)), 404

# ======================
# MAIN EXECUTION
# ======================
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
