import express from 'express';
import session from 'express-session';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI,
  SESSION_SECRET,
  PICKER_API_KEY,
  PORT = 8080,
  NODE_ENV = 'development'
} = process.env;

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
  'https://www.googleapis.com/auth/photoslibrary.appendonly'
];

const app = express();

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: NODE_ENV === 'production',
    sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => {
  res.render('index', {
    pickerApiKey: PICKER_API_KEY,
    appDomain: new URL(REDIRECT_URI).hostname
  });
});

app.get('/authorize', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    include_granted_scopes: true
  });
  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    req.session.tokens = tokens;
    res.redirect('/');
  } catch (error) {
    console.error('OAuth Error:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/token', (req, res) => {
  const tokens = req.session.tokens;
  if (!tokens) {
    return res.status(401).json({ code: 'NO_SESSION' });
  }

  if (tokens.expiry_date < Date.now()) {
    return res.status(401).json({ code: 'TOKEN_EXPIRED' });
  }

  res.json({
    access_token: tokens.access_token,
    expires_in: Math.floor((tokens.expiry_date - Date.now()) / 1000)
  });
});

app.post('/refresh-token', async (req, res) => {
  const tokens = req.session.tokens;
  if (!tokens?.refresh_token) {
    return res.status(401).json({ error: 'No refresh token available' });
  }

  try {
    oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });
    const { credentials } = await oauth2Client.refreshAccessToken();

    req.session.tokens = {
      ...tokens,
      access_token: credentials.access_token,
      expiry_date: credentials.expiry_date
    };

    res.json({ success: true });
  } catch (error) {
    console.error('Refresh failed:', error);
    res.status(401).json({ error: 'Refresh failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
