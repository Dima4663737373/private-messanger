# Deployment Instructions

## Backend — Render

- **URL:** `https://ghost-backend-d3gg.onrender.com`
- **WebSocket:** `wss://ghost-backend-d3gg.onrender.com`
- **Database:** PostgreSQL (Render free tier)

### Environment Variables (Render)

```env
NODE_ENV=production
DATABASE_URL=postgres://... (Render Internal Database URL)
CORS_ORIGINS=https://ghost-aleo.netlify.app
PINATA_JWT=your_jwt_token
```

---

## Frontend — Netlify

### Auto-Deploy

Frontend auto-deploys from GitHub `main` branch. All build settings are in `netlify.toml`:

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

### Manual Deploy

```bash
git push origin main
# Netlify auto-deploys from GitHub
```

Or trigger manually: Netlify Dashboard → Deploys → Trigger deploy → Clear cache and deploy site.

---

## Smart Contract — Aleo Testnet

```bash
leo deploy --yes --broadcast \
  --network testnet \
  --private-key <YOUR_KEY> \
  --endpoint https://api.explorer.provable.com/v1
```

Current deployed: `ghost_msg_018.aleo`

---

## Troubleshooting

**Build fails:**
- Check Netlify deploy logs
- Ensure Node.js version is 20+ (set in netlify.toml)

**CORS errors:**
- Verify `CORS_ORIGINS` on Render includes the exact Netlify URL (no trailing slash)

**WebSocket fails:**
- Ensure `VITE_WS_URL` uses `wss://` (not `ws://`)
- Check Render backend is running (free tier spins down after 15 min)

**502 Bad Gateway:**
- Render free tier cold start takes ~30s after inactivity
- Check Render logs for startup errors (missing DATABASE_URL, etc.)

**404 on refresh:**
- Handled by SPA redirects in `netlify.toml`

---

## Checklist

- [x] Backend deployed on Render
- [x] PostgreSQL database created on Render
- [x] `DATABASE_URL` set in Render environment
- [x] `CORS_ORIGINS` set in Render environment
- [x] `netlify.toml` configured with Render URLs
- [x] Frontend auto-deploys from GitHub
- [x] Shield Wallet connects on production
- [x] Transactions submit successfully
