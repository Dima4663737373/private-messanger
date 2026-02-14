# Ghost Messenger — Deployment Guide

## 🚂 Railway Deployment (Backend)

### Step 1: Deploy Backend to Railway

1. **Create Railway project:**
   ```bash
   cd backend
   # Push to GitHub first if not already
   git init
   git add .
   git commit -m "Backend ready for Railway"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Deploy on Railway:**
   - Go to [railway.app](https://railway.app)
   - New Project → Deploy from GitHub repo
   - Select `backend` folder (or root + set root directory to `backend`)
   - Railway auto-detects Node.js + runs `npm start`

3. **Add Environment Variables in Railway:**
   ```
   PORT=3002
   CORS_ORIGINS=http://localhost:3000,https://your-frontend.vercel.app
   ALEO_ENDPOINT=https://api.explorer.provable.com/v1
   ALEO_NETWORK=testnet
   ```

4. **Get your Railway URL:**
   - After deployment: `https://your-backend.up.railway.app`
   - Copy this URL for frontend config

### Step 2: Update Frontend Config

Update `frontend/.env.production`:
```env
VITE_BACKEND_URL=https://your-backend.up.railway.app
VITE_WS_URL=wss://your-backend.up.railway.app
```

### Step 3: Deploy Frontend to Vercel

1. **Push frontend to GitHub** (if not already)

2. **Deploy on Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Import your GitHub repo
   - Root Directory: `frontend`
   - Framework Preset: Vite
   - Environment Variables:
     ```
     VITE_BACKEND_URL=https://your-backend.up.railway.app
     VITE_WS_URL=wss://your-backend.up.railway.app
     ```

3. **Update CORS in Railway:**
   - Add your Vercel URL to `CORS_ORIGINS`:
   ```
   CORS_ORIGINS=https://your-frontend.vercel.app
   ```

### Step 4: Test Deployment

1. Open your Vercel URL: `https://your-frontend.vercel.app`
2. Connect Aleo wallet
3. Send a test message
4. Check Railway logs for WebSocket connections

---

## 🔧 Local Development

```bash
# Terminal 1 - Backend
cd backend
npm install
npm run dev

# Terminal 2 - Frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

---

## 📝 Environment Variables Summary

### Railway (Backend)
| Variable | Value | Required |
|----------|-------|----------|
| `PORT` | `3002` | No (auto) |
| `CORS_ORIGINS` | Your Vercel URL | Yes |
| `ALEO_ENDPOINT` | `https://api.explorer.provable.com/v1` | No |
| `ALEO_NETWORK` | `testnet` | No |

### Vercel (Frontend)
| Variable | Value | Required |
|----------|-------|----------|
| `VITE_BACKEND_URL` | Railway URL | Yes |
| `VITE_WS_URL` | Railway URL (wss://) | Yes |

---

## 🐛 Troubleshooting

**WebSocket fails:**
- Ensure Railway URL uses `wss://` (not `ws://`)
- Check CORS_ORIGINS includes your Vercel URL
- Railway free tier sleeps after 15min inactivity

**CORS errors:**
- Add exact Vercel URL (with https://) to CORS_ORIGINS
- Redeploy Railway after changing env vars

**Database issues:**
- Railway persists SQLite in `/app/database.sqlite`
- Data survives redeploys but NOT service deletion

---

## 💰 Costs

- **Railway:** Free tier = $5 credit/month (enough for hackathon)
- **Vercel:** Free tier = unlimited for hobby projects
- **Total:** $0/month for demo purposes
