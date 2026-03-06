# Проста Інструкція: Як Зробити Щоб Повідомлення Працювали

## 🎯 Що Треба

**Просто:** Користувач A відправляє → Користувач B отримує

**Що вже є:**
- ✅ Backend server (Railway) - БЕЗКОШТОВНИЙ
- ✅ WebSocket для real-time
- ✅ Шифрування E2E (NaCl)
- ✅ IndexedDB для збереження

---

## 🔧 Як Перевірити Що Працює

### Крок 1: Перевірити Backend

Відкрий у браузері: {20C9F2B8-94DB-4653-87CF-6B16540E9AAE}.png

**Має бути:**
```json
{ "status": "ok" }
```

Якщо **404** або **немає відповіді** → backend не працює ❌

---

### Крок 2: Відкрити Console в Браузері

**Chrome/Edge:**
- F12 → Console tab

**Шукай помилки:**
```
❌ WebSocket connection failed
❌ AUTH_CHALLENGE decryption failed
❌ 401 Unauthorized
❌ Failed to fetch
```

---

### Крок 3: Перевірити WebSocket З'єднання

У Console має бути:
```
✅ [WS] Connected
✅ [WS] Authenticated successfully
```

Якщо НЕ підключається:
```javascript
// Відкрий Console і запусти:
console.log('Backend URL:', import.meta.env.VITE_BACKEND_URL);
console.log('WS URL:', import.meta.env.VITE_WS_URL);
```

---

## 🐛 Типові Проблеми та Рішення

### Проблема 1: "Backend не відповідає"

**Симптоми:**
- Сайт відкривається, але повідомлення не йдуть
- Console: `Failed to fetch` або `Network Error`

**Рішення:**

```bash
# Перевірити чи працює Railway backend
curl https://ghost-production-839c.up.railway.app/health

# Якщо не працює → запустити локально
cd backend
npm install
npm run dev
```

**Потім у frontend/.env.local:**
```
VITE_BACKEND_URL=http://localhost:3002
VITE_WS_URL=ws://localhost:3002
```

---

### Проблема 2: "WebSocket не підключається"

**Симптоми:**
- Console: `WebSocket connection to 'wss://...' failed`
- Червона точка біля імені користувача (offline)

**Рішення 1: Перевірити Railway deployment**

Лог на Railway → перевірити чи backend запущений

**Рішення 2: Локальний backend**

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev
```

---

### Проблема 3: "AUTH_CHALLENGE decryption failed"

**Симптоми:**
- Console: `AUTH_CHALLENGE decryption failed (keys may have changed)`
- Після цього `401 Unauthorized` на всіх запитах

**Рішення:**

Ця проблема **вже виправлена** в коміті `7b00e2e` (детерміністичні ключі).

Якщо все ще є проблема:

1. **Очистити sessionStorage:**
```javascript
// У Console:
sessionStorage.clear();
location.reload();
```

2. **Перевірити що використовується остання версія:**
```bash
git pull origin main
cd frontend
npm install
npm run build
```

---

### Проблема 4: "Повідомлення відправляються, але не доходять"

**Симптоми:**
- Користувач A бачить своє повідомлення
- Користувач B НЕ бачить повідомлення

**Діагностика:**

**У Користувача A (Console):**
```
✅ [WS] dm_send sent
✅ [WS] dm_sent received (confirmation)
```

**У Користувача B (Console):**
```
❌ Нічого не з'являється
або
❌ message_detected - але не розшифровується
```

**Рішення:**

```bash
# Перевірити backend logs (Railway)
# Шукати:
[DM] aleo1xxx→aleo1yyy id=xxx delivered=[???] clients=2
```

Якщо `delivered=[]` → **отримувач не підключений до WebSocket**

Якщо `clients=0` → **ніхто не підключений**

---

### Проблема 5: "Encrypted Message / Decryption Failed"

**Симптоми:**
- Повідомлення приходить, але показує `[Encrypted]` або `Decryption Failed`

**Причина:**

Різні encryption keys на двох пристроях (це було виправлено в `7b00e2e`).

**Рішення:**

1. **Обидва користувачі:** Очистити sessionStorage і перезайти
```javascript
sessionStorage.clear();
location.reload();
```

2. **Переконатись що використовується остання версія коду** (детерміністичні ключі)

3. **Якщо все ще не працює:** Видалити профіль і створити заново
```javascript
// Backend API
DELETE /profiles/{address}
```

---

## ✅ Простий Тест: Чи Працює?

### Тест 1: Два Браузери на Одному Комп'ютері

1. **Chrome:** Відкрити `http://localhost:5173` → Підключити Wallet A
2. **Edge/Firefox:** Відкрити `http://localhost:5173` → Підключити Wallet B

3. **Chrome (User A):** Додати контакт User B (адреса з Edge)
4. **Chrome (User A):** Відправити "Test 123"

