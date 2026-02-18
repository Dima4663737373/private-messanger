# Security Audit — Ghost Messenger

**Date:** 2026-02-14
**Audited Version:** Commit `b1091e0`
**Scope:** Frontend encryption, backend security, smart contract safety

---

## 📊 Executive Summary

**Overall Risk Level:** 🟡 **MEDIUM** (Acceptable for hackathon, requires hardening for production)

**Critical Issues:** 1
**High Priority:** 3
**Medium Priority:** 4
**Low Priority:** 2

---

## 🔴 CRITICAL Issues

### 1. Private Keys Stored in localStorage

**Risk Level:** 🔴 CRITICAL
**Location:** `frontend/src/utils/crypto.ts:157`

**Issue:**
```typescript
localStorage.setItem(STORAGE_KEY, JSON.stringify(newKeys));
// Stores encryption private key in plaintext in browser localStorage
```

**Impact:**
- **XSS Attack:** If any XSS vulnerability exists, attacker can steal all encryption keys
- **Browser Extensions:** Malicious extensions can read localStorage
- **Physical Access:** Anyone with device access can extract keys
- **No Recovery:** If keys are leaked, all past and future messages are compromised

**Current Exposure:**
- Encryption private key stored as: `ghost_msg_keys_${walletAddress}`
- Base64 encoded but **NOT encrypted**
- Accessible via: `localStorage.getItem('ghost_msg_keys_aleo1...')`

**Mitigation (Production):**
1. **Option A — Web Crypto API (Recommended):**
   ```typescript
   // Store keys in IndexedDB with non-extractable CryptoKey objects
   const keyPair = await window.crypto.subtle.generateKey(
     { name: "ECDH", namedCurve: "P-256" },
     false, // non-extractable
     ["deriveKey"]
   );
   ```

2. **Option B — Encrypted Storage:**
   ```typescript
   // Derive encryption key from Aleo wallet signature
   const sig = await wallet.signMessage("Ghost Messenger Key Derivation");
   const storageKey = await deriveKeyFromSignature(sig);
   const encrypted = await encryptWithStorageKey(keys, storageKey);
   localStorage.setItem(STORAGE_KEY, encrypted);
   ```

3. **Option C — Derive from Aleo Keys:**
   - Use Aleo account keys to derive encryption keys (removes need for separate keypair)
   - Best option but requires Aleo SDK support

**Workaround (Current):**
- ✅ Keys are per-wallet (different keys for each Aleo address)
- ✅ No XSS/innerHTML usage found in code (good!)
- ❌ But keys are still plaintext in storage

---

## 🟠 HIGH Priority Issues

### 2. No Forward Secrecy (Static Encryption Keys)

**Risk Level:** 🟠 HIGH
**Location:** `frontend/src/utils/crypto.ts` (entire encryption scheme)

**Issue:**
- Uses **static NaCl box encryption** (Curve25519 + Salsa20/Poly1305)
- Same keypair for all messages
- No key rotation or ratcheting mechanism

**Impact:**
- **Compromised Key = All Messages Compromised:** Past and future
- **No Perfect Forward Secrecy:** Unlike Signal/WhatsApp
- If attacker gets `secretKey` from localStorage → can decrypt entire chat history

**Comparison:**
| Protocol | Forward Secrecy | Key Rotation |
|----------|----------------|--------------|
| **Ghost (current)** | ❌ No | ❌ No |
| **Signal** | ✅ Double Ratchet | ✅ Per-message |
| **WhatsApp** | ✅ Double Ratchet | ✅ Per-message |
| **Matrix** | ✅ Megolm | ✅ Per-session |

**Mitigation (Post-Hackathon):**
1. Implement **Signal Protocol Double Ratchet**
2. Use ephemeral keypairs per session
3. Rotate keys periodically (e.g., every 100 messages or 7 days)

**Workaround (Current):**
- Acceptable for hackathon demo
- Document limitation clearly

---

### 3. Metadata Leakage on Blockchain

**Risk Level:** 🟠 HIGH
**Location:** `src/main.leo` (smart contract)

**Issue:**
```leo
async function finalize_send_message(sender_hash: field, recipient_hash: field) {
  let dialog_key: field = BHP256::hash_to_field(min_hash + max_hash);
  Mapping::set(dialog_last_block, dialog_key, height);
}
```

**Impact:**
- **Timing Analysis:** Observer can see when messages are sent (block height)
- **Frequency Analysis:** Dialog activity visible on-chain
- **Correlation:** If attacker learns one `sender_hash → address` mapping, can link all messages

**Current Privacy:**
- ✅ Addresses hashed with BHP256 (not raw addresses)
- ✅ Message content is private (encrypted records)
- ❌ But dialog activity is public (when messages sent between two hashed parties)

**Example Attack:**
1. Attacker knows Alice's address → computes `BHP256(alice_addr)` = `hash_A`
2. Monitors `dialog_last_block` mapping for keys containing `hash_A`
3. Sees `dialog_key = BHP256(hash_A + hash_B)` updated every day at 9am
4. Infers: Alice chats with someone daily at 9am (metadata leak)

