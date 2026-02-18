# Auto-Fix: AUTH_CHALLENGE Decryption Failure

## Проблема

**Помилка в Console:**
```
AUTH_CHALLENGE decryption failed (keys may have changed), requesting limited token
```

**Причина:**
1. Backend database має **старий** encryption public key
2. Frontend генерує **новий** детерміністичний ключ
3. AUTH_CHALLENGE зашифрований старим ключем
4. Frontend не може розшифрувати → failure

---

## Рішення: Автоматичне Оновлення

### Потік (Auto-Recovery)

```
┌──────────────────────────────────────────────────────────────┐
│                  AUTO-FIX FLOW                                │
└──────────────────────────────────────────────────────────────┘

[Client]                    [Backend]
    │                           │
    │──────AUTH (address)──────>│
    │                           │
    │                           │ Load profile from DB
    │                           │ Old encryption key found
    │                           │
    │<─────AUTH_CHALLENGE───────│
    │   (encrypted with OLD key)│
    │                           │
    │ Try to decrypt...         │
    │ ❌ FAILED (wrong key)     │
    │                           │
    │──AUTH_KEY_MISMATCH───────>│
    │                           │
    │                           │ Issue limited token
    │<────AUTH_SUCCESS──────────│
    │   (requiresProfile: true) │
    │                           │
    │ Auto-register profile     │
    │ with NEW encryption key   │
    │                           │
    │──POST /profiles──────────>│
    │   (new publicKey)         │
    │                           │
    │                           │ Update DB
    │<──────200 OK──────────────│
    │                           │
    │ Close WebSocket           │
    │ (triggers auto-reconnect) │
    │                           │
    │──────AUTH (address)──────>│
    │                           │
    │                           │ Load profile from DB
    │                           │ NEW encryption key found
    │                           │
    │<─────AUTH_CHALLENGE───────│
    │   (encrypted with NEW key)│
    │                           │
    │ Decrypt...                │
    │ ✅ SUCCESS!               │
    │                           │
    │──AUTH_RESPONSE────────────>│
    │   (decrypted challenge)   │
    │                           │
    │<────AUTH_SUCCESS──────────│
    │   (full session)          │
    │                           │
    │ ✅ Connected & working!   │
```

---

## Зміни в Коді

### useSync.ts (lines 400-425)

**До:**
```typescript
if (data.requiresProfile) {
  logger.info('Limited session — auto-registering profile to upgrade...');
  // Update profile
  safeBackendFetch('profiles', { ... }).then(res => {
    if (!res.error) {
      logger.info('Session upgraded to full access');
    }
  });
}
```

**Після:**
```typescript
if (data.requiresProfile) {
  logger.info('Limited session — auto-registering profile to upgrade...');
  // Update profile
  safeBackendFetch('profiles', { ... }).then(res => {
    if (!res.error) {
      logger.info('✅ Profile updated with new encryption key — reconnecting...');
      toast.success('Encryption keys updated. Reconnecting...', { duration: 3000 });

      // ✨ NEW: Auto-reconnect after profile update
      setTimeout(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.close(); // Will trigger auto-reconnect
        }
      }, 1000);
    }
  });
}
```

**Що додано:**
1. ✅ Toast notification для користувача
2. ✅ Автоматичний reconnect після оновлення профілю
3. ✅ 1-секундна затримка для завершення POST запиту

---

## User Experience

### До (Manual Fix Required)

```
User connects
    ↓
❌ AUTH_CHALLENGE failed
    ↓
User sees: "401 Unauthorized" on all requests
    ↓
🤷 User confused, doesn't know what to do
    ↓
Need to manually: sessionStorage.clear() + DELETE profile + reload
```

### Після (Auto-Recovery)

```
User connects
    ↓
⚠️ AUTH_CHALLENGE failed (old key)
    ↓
✨ Auto-update profile with new key
    ↓
🔄 Auto-reconnect
    ↓
✅ AUTH_CHALLENGE success
    ↓
🎉 Everything works!
```

**Toast показує:** "Encryption keys updated. Reconnecting..." (3s)

**User не повинен нічого робити!**

---

## Коли Спрацьовує

### Scenario 1: Перший Підключення (Новий Користувач)

```
User connects → No profile in DB → requiresProfile: true
→ Auto-register → Reconnect → Success ✅
```

### Scenario 2: Оновлення Коду (Існуючий Користувач)

```
User connects → Old key in DB → AUTH_CHALLENGE fail
→ requiresProfile: true → Auto-update → Reconnect → Success ✅
```

### Scenario 3: Cross-Device (Той Самий Користувач, Інший Девайс)

```
Device A connected earlier (old key in DB)
Device B connects (new deterministic key)
→ AUTH_CHALLENGE fail → Auto-update → Reconnect → Success ✅
→ Device A reconnects → Uses same deterministic key → Success ✅
```

---

## Testing

### Test 1: Симуляція Old Key

```bash
# 1. Встановити старий код
git checkout HEAD~1

# 2. Підключитись (створить профіль зі старим ключем)
# Open browser, connect wallet

# 3. Повернутись на новий код
git checkout main

# 4. Reload page
# Має автоматично:
# - Показати toast "Encryption keys updated"
# - Reconnect
# - Успішно автентифікуватись
```

### Test 2: Перевірити Console

**Має бути:**
```
[WS] Connected
⚠️ AUTH_CHALLENGE decryption failed (keys may have changed), requesting limited token
ℹ️ Limited session — auto-registering profile to upgrade...
✅ Profile updated with new encryption key — reconnecting...
[WS] Reconnecting... (attempt 1)
[WS] Connected
✅ [WS] Authenticated successfully
```

**Toast:**
```
✅ Encryption keys updated. Reconnecting...
```

---

## Переваги

✅ **Zero User Intervention** - Працює автоматично
✅ **Seamless UX** - Користувач бачить тільки toast на 3 секунди
✅ **Backward Compatible** - Працює з існуючими користувачами
✅ **Cross-Device Safe** - Детерміністичні ключі sync між девайсами
✅ **Self-Healing** - Автоматично виправляє key mismatch

---

## Fallback Scenarios

### Якщо Auto-Fix Не Спрацював

**Manual Fix (як раніше):**

```javascript
// Console (F12):
sessionStorage.clear();
localStorage.clear();
location.reload();
```

**Або видалити профіль:**

```javascript
const address = wallet.publicKey;
await fetch(`https://ghost-production-839c.up.railway.app/profiles/${address}`, {
  method: 'DELETE'
});
location.reload();
```

---

## Deployment

### Необхідні Файли

```
frontend/src/hooks/useSync.ts  ✅ Modified
```

### Build & Deploy

```bash
# 1. TypeScript check
cd frontend
npx tsc --noEmit

# 2. Build
npm run build

# 3. Deploy
# Vercel: git push (auto-deploy)
# Netlify: git push (auto-deploy)
# Manual: Upload dist/ folder
```

---

## Monitoring

### Success Metrics

В Console має бути:
```
✅ Profile updated with new encryption key — reconnecting...
✅ [WS] Authenticated successfully
```

### Error Metrics

Якщо бачиш:
```
❌ Auto profile registration failed: ...
```

→ Перевір backend endpoint `/profiles` (POST)

---

## Conclusion

Ця зміна робить **AUTH_CHALLENGE failures self-healing**.

Користувачі більше **не побачать 401 errors** після оновлення коду або підключення з нового девайсу.

**Total UX impact:** 3-second toast + auto-reconnect = **seamless experience** ✨
