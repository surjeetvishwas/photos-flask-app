import express from 'express';
import session from 'express-session';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI,
  SESSION_SECRET,
  PORT = 8080
} = process.env;

// Initialize OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/photoslibrary.readonly',
  'https://www.googleapis.com/auth/photoslibrary.appendonly',
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata'
];

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true
}));

// ===== Home =====
app.get('/', (req, res) => {
  console.log('[HOME] GET /');
  res.render('index');
});

// ===== Authorize Redirect =====
app.get('/authorize', (req, res) => {
  console.log('[AUTHORIZE] GET /authorize');
  const url = oauth2Client.generateAuthUrl({
    access_type: 'online',
    scope: SCOPES,
    prompt: 'consent'
  });
  console.log('[AUTHORIZE] Redirecting to Google OAuth URL:', url);
  res.redirect(url);
});

// ===== OAuth2 Callback =====
app.get('/oauth2callback', async (req, res) => {
  console.log('[OAUTH2CALLBACK] GET /oauth2callback');
  const code = req.query.code;
  console.log('[OAUTH2CALLBACK] Received code:', code);
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('[OAUTH2CALLBACK] Tokens received:', tokens);
    req.session.tokens = tokens;
    console.log('[OAUTH2CALLBACK] Tokens stored in session');
    res.redirect('/');
  } catch (err) {
    console.error('[OAUTH2CALLBACK] Error exchanging code for tokens:', err);
    res.render('error', { message: 'OAuth Error', details: err.toString() });
  }
});

// ===== Provide Access Token to Frontend =====
app.get('/token', (req, res) => {
  console.log('[TOKEN] GET /token');
  if (!req.session.tokens) {
    console.warn('[TOKEN] No tokens in session');
    return res.status(401).json({ error: 'Not authorized' });
  }
  console.log('[TOKEN] Sending access_token to client');
  res.json({ access_token: req.session.tokens.access_token });
});

// ===== 404 Handler =====
app.use((req, res, next) => {
  console.warn('[404] Not Found:', req.originalUrl);
  res.status(404).render('error', { message: 'Not Found', details: req.originalUrl });
});

// ===== Error Handler =====
app.use((err, req, res, next) => {
  console.error('[ERROR] Uncaught error:', err);
  res.status(500).render('error', { message: 'Server Error', details: err.toString() });
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`[START] Server listening on http://localhost:${PORT}`);
});
