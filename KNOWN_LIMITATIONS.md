# Known Limitations in Ghost Messenger

## On-Chain / Off-Chain Sync

### Message Content Not Stored On-Chain
**Issue:** Blockchain only stores message *hashes* and *proofs*, not actual message content.

**Impact:**
- Users cannot verify full message history from blockchain alone
- Blockchain proof shows "a message was sent at timestamp X" but not its content
- Backend database is source of truth for message text

**Mitigation:**
- Blockchain proof is optional (Settings > Privacy > Blockchain Proof toggle)
- E2E encryption protects message content in backend database
- Users can export/backup messages from backend

---

## Smart Contract Limitations

### Channel/Group Name Collisions
**Issue:** Channel and group names are hashed with `BHP256(name)` without salt. If two users create channels with the same name, the second transaction will fail.

**Impact:**
- Popular channel names (e.g., "general", "random") cannot be reused
- Second user gets "already exists" error when trying to create

**Current Status:** Channels and groups are **disabled** in frontend (UI tabs are grayed out).

**Fix Options:**
1. Add random salt to channel hash: `BHP256(name || creator_hash || timestamp)`
2. Use sequential IDs instead of name hashes
3. Keep channels/groups disabled until fix is implemented

**Related Code:**
- Contract: `src/main.leo` lines 296-300 (finalize_create_channel)
- Frontend: `frontend/src/components/Sidebar.tsx` lines 190-191 (disabled tabs)

---

## Session Management

### Sessions Reset on Server Restart
**Issue:** Session tokens are stored in-memory Map, not persisted to database.

**Impact:**
- All users forced to re-authenticate after server restart
- No session rotation or refresh tokens

**Mitigation:**
- Sessions expire after 24 hours (SESSION_TTL)
- Sessions deleted on disconnect (security improvement in commit c8a4726)
- JWT implementation planned for future release

---

## WebSocket Scalability

### Single-Server Architecture
**Issue:** WebSocket connections are managed by single Express server. No horizontal scaling.

**Impact:**
- Limited to ~10k concurrent connections per server
- No load balancing across multiple backend instances

**Future:** Implement Redis pub/sub for multi-server WebSocket sync.

---

## File Uploads

### IPFS Dependency
**Issue:** File attachments are uploaded to IPFS (public network). Pinning is not guaranteed.

**Impact:**
- Files may disappear from IPFS after 24-48 hours if not pinned
- No built-in pinning service or backup

**Workarounds:**
- Use dedicated IPFS pinning service (Pinata, Web3.Storage)
- Self-host IPFS node with `--enable-gc=false`
- File size limited to 100MB (frontend validation)

---

## Rate Limiting

### Global Limit May Block Legitimate Use
**Current:** 600 requests per 15 minutes per IP/user

**Issue:** App startup makes ~10 requests. Heavy users may hit limit during normal use.

**Fix:** Increase limit or implement per-endpoint quotas (some endpoints already have specific limits).

---

## Contact Sync

### Race Condition on Fast Preference Load
**Fixed in commit:** TBD

**Issue:** If preferences loaded before contacts initialized, first contact update was skipped.

**Status:** Fixed by always saving contacts on first run after `preferencesLoaded` is true.

---

## Link Previews

### Cache Unbounded Growth
**Fixed in commit:** TBD

**Previous Issue:** Link preview cache could grow to 1000+ entries, causing memory leak.

**Status:** Fixed with 200-entry limit + LRU eviction.

---

Last updated: 2026-02-16
