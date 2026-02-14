# Vercel Deployment Instructions

## ✅ Backend is ready on Railway
- URL: `https://ghost-production-839c.up.railway.app`
- WebSocket: `wss://ghost-production-839c.up.railway.app`

## 📦 Deploy Frontend to Vercel

### Step 1: Push to GitHub (if not already done)
```bash
cd c:/Users/Leonid/Documents/trae_projects/ghost
git add frontend/.env.production
git commit -m "Add production env for Vercel"
git push origin main
```

### Step 2: Deploy on Vercel

1. **Go to [vercel.com](https://vercel.com)**
2. **Click "Add New Project"**
3. **Import from GitHub:**
   - Select repository: `kravadk/Ghost`
   - Click "Import"

4. **Configure Project:**
   - **Framework Preset:** Vite
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build` (auto-detected)
   - **Output Directory:** `dist` (auto-detected)

5. **Environment Variables:**
   Add these in Vercel dashboard (or skip if using `.env.production`):
   ```
   VITE_BACKEND_URL=https://ghost-production-839c.up.railway.app
   VITE_WS_URL=wss://ghost-production-839c.up.railway.app
   VITE_ALEO_EXPLORER_API_BASE=https://api.explorer.provable.com/v1
   ```

6. **Click "Deploy"**

### Step 3: Update CORS on Railway

After Vercel deployment, you'll get a URL like:
```
https://ghost-messenger.vercel.app
```

**Add it to Railway:**
1. Railway Dashboard → Ghost service → Variables
2. Update `CORS_ORIGINS`:
   ```
   https://your-vercel-url.vercel.app
   ```
3. Railway will auto-redeploy

### Step 4: Test

1. Open your Vercel URL
2. Connect Aleo wallet
3. Create profile
4. Send a test message

---

## 🔧 Troubleshooting

**CORS errors:**
- Make sure exact Vercel URL (with https://) is in Railway CORS_ORIGINS
- No trailing slash in URL

**WebSocket fails:**
- Ensure Railway URL uses `wss://` not `ws://`
- Check Railway backend is running (Settings → Logs)

**Build fails on Vercel:**
- Check build logs for TypeScript errors
- Ensure `frontend/` is set as Root Directory

---

## 📝 Final Checklist

- ✅ Backend deployed on Railway
- ✅ `.env.production` created with Railway URLs
- ✅ Push to GitHub
- ⬜ Deploy on Vercel
- ⬜ Update CORS_ORIGINS on Railway
- ⬜ Test live deployment
