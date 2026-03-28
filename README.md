# Fusion AI Chat

A unified AI chat web app with conversation management that supports three authentication modes, controlled by a single environment variable.

## Auth Modes

| `AUTH_MODE` | Description |
|---|---|
| `apikey` | Passes a static API key header to the AI Chat API |
| `clientcredentials` | Fetches an OAuth 2.0 token using client credentials (machine-to-machine) |
| `pkce` | Full user login via OAuth 2.0 Authorization Code + PKCE. Shows a landing page, user panel, and logout button |

## Features

- Single codebase — one `server.js`, one `index.html`
- Conversation history persisted in browser `localStorage`
- Namespaced per-user storage in `pkce` mode (uses JWT `sub`)
- Model badge displayed below each AI response
- Markdown rendering for rich AI responses
- "Thinking..." indicator while waiting for API response
- Landing page with Sign In button (`pkce` mode only)
- Logout button in sidebar (`pkce` mode only)
- Runs on GitHub Codespaces

## Project Structure

```
fusion-ai-chat/
├── server.js            # Express server — auth logic for all three modes
├── public/
│   ├── index.html       # Chat UI — adapts to auth mode at runtime
│   └── landing.html     # Login landing page (pkce mode only)
├── .env                 # Your environment variables (gitignored)
├── .env.example         # Template
└── package.json
```

## Setup

```bash
git clone <your-repo-url>
cd fusion-ai-chat
npm install
cp .env.example .env
# Edit .env for your chosen AUTH_MODE
npm start
```

## Environment Variables

### Common

| Variable | Description |
|---|---|
| `AUTH_MODE` | `apikey`, `clientcredentials`, or `pkce` |
| `BASE_URL` | Base URL of the Fusion AI Conversation API |
| `PORT` | Server port (default: `3000`) |

### API Key mode (`AUTH_MODE=apikey`)

| Variable | Description |
|---|---|
| `API_KEY_NAME` | Header name, e.g. `x-api-key` |
| `API_KEY_VALUE` | Your API key value |

### Client Credentials mode (`AUTH_MODE=clientcredentials`)

| Variable | Description |
|---|---|
| `TOKEN_URL` | OAuth 2.0 token endpoint |
| `CLIENT_ID` | Client ID |
| `CLIENT_SECRET` | Client secret |

### PKCE mode (`AUTH_MODE=pkce`)

| Variable | Description |
|---|---|
| `AUTH_URL` | OAuth 2.0 authorization endpoint |
| `TOKEN_URL` | OAuth 2.0 token endpoint |
| `CLIENT_ID` | Client ID (public client, no secret) |
| `REDIRECT_URI` | Callback URL, e.g. `http://localhost:3000/callback` |
| `SCOPE` | OAuth scopes (default: `openid profile email`) |
| `SESSION_SECRET` | Secret for signing Express sessions |

## Auth Routes (pkce mode only)

| Route | Description |
|---|---|
| `GET /login` | Initiates PKCE flow |
| `GET /callback` | Handles auth server redirect |
| `GET /logout` | Destroys session, returns to landing page |

## GitHub Codespaces

Set environment variables as Codespace secrets. For `pkce` mode, update `REDIRECT_URI` to your forwarded URL:

```
REDIRECT_URI=https://<your-codespace>-3000.app.github.dev/callback
```

And register this URI with your OAuth provider.
