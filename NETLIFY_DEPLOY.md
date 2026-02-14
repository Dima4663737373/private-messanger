# Netlify Deployment Instructions

## ✅ Backend is ready on Railway
- URL: `https://ghost-production-839c.up.railway.app`
- WebSocket: `wss://ghost-production-839c.up.railway.app`

## 📦 Deploy Frontend to Netlify

### Step 1: Push to GitHub
```bash
cd c:/Users/Leonid/Documents/trae_projects/ghost
git add netlify.toml frontend/.env.production
git commit -m "Configure Netlify deployment with Railway backend"
git push origin main
```

### Step 2: Deploy on Netlify

#### Option A: Netlify UI (Recommended)

1. **Go to [app.netlify.com](https://app.netlify.com)**
2. **Click "Add new site" → "Import an existing project"**
3. **Connect to GitHub:**
   - Authorize Netlify
   - Select repository: `kravadk/Ghost`

4. **Build settings:**
   - **Base directory:** (leave empty, handled by netlify.toml)
   - **Build command:** (auto from netlify.toml)
   - **Publish directory:** (auto from netlify.toml)

   Everything is pre-configured in `netlify.toml`, just click **Deploy**!

5. **Environment Variables** (already in netlify.toml, but you can override in UI):
   - Site settings → Environment variables → Add
   - Variables:
     ```
     VITE_BACKEND_URL=https://ghost-production-839c.up.railway.app
     VITE_WS_URL=wss://ghost-production-839c.up.railway.app
     VITE_ALEO_EXPLORER_API_BASE=https://api.explorer.provable.com/v1
     ```

#### Option B: Netlify CLI

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Deploy
cd c:/Users/Leonid/Documents/trae_projects/ghost
netlify deploy --prod
```

### Step 3: Update CORS on Railway

After Netlify deployment, you'll get a URL like:
```
https://ghost-messenger.netlify.app
```
or
```
https://your-site-name.netlify.app
```

**Add it to Railway:**
1. Railway Dashboard → Ghost service → Variables
2. Update `CORS_ORIGINS`:
   ```
   https://your-netlify-url.netlify.app
   ```
3. Railway will auto-redeploy

### Step 4: Test

1. Open your Netlify URL
2. Connect Aleo wallet
3. Create profile
4. Send a test message

---

## 🔧 Troubleshooting

**Build fails:**
- Check Netlify deploy logs
- Ensure Node.js version is 20+ (set in netlify.toml)
- Check for TypeScript errors

**CORS errors:**
- Make sure exact Netlify URL (with https://) is in Railway CORS_ORIGINS
- No trailing slash in URL

**WebSocket fails:**
- Ensure Railway URL uses `wss://` not `ws://`
- Check Railway backend is running

**404 on refresh:**
- Already handled by redirects in netlify.toml
- All routes redirect to index.html

---

## 📝 Configuration Files

### netlify.toml (already configured)
```toml
[build]
  base = "."
  command = "cd frontend && npm install --legacy-peer-deps && npm run build"
  publish = "frontend/dist"

[build.environment]
  NODE_VERSION = "20"
  VITE_BACKEND_URL = "https://ghost-production-839c.up.railway.app"
  VITE_WS_URL = "wss://ghost-production-839c.up.railway.app"
  VITE_ALEO_EXPLORER_API_BASE = "https://api.explorer.provable.com/v1"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## 📝 Final Checklist

- ✅ Backend deployed on Railway
- ✅ netlify.toml configured with Railway URLs
- ✅ Push to GitHub
- ⬜ Deploy on Netlify
- ⬜ Update CORS_ORIGINS on Railway with Netlify URL
- ⬜ Test live deployment

---

## 🚀 Quick Deploy

**One-liner after pushing to GitHub:**
1. Netlify → Import from GitHub → Select `kravadk/Ghost` → Deploy
2. Copy Netlify URL
3. Railway → Variables → Update CORS_ORIGINS
4. Done! 🎉