5. **Edge (User B):** Має з'явитись "Test 123" ✅

---

### Тест 2: Два Різні Комп'ютери

**Комп 1 (User A):**
1. Відкрити https://твій-сайт.vercel.app
2. Підключити Shield Wallet
3. Додати контакт (адреса User B)
4. Відправити повідомлення

**Комп 2 (User B):**
1. Відкрити https://твій-сайт.vercel.app
2. Підключити Shield Wallet
3. **Має автоматично з'явитись чат з User A** ✅
4. Має побачити повідомлення ✅

---

## 🚀 Якщо Backend Не Працює

### Безкоштовні Варіанти Hosting:

#### 1. Railway (Поточний) - $0-5/міс

**Pros:**
- ✅ 500 годин безкоштовно/міс
- ✅ WebSocket підтримка
- ✅ Auto-deploy з GitHub

**Cons:**
- ⚠️ Може засинати якщо немає трафіку
- ⚠️ Ліміт 500 годин = ~20 днів

**Deployment:**
```bash
# Railway CLI
railway login
railway link
railway up
```

---

#### 2. Render.com - Безкоштовно

**Pros:**
- ✅ Повністю безкоштовний tier
- ✅ WebSocket підтримка
- ✅ Auto SSL (HTTPS/WSS)

**Cons:**
- ⚠️ Засинає після 15 хв бездіяльності
- ⚠️ Cold start 30-60 секунд

**Deployment:**
```bash
# render.yaml
services:
  - type: web
    name: ghost-backend
    env: node
    buildCommand: cd backend && npm install
    startCommand: cd backend && npm start
    envVars:
      - key: NODE_ENV
        value: production
```

---

#### 3. Fly.io - $0-5/міс

**Pros:**
- ✅ Безкоштовні 3 VMs
- ✅ Не засинає
- ✅ WebSocket підтримка

**Cons:**
- ⚠️ Складніша конфігурація

**Deployment:**
```bash
flyctl launch
flyctl deploy
```

---

#### 4. Netlify Functions + Supabase Realtime

**Pros:**
- ✅ Повністю безкоштовно
- ✅ Не засинає
- ✅ Real-time підтримка

**Cons:**
- ❌ Потребує рефакторинг (WebSocket → Supabase Realtime)

---

## 💡 Найпростіше Рішення (Якщо Нічого Не Працює)

### Локальний Backend (Для Тестів)

```bash
# 1. Запустити backend локально
cd backend
npm install
npm run dev
# Backend: http://localhost:3002

# 2. Frontend .env.local
echo "VITE_BACKEND_URL=http://localhost:3002" > frontend/.env.local
echo "VITE_WS_URL=ws://localhost:3002" >> frontend/.env.local

# 3. Запустити frontend
cd frontend
npm run dev
# Frontend: http://localhost:5173

# 4. Відкрити в двох браузерах
# Chrome: http://localhost:5173 (User A)
# Edge: http://localhost:5173 (User B)

# 5. Відправити повідомлення
```

**Має працювати 100%** ✅

---

### ngrok для Тестів з Іншого Комп'ютера

```bash
# 1. Встановити ngrok
# https://ngrok.com/download

# 2. Запустити backend локально
cd backend
npm run dev

# 3. Тунель через ngrok
ngrok http 3002
# Отримаєш URL: https://abc123.ngrok.io

# 4. Frontend .env.local
VITE_BACKEND_URL=https://abc123.ngrok.io
VITE_WS_URL=wss://abc123.ngrok.io

# 5. Тепер з іншого комп'ютера можна підключитись
```

**Безкоштовно для тестів** ✅

---

## 📋 Checklist: Що Має Працювати

Відкрий Console (F12) і перевір:

```
✅ [WS] Connected
✅ [WS] Authenticated successfully
✅ [MessageStorage] Initialized IndexedDB
✅ [MessageStorage] Loaded X contacts from IndexedDB
✅ [loadDialogs] Received X dialogs
```

Якщо всі ✅ → **повідомлення мають працювати**

Якщо є ❌ → дивись секцію "Типові Проблеми" вище

---

## 🎯 Summary

### Що вже працює:
- ✅ Backend на Railway (безкоштовно)
- ✅ WebSocket real-time messaging
- ✅ E2E шифрування
- ✅ IndexedDB persistence
- ✅ Детерміністичні ключі (виправлено)

### Що треба перевірити:
1. Backend запущений і відповідає
2. WebSocket підключений
3. Обидва користувачі authenticated
4. Encryption keys однакові (після оновлення коду)

### Якщо не працює:
1. Перевірити Console на помилки
2. Очистити sessionStorage
3. Перезавантажити сторінку
4. Запустити локально для тестів

**Це найпростіше рішення що є. Blockchain НЕ потрібен для базової функціональності.**
