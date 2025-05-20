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
app.secret_key = os.environ.get("FLASK_SECRET_KEY", os.urandom(24))
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'  # Remove in production!

# ======================
# GOOGLE API SETTINGS
# ======================
SCOPES = ['https://www.googleapis.com/auth/photoslibrary.readonly']
REDIRECT_URI = os.environ.get('REDIRECT_URI', 'http://127.0.0.1:8080/oauth2callback')
API_BASE_URL = 'https://photoslibrary.googleapis.com/v1'

# ======================
# AUTHENTICATION ROUTES
# ======================
@app.route('/')
def index():
    if 'credentials' not in session:
        return redirect(url_for('authorize'))
    return redirect(url_for('albums'))

@app.route('/authorize')
def authorize():
    try:
        client_config = {
            "web": {
                "client_id": os.environ['GOOGLE_CLIENT_ID'],
                "client_secret": os.environ['GOOGLE_CLIENT_SECRET'],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [REDIRECT_URI]
            }
        }
        flow = Flow.from_client_config(
            client_config,
            scopes=SCOPES,
            redirect_uri=REDIRECT_URI
        )
        auth_url, _ = flow.authorization_url(
            access_type='offline',
            prompt='consent',
            include_granted_scopes='true'
        )
        return redirect(auth_url)
    except Exception as e:
        return render_template('error.html',
                               message="Authorization setup failed",
                               details=str(e))

@app.route('/oauth2callback')
def oauth2callback():
    try:
        client_config = {
            "web": {
                "client_id": os.environ['GOOGLE_CLIENT_ID'],
                "client_secret": os.environ['GOOGLE_CLIENT_SECRET'],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [REDIRECT_URI]
            }
        }
        flow = Flow.from_client_config(
            client_config,
            scopes=SCOPES,
            redirect_uri=REDIRECT_URI
        )
        flow.fetch_token(authorization_response=request.url)
        creds = flow.credentials

        # Validate required scope
        required_scope = 'https://www.googleapis.com/auth/photoslibrary.readonly'
        if required_scope not in creds.scopes:
            raise ValueError(f"Missing required scope: {required_scope}")

        # Store credentials with expiration
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

    except Exception as e:
        session.clear()
        return render_template('error.html',
                               message="Authentication failed",
                               details=str(e))

# ======================
# APPLICATION ROUTES
# ======================
@app.route('/albums')
def albums():
    if 'credentials' not in session:
        return redirect(url_for('authorize'))

    try:
        creds_dict = session['credentials']
        expiry = (datetime.datetime.fromisoformat(creds_dict['expiry'])
                  if creds_dict.get('expiry') else None)

        creds = Credentials(
            token=creds_dict['token'],
            refresh_token=creds_dict.get('refresh_token'),
            token_uri=creds_dict['token_uri'],
            client_id=creds_dict['client_id'],
            client_secret=creds_dict['client_secret'],
            scopes=creds_dict['scopes'],
            expiry=expiry
        )

        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            session['credentials'].update({
                'token': creds.token,
                'expiry': creds.expiry.isoformat()
            })

        headers = {
            'Authorization': f'Bearer {creds.token}',
            'Content-Type': 'application/json'
        }
        response = requests.get(
            f'{API_BASE_URL}/albums?pageSize=50',
            headers=headers
        )
        response.raise_for_status()

        return render_template('albums.html',
                               albums=response.json().get('albums', []))

    except Exception as e:
        return render_template('error.html',
                               message="Failed to fetch albums",
                               details=str(e))

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/')

# ======================
# ERROR HANDLER
# ======================
@app.errorhandler(404)
def page_not_found(e):
    return render_template('error.html',
                           message="Page not found",
                           details=str(e)), 404

# ======================
# MAIN EXECUTION
# ======================
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
