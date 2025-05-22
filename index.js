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
  PORT = 8080
} = process.env;

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/photoslibrary.appendonly',
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
  'https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata'
];

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

app.get('/', (req, res) => {
  res.render('index', { 
    pickerApiKey: PICKER_API_KEY,
    isAuthenticated: !!req.session.tokens
  });
});

app.get('/authorize', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // request refresh token
    scope: SCOPES,
    prompt: 'consent' // always ask consent to get refresh token
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    req.session.tokens = tokens;
    console.log('Tokens acquired:', tokens);
    res.redirect('/');
  } catch (err) {
    console.error('OAuth Error:', err);
    res.status(500).render('error', { 
      message: 'Authentication Failed',
      details: err.message
    });
  }
});

app.get('/token', async (req, res) => {
  if (!req.session.tokens) {
    console.warn('Token request without valid session');
    return res.status(401).json({
      error: 'Not authenticated',
      authUrl: '/authorize',
      code: 'NO_SESSION'
    });
  }

  let tokens = req.session.tokens;
  oauth2Client.setCredentials(tokens);

  const now = Date.now();

  // If expiry_date missing or token expired (with a small buffer)
  if (!tokens.expiry_date || tokens.expiry_date - 60000 < now) {
    if (!tokens.refresh_token) {
      console.warn('No refresh token available, re-authentication required');
      return res.status(401).json({
        error: 'Refresh token missing, please re-authenticate',
        authUrl: '/authorize',
        code: 'NO_REFRESH_TOKEN'
      });
    }

    try {
      // Refresh access token using refresh_token
      const newTokens = await oauth2Client.refreshToken(tokens.refresh_token);
      tokens = {
        ...tokens,
        access_token: newTokens.credentials.access_token,
        expiry_date: newTokens.credentials.expiry_date,
      };
      req.session.tokens = tokens;
      oauth2Client.setCredentials(tokens);
      console.log('Access token refreshed');
    } catch (err) {
      console.error('Token refresh failed', err);
      return res.status(401).json({
        error: 'Token refresh failed',
        authUrl: '/authorize',
        code: 'TOKEN_REFRESH_FAILED'
      });
    }
  }

  res.json({
    access_token: tokens.access_token,
    expires_in: Math.floor((tokens.expiry_date - now) / 1000)
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { 
    message: 'Not Found',
    details: `The requested URL ${req.originalUrl} was not found`
  });
});

// Generic error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).render('error', {
    message: 'Server Error',
    details: process.env.NODE_ENV === 'development' ? err.stack : 'Something went wrong'
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
