# Ghost Messenger — Deployment Guide

## Backend — Render

### Step 1: Create Web Service

1. Go to [render.com](https://render.com) → New → Web Service
2. Connect GitHub repo: `kravadk/Ghost`
3. Settings:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Region:** Oregon (US West)

### Step 2: Create PostgreSQL Database

1. Render Dashboard → New → PostgreSQL
2. Name: `ghost-db`, Region: Oregon, Plan: Free
3. Copy **Internal Database URL** from Connections tab

### Step 3: Environment Variables

Add to Web Service → Environment:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Internal Database URL from step 2 |
| `CORS_ORIGINS` | `https://ghost-aleo.netlify.app` |
| `PINATA_JWT` | Your Pinata JWT token |

### Step 4: Deploy

Render auto-deploys from GitHub `main` branch. Backend URL: `https://ghost-backend-d3gg.onrender.com`

---

## Frontend — Netlify

### Step 1: Connect GitHub

1. Go to [app.netlify.com](https://app.netlify.com)
2. Add new site → Import from GitHub → Select `kravadk/Ghost`
3. Build settings are auto-configured via `netlify.toml`

### Step 2: Configuration

All build settings are in `netlify.toml`:

```toml
[build]
  base = "."
  command = "cd frontend && npm install --legacy-peer-deps && npm run build"
  publish = "frontend/dist"

[build.environment]
  NODE_VERSION = "20"
  VITE_BACKEND_URL = "https://ghost-backend-d3gg.onrender.com"
  VITE_WS_URL = "wss://ghost-backend-d3gg.onrender.com"
  VITE_ALEO_EXPLORER_API_BASE = "https://api.explorer.provable.com/v1"
```

Frontend URL: `https://ghost-aleo.netlify.app`

---

## Local Development

```bash
# Terminal 1 - Backend
cd backend
npm install
npm run dev
# → http://localhost:3002

# Terminal 2 - Frontend
cd frontend
npm install --legacy-peer-deps
npm run dev
# → http://localhost:3000
```

---

## Environment Variables Summary

### Render (Backend)
| Variable | Value | Required |
|----------|-------|----------|
| `NODE_ENV` | `production` | Yes |
| `DATABASE_URL` | Render PostgreSQL Internal URL | Yes |
| `CORS_ORIGINS` | Netlify frontend URL | Yes |
| `PINATA_JWT` | Pinata JWT token | For file uploads |

### Netlify (Frontend)
| Variable | Value | Required |
|----------|-------|----------|
| `VITE_BACKEND_URL` | Render backend URL | Yes |
| `VITE_WS_URL` | Render backend URL (wss://) | Yes |
| `VITE_ALEO_EXPLORER_API_BASE` | Provable API URL | No (has default) |

---

## Troubleshooting

**WebSocket fails:**
- Ensure `VITE_WS_URL` uses `wss://` (not `ws://`)
- Check `CORS_ORIGINS` includes exact Netlify URL
- Render free tier spins down after 15 min — first request takes ~30s

**CORS errors:**
- Add exact Netlify URL (with `https://`, no trailing slash) to `CORS_ORIGINS`
- Redeploy Render after changing env vars

**502 Bad Gateway:**
- Check Render logs for startup errors
- Verify `DATABASE_URL` is set correctly

**Database:**
- Production uses PostgreSQL on Render
- Local dev uses SQLite (`./database.sqlite`)

---

## Costs

- **Render:** Free tier (750 hours/month web service + free PostgreSQL)
- **Netlify:** Free tier (unlimited for hobby projects)
- **Total:** $0/month
