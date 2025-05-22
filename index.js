import express from 'express';
import session from 'express-session';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
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

// Updated scopes according to new requirements
const SCOPES = [
  'https://www.googleapis.com/auth/photoslibrary.appendonly',
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata'
];

const app = express();

// Session configuration
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: NODE_ENV === 'production',
    sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Routes
app.get('/', (req, res) => {
  res.render('index', {
    pickerApiKey: PICKER_API_KEY,
    isAuthenticated: !!req.session.tokens,
    appDomain: new URL(REDIRECT_URI).hostname
  });
});

app.get('/authorize', (req, res) => {
  console.log('Authorization request received from:', req.headers.referer);
  console.log('Session ID:', req.sessionID);
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: req.headers.referer // Track origin
  });

  console.log('Generated auth URL:', authUrl);
  res.redirect(authUrl);
});
app.get('/oauth2callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    req.session.tokens = tokens;
    res.redirect('/');
  } catch (error) {
    console.error('OAuth Error:', error);
    res.status(500).render('error', {
      message: 'Authentication Failed',
      details: error.message,
      authUrl: '/authorize'
    });
  }
});

app.get('/token', (req, res) => {
  if (!req.session.tokens) {
    return res.status(401).json({
      error: 'Not authenticated',
      authUrl: '/authorize',
      code: 'NO_SESSION'
    });
  }

  if (req.session.tokens.expiry_date < Date.now()) {
    return res.status(401).json({
      error: 'Token expired',
      authUrl: '/authorize',
      code: 'TOKEN_EXPIRED'
    });
  }

  res.json({
    access_token: req.session.tokens.access_token,
    expires_in: Math.floor((req.session.tokens.expiry_date - Date.now()) / 1000)
  });
});

app.post('/refresh-token', async (req, res) => {
  if (!req.session.tokens?.refresh_token) {
    return res.status(401).json({ error: 'No refresh token available' });
  }

  try {
    oauth2Client.setCredentials({
      refresh_token: req.session.tokens.refresh_token
    });
    
    const { credentials } = await oauth2Client.refreshAccessToken();
    req.session.tokens = {
      ...req.session.tokens,
      access_token: credentials.access_token,
      expiry_date: credentials.expiry_date
    };
    
    res.json({ success: true });
  } catch (error) {
    console.error('Token refresh failed:', error);
    res.status(401).json({ error: 'Refresh failed' });
  }
});

// Error handlers
// app.use((req, res) => {
//   res.status(404).render('error', {
//     message: 'Not Found',
//     details: `The requested URL ${req.originalUrl} was not found`
//   });
// });

app.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:8080',
    'https://your-production-domain.com'
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});