require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.set('trust proxy', 1);

const {
  AUTH_MODE = 'clientcredentials',
  BASE_URL,
  // API Key
  API_KEY_NAME,
  API_KEY_VALUE,
  // Client Credentials
  TOKEN_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  // PKCE
  AUTH_URL,
  REDIRECT_URI,
  SCOPE = 'openid profile email',
  SESSION_SECRET = 'dev-secret',
  PORT = 3000,
} = process.env;

const validModes = ['apikey', 'clientcredentials', 'pkce'];
if (!validModes.includes(AUTH_MODE)) {
  console.error(`❌ Invalid AUTH_MODE: "${AUTH_MODE}". Must be one of: ${validModes.join(', ')}`);
  process.exit(1);
}

console.log(`🔐 Auth mode: ${AUTH_MODE}`);

// ── SESSION (only needed for pkce) ────────────────────────────────────────────
if (AUTH_MODE === 'pkce') {
  const session = require('express-session');
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: 'auto',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    },
  }));
}

// ── CLIENT CREDENTIALS TOKEN CACHE ───────────────────────────────────────────
let cachedToken = null;
let tokenExpiresAt = null;

async function getClientCredentialsToken() {
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);

  const response = await axios.post(TOKEN_URL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  cachedToken = response.data.access_token;
  const expiresIn = response.data.expires_in || 3600;
  tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
  return cachedToken;
}

// ── PKCE HELPERS ──────────────────────────────────────────────────────────────
function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// ── AUTH MIDDLEWARE (pkce only) ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (AUTH_MODE !== 'pkce') return next();
  if (req.session.accessToken) return next();
  // Don't save static asset paths as returnTo — always go back to root after login
  const isAsset = /\.(ico|png|jpg|jpeg|gif|svg|css|js|woff|woff2)$/i.test(req.path);
  req.session.returnTo = isAsset ? '/' : req.originalUrl;
  res.redirect('/login');
}

// ── PKCE ROUTES ───────────────────────────────────────────────────────────────
if (AUTH_MODE === 'pkce') {

  app.get('/login', (req, res) => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    req.session.codeVerifier = codeVerifier;
    req.session.oauthState = state;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'login',
    });

    res.redirect(`${AUTH_URL}?${params.toString()}`);
  });

  app.get('/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.redirect(`/?auth_error=${encodeURIComponent(error_description || error)}`);
    }
    if (!state || state !== req.session.oauthState) {
      return res.redirect('/?auth_error=Invalid+state+parameter');
    }
    const codeVerifier = req.session.codeVerifier;
    if (!codeVerifier) {
      return res.redirect('/?auth_error=Missing+code+verifier');
    }

    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code,
        code_verifier: codeVerifier,
      });

      const tokenRes = await axios.post(TOKEN_URL, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const { access_token, expires_in, id_token } = tokenRes.data;
      req.session.accessToken = access_token;
      req.session.idToken = id_token || null;
      req.session.tokenExpiresAt = Date.now() + (expires_in || 3600) * 1000;

      if (id_token) {
        try {
          const payload = JSON.parse(
            Buffer.from(id_token.split('.')[1], 'base64url').toString()
          );
          req.session.user = {
            name: payload.name || payload.preferred_username || payload.email || 'User',
            email: payload.email || '',
            sub: payload.sub || '',
          };
        } catch (_) {}
      }

      delete req.session.codeVerifier;
      delete req.session.oauthState;
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      res.redirect(returnTo);

    } catch (err) {
      console.error('Token exchange error:', err?.response?.data || err.message);
      res.redirect('/?auth_error=Token+exchange+failed');
    }
  });

  app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });
}

// ── /api/me ───────────────────────────────────────────────────────────────────
app.get('/api/me', (req, res) => {
  if (AUTH_MODE === 'pkce') {
    if (!req.session.accessToken) return res.json({ authenticated: false });
    return res.json({
      authenticated: true,
      user: req.session.user || { name: 'User', email: '', sub: 'unknown' },
      expiresAt: req.session.tokenExpiresAt,
      authMode: AUTH_MODE,
    });
  }
  // apikey and clientcredentials — always "authenticated" server-side
  res.json({ authenticated: true, authMode: AUTH_MODE });
});

// ── /api/auth-config — tells frontend which mode is active ───────────────────
app.get('/api/auth-config', (req, res) => {
  res.json({ authMode: AUTH_MODE });
});

// ── CHAT PROXY ────────────────────────────────────────────────────────────────
app.post('/api/chat', requireAuth, async (req, res) => {
  const { prompt, conversationId } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Token expiry check for pkce
  if (AUTH_MODE === 'pkce') {
    if (req.session.tokenExpiresAt && Date.now() > req.session.tokenExpiresAt) {
      return res.status(401).json({ error: 'Session expired. Please log in again.', reauth: true });
    }
  }

  try {
    // Build auth header based on mode
    let authHeader;
    if (AUTH_MODE === 'apikey') {
      authHeader = null; // handled separately below
    } else if (AUTH_MODE === 'clientcredentials') {
      const token = await getClientCredentialsToken();
      authHeader = `Bearer ${token}`;
    } else if (AUTH_MODE === 'pkce') {
      authHeader = `Bearer ${req.session.accessToken}`;
    }

    const body = { prompt };
    if (conversationId) body.conversationId = conversationId;

    const headers = { 'Content-Type': 'application/json' };
    if (AUTH_MODE === 'apikey') {
      headers[API_KEY_NAME] = API_KEY_VALUE;
    } else {
      headers['Authorization'] = authHeader;
    }

    const response = await axios.post(
      `${BASE_URL}/chatconversation/v1/prompt`,
      body,
      { headers }
    );

    res.json(response.data);

  } catch (err) {
    const status = err?.response?.status || 500;
    const message =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.response?.statusText ||
      err.message ||
      'Failed to get response from AI API';
    console.error('Chat API error:', status, message);
    if (AUTH_MODE === 'pkce' && status === 401) {
      return res.status(401).json({ error: 'Authentication failed. Please log in again.', reauth: true });
    }
    res.status(status).json({ error: message });
  }
});

// Ignore favicon requests gracefully
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ── STATIC FILES ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (AUTH_MODE === 'pkce') {
    if (req.session.accessToken) {
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    return res.sendFile(path.join(__dirname, 'public', 'landing.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res, next) => {
  if (AUTH_MODE === 'pkce' && req.path === '/landing.html') return next();
  requireAuth(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`✅ Fusion AI Chat running on http://localhost:${PORT} [AUTH_MODE=${AUTH_MODE}]`);
});
