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

// Updated scopes according to new requirements
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
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Routes
app.get('/', (req, res) => {
  res.render('index', { 
    pickerApiKey: PICKER_API_KEY,
    isAuthenticated: !!req.session.tokens
  });
});

app.get('/authorize', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    req.session.tokens = tokens;
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

  const tokens = req.session.tokens;
  oauth2Client.setCredentials(tokens);

  // If expired, refresh token
  if (tokens.expiry_date < Date.now()) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      req.session.tokens = credentials;
      oauth2Client.setCredentials(credentials);
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
    access_token: oauth2Client.credentials.access_token,
    expires_in: Math.floor((oauth2Client.credentials.expiry_date - Date.now()) / 1000)
  });
});

// Error handlers
app.use((req, res) => {
  res.status(404).render('error', { 
    message: 'Not Found',
    details: `The requested URL ${req.originalUrl} was not found`
  });
});

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