**Mitigation:**
- Use **dummy transactions** to obscure real message timing
- Add **noise** (random dialog updates)
- Implement **mixnet** or onion routing for metadata privacy

---

### 4. No Transaction Signature Verification on Backend

**Risk Level:** 🟠 HIGH
**Location:** `backend/src/server.ts` (WebSocket message handler)

**Issue:**
```typescript
ws.on('message', async (data) => {
  const msg = JSON.parse(data.toString());
  // No verification that the message author matches wallet signature
});
```

**Impact:**
- User can claim to be any `sender_hash` in WebSocket messages
- Backend trusts client-provided sender identity
- Attacker can impersonate users in off-chain delivery

**Current Exposure:**
- ✅ On-chain messages are safe (wallet signature required)
- ❌ Off-chain WebSocket delivery is not authenticated
- ❌ Profile updates, contact syncs are not signature-verified

**Mitigation:**
1. **Require wallet signature for every WS message:**
   ```typescript
   const msg = {
     type: 'message',
     payload: {...},
     signature: await wallet.signMessage(JSON.stringify(payload)),
     publicKey: 'aleo1...'
   };
   ```

2. **Verify signature on backend:**
   ```typescript
   const isValid = await verifyAleoSignature(
     msg.payload,
     msg.signature,
     msg.publicKey
   );
   if (!isValid) {
     ws.send(JSON.stringify({ type: 'error', message: 'Invalid signature' }));
     return;
   }
   ```

---

## 🟡 MEDIUM Priority Issues

### 5. CORS Configuration Allows No-Origin Requests

**Risk Level:** 🟡 MEDIUM
**Location:** `backend/src/server.ts:28-30`

**Issue:**
```typescript
if (!origin || ALLOWED_ORIGINS.includes(origin)) {
  callback(null, true); // Allows requests with no origin
}
```

**Impact:**
- **Development convenience** but risky for production
- Allows curl, Postman, mobile apps to bypass CORS
- Could enable **CSRF attacks** if not careful

**Mitigation (Production):**
```typescript
if (!origin) {
  callback(new Error('Origin header required'));
  return;
}
```

---

### 6. Rate Limiting Insufficient for DOS Protection

**Risk Level:** 🟡 MEDIUM
**Location:** `backend/src/server.ts:40-46`

**Issue:**
```typescript
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200, // 200 requests per 15 min = ~13 req/min
}));
```

**Assessment:**
- **Global limit:** 200 req/15min per IP
- **Search limit:** 15 req/min
- **Profile writes:** 5 req/min
- **WebSocket:** 30 msg/60s

**Gaps:**
- No **connection limit** (attacker can open 1000 WebSocket connections)
- No **memory-based DOS protection** (large payloads)
- No **CPU-based limits** (expensive crypto operations)

**Mitigation:**
1. Add WebSocket connection limit per IP
2. Limit message payload size (already at 100kb JSON)
3. Use **Redis** for distributed rate limiting (if scaling to multiple servers)

---

### 7. Encryption Key Length Not Validated

**Risk Level:** 🟡 MEDIUM
**Location:** `frontend/src/utils/crypto.ts:145-148`

**Issue:**
```typescript
if (pk.length === nacl.box.publicKeyLength && sk.length === nacl.box.secretKeyLength) {
  return parsed; // Valid
}
```

**Gap:**
- Validates length but not **key validity** (e.g., zero keys, weak keys)

**Mitigation:**
```typescript
// Add key validation
if (isZeroKey(pk) || isZeroKey(sk)) {
  throw new Error('Invalid keys detected');
}
```

---

### 8. No Content Security Policy (CSP) on Frontend

**Risk Level:** 🟡 MEDIUM
**Location:** `frontend/index.html` (missing CSP headers)

**Issue:**
- No CSP headers configured in Vite build or Netlify deployment
- Allows inline scripts, eval, etc.

**Impact:**
- **XSS Defense:** CSP is critical second layer of defense
- Without CSP, any XSS can execute arbitrary JavaScript

