# React diet planner

React + Vite frontend for the previously supplied FastAPI diet agent.
Requires Node.js 20.19+ or 22.12+.

## Setup

1. Start the Python backend in its own folder: `python diet_agent_api.py`.
2. Copy this frontend's `.env.example` to `.env`.
3. Set API_KEY to the same API_KEY in the Python backend .env.
   This is your application key, NOT OPENAI_API_KEY.
4. Set BACKEND_URL=http://127.0.0.1:8000, or your backend's HTTPS ngrok origin.
5. Run in this folder:

```bash
npm install
npm run dev
```

Open http://127.0.0.1:5173. Fill the form and click Generate my diet plan.
Restart Vite after changing .env.

The browser calls /api/v1/diet-plan. The Vite server proxy forwards it to FastAPI
and adds X-API-Key. Never prefix API_KEY with VITE_ or put OPENAI_API_KEY in the
frontend. The secret is not exposed in the browser bundle or browser storage.

## Included

Name, age, sex; city/country or GPS coordinates; optional browser device location;
food preferences, activity, goal, allergies, medical conditions and consent.
The page shows structured meals, portions, weather, hydration and assumptions.
It also handles loading, cancellation, errors and clinician-review responses.
No user data is stored in localStorage. Device location requires permission and
HTTPS or localhost; manual location entry is always available.

## Build / preview

```bash
npm run build
npm run preview
```

Preview includes the same proxy for local testing. A standalone static dist
folder does NOT contain the proxy. Production hosting needs a backend-for-frontend
or reverse proxy for /api with server-side authentication and user access controls.
Anyone who reaches this demo proxy can use its backend credentials. Share the
public URL only with your intended demo users. It does not implement per-user identity or quotas.
The Python ngrok URL exposes the API, not the React page. To call that API from
this local page, set BACKEND_URL to the public API origin.

No live model response is included by default; configure the backend OpenAI key
and billing to generate real plans. Suggestions are general wellness guidance;
verify ingredients and allergens before eating.

## Public React UI with ngrok

1. In the Python backend .env set ENABLE_NGROK=false. Keep the backend running
   locally: python diet_agent_api.py. Only the frontend needs a public tunnel.
2. In this React folder copy .env.example to .env and set:

```env
API_KEY=YOUR_BACKEND_API_KEY
BACKEND_URL=http://127.0.0.1:8000
NGROK_AUTHTOKEN=YOUR_ACTUAL_NGROK_AUTHTOKEN
```

3. Install dependencies with npm install. Stop npm run dev if it is already running.
4. Run npm run public. It starts Vite on 5173 and opens an ngrok HTTPS tunnel.
5. Open/share the Public React UI URL printed in the terminal.

Flow: visitor → ngrok → React/Vite → private API proxy → FastAPI → LLM.
The launcher automatically allows the exact assigned ngrok hostname. It does
not set allowedHosts=true. Hot reload is disabled for the public session;
refresh your browser after code edits, or use npm run dev for development.
Ctrl+C stops the UI and closes its tunnel; the backend remains a separate process.
Secrets stay server-side. No separate ngrok CLI install is needed. Your ngrok
account limits apply, and the URL may change between sessions. This is a public
demo using a development server, not a production deployment.

Troubleshooting: unauthorized means frontend/backend API_KEY values differ;
502/connection refused usually means the Python backend is not running or
BACKEND_URL is wrong. An ngrok error requires checking the token/account and
network access. Real plans require OPENAI_API_KEY in the backend .env.

## Render production deployment

Upload these files into frontend/ in GitHub; exclude .env, node_modules and dist.
Create a Render Web Service (Node), NOT a Static Site.
Root directory: frontend (or the folder containing package.json).
Build command: npm ci --include=dev && npm run build
Start command: npm start
Health check: /health
Environment: BACKEND_URL=https://diet-planner-api-6aod.onrender.com
and API_KEY matching the backend application key. Optionally NODE_VERSION=22.16.0.
Render assigns PORT; this server binds 0.0.0.0. It serves only dist and forwards
POST /api/v1/diet-plan with server-side X-API-Key. No CORS change is required.
Do not set OPENAI_API_KEY, GEMINI_API_KEY or NGROK_AUTHTOKEN in the frontend.
Local production check: build, set API_KEY in terminal, then npm start.
The server reads runtime environment variables; .env is used only by local Vite.
All public visitors can generate plans. This demo has no per-user login or quotas.