**Mitigation:**
Add to `netlify.toml`:
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://ghost-production-839c.up.railway.app wss://ghost-production-839c.up.railway.app https://api.explorer.provable.com"
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "no-referrer"
```

---

## 🟢 LOW Priority Issues

### 9. No Encryption Key Backup/Recovery Mechanism

**Risk Level:** 🟢 LOW
**Location:** System design (no recovery flow)

**Issue:**
- If localStorage is cleared → encryption keys lost forever
- Cannot decrypt old messages
- No recovery mechanism

**Impact:**
- **User frustration** when switching devices or clearing browser data
- **Data loss** for all message history

**Mitigation:**
1. **Cloud encrypted backup** (encrypted with Aleo wallet signature)
2. **Mnemonic phrase** for key derivation
3. **QR code export** for manual backup

---

### 10. No Smart Contract Audit

**Risk Level:** 🟢 LOW (for hackathon)
**Location:** `src/main.leo`

**Issue:**
- No formal audit of Leo smart contract
- Could have logic bugs, overflow issues, or access control problems

**Current Code Review:**
- ✅ Uses `assert` statements for access control
- ✅ No reentrancy risks (Aleo doesn't have this issue)
- ✅ No integer overflow (Leo has safe math)
- ⚠️ But no external audit

**Mitigation (Pre-Mainnet):**
1. Hire professional Leo auditor
2. Bug bounty program
3. Testnet testing period

---

## ✅ Security Strengths

### What's Done Well:

1. **End-to-End Encryption** ✅
   - Uses audited library (TweetNaCl)
   - Proper nonce generation (`nacl.randomBytes`)
   - Authenticated encryption (box = Salsa20-Poly1305)

2. **Backend Security** ✅
   - Helmet headers
   - CORS restrictions
   - Multiple rate limiters
   - Input validation
   - SQL injection protection (Sequelize ORM)

3. **No XSS Vulnerabilities Found** ✅
   - No `innerHTML` usage
   - No `dangerouslySetInnerHTML`
   - No `eval()` calls

4. **Smart Contract Safety** ✅
   - Uses BHP256 for address hashing
   - Access control with `assert`
   - No re-entrancy risks
   - Safe math (Leo design)

5. **Private Records** ✅
   - Message content stored as private records on-chain
   - Only sender + recipient can decrypt

---

## 🎯 Recommendations by Priority

### Immediate (Before Production)

1. ✅ **Already Done:** No XSS/SQL injection
2. 🔴 **Encrypt localStorage keys** or use Web Crypto API
3. 🟠 **Add WebSocket signature verification**
4. 🟡 **Add CSP headers** in Netlify config

### Post-Hackathon (Phase 1)

1. 🟠 Implement **forward secrecy** (Double Ratchet)
2. 🟡 Stricter CORS (remove no-origin allowance)
3. 🟡 WebSocket connection limits
4. 🟢 Key backup/recovery mechanism

### Long-term (Production)

1. 🟠 Metadata privacy (dummy transactions, mixnet)
2. 🟢 Smart contract audit
3. 🟢 Penetration testing
4. 🟢 Bug bounty program

---

## 📝 Security Checklist

| Item | Status | Priority |
|------|--------|----------|
| E2E Encryption (NaCl) | ✅ Implemented | - |
| XSS Prevention | ✅ No vulnerabilities found | - |
| SQL Injection Prevention | ✅ Sequelize ORM | - |
| CORS Protection | ✅ Configured | - |
| Rate Limiting | ✅ Multiple limiters | - |
| Helmet Headers | ✅ Enabled | - |
| **CSP Headers** | ❌ Missing | 🟡 MEDIUM |
| **localStorage Encryption** | ❌ Plaintext keys | 🔴 CRITICAL |
| **Forward Secrecy** | ❌ Static keys | 🟠 HIGH |
| **WS Signature Verification** | ❌ No auth | 🟠 HIGH |
| **Metadata Privacy** | ⚠️ Limited | 🟠 HIGH |
| Smart Contract Audit | ❌ No audit | 🟢 LOW |

---

## 🔐 Recommended Security Headers (Netlify)

Add to `netlify.toml`:

```toml
[[headers]]
  for = "/*"
  [headers.values]
    # Prevent clickjacking
    X-Frame-Options = "DENY"

    # Prevent MIME sniffing
    X-Content-Type-Options = "nosniff"

    # Enable XSS filter
    X-XSS-Protection = "1; mode=block"

    # Control referrer info
    Referrer-Policy = "strict-origin-when-cross-origin"

    # HTTPS only
    Strict-Transport-Security = "max-age=31536000; includeSubDomains"

    # CSP
    Content-Security-Policy = """
      default-src 'self';
      script-src 'self' 'unsafe-inline' 'unsafe-eval';
      style-src 'self' 'unsafe-inline';
      img-src 'self' data: https:;
      connect-src 'self' https://ghost-production-839c.up.railway.app wss://ghost-production-839c.up.railway.app https://api.explorer.provable.com;
      font-src 'self' data:;
      frame-ancestors 'none';
    """

    # Permissions Policy
    Permissions-Policy = "geolocation=(), microphone=(), camera=()"
```

---

## 📚 Security Resources

- [TweetNaCl Audit](https://tweetnacl.cr.yp.to/audits.html)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Signal Protocol](https://signal.org/docs/)
- [Aleo Developer Security](https://developer.aleo.org)

---

**Auditor Notes:**
This is a hackathon project with acceptable security for demo purposes. The architecture is sound, encryption is properly implemented, and no critical vulnerabilities like XSS/SQLi were found. Main concerns are:
1. localStorage key storage (solvable)
2. No forward secrecy (design decision)
3. Metadata leakage (blockchain limitation)

**Overall:** ✅ Safe for hackathon, requires hardening for production.

---

**Built for Aleo Hackathon 2026** 🔒
