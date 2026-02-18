# IndexedDB + Blockchain Implementation Guide

## Архітектура зберігання даних

```
┌──────────────┐
│  IndexedDB   │ ← Первинне сховище (миттєве завантаження)
│  (Browser)   │
└──────┬───────┘
       │
       ↕ sync
       │
┌──────┴───────┐     ┌──────────────┐
│   Backend    │ ←→  │  Blockchain  │
│   SQLite     │     │  (Aleo)      │
└──────────────┘     └──────────────┘
   Кросс-девайс         Immutable proof
```

### Потік даних:

1. **Відправка повідомлення:**
   - Зберегти в IndexedDB (миттєво)
   - Відправити через WebSocket → Backend
   - (Опціонально) Зберегти proof на blockchain

2. **Отримання повідомлення:**
   - Отримати через WebSocket
   - Зберегти в IndexedDB (миттєво)
   - Оновити UI

3. **Відкриття браузера:**
   - Завантажити з IndexedDB (миттєво, <100ms)
   - Синхронізувати з Backend (фоново)
   - (Опціонально) Верифікувати через blockchain

---

## Крок 1: Інтеграція в App.tsx

### 1.1 Додати імпорти

```typescript
// Додати після існуючих імпортів (близько рядка 10)
import { useMessageStorage } from './hooks/useMessageStorage';
```

### 1.2 Ініціалізувати storage hook

```typescript
// Додати після usePreferences (близько рядка 75)

// IndexedDB storage for instant loading
const messageStorage = useMessageStorage({
  address: publicKey,
  onContactsLoaded: (loadedContacts) => {
    logger.info(`[IndexedDB] Loaded ${loadedContacts.length} contacts from local storage`);
    setContacts(prev => {
      // Merge with existing contacts (prefer newer data)
      const merged = [...prev];
      loadedContacts.forEach(loaded => {
        const existingIdx = merged.findIndex(c => c.id === loaded.id);
        if (existingIdx === -1) {
          merged.push(loaded);
        } else {
          // Update if IndexedDB data is newer
          if (loaded.lastMessageTime && (!merged[existingIdx].lastMessageTime ||
              loaded.lastMessageTime > merged[existingIdx].lastMessageTime)) {
            merged[existingIdx] = { ...merged[existingIdx], ...loaded };
          }
        }
      });
      return merged;
    });
  },
});
```

### 1.3 Завантаження повідомлень з IndexedDB

```typescript
// Модифікувати useEffect для завантаження повідомлень (близько рядка 823)

useEffect(() => {
  if (!activeChatId || !publicKey || !activeDialogHash) return;

  // STEP 1: Load from IndexedDB first (instant)
  messageStorage.loadDialogMessages(activeDialogHash, 100).then(indexedDBMessages => {
    if (indexedDBMessages.length > 0) {
      logger.info(`[IndexedDB] Loaded ${indexedDBMessages.length} messages instantly`);
      setHistories(prev => ({ ...prev, [activeChatId]: indexedDBMessages }));
    }
  });

  // STEP 2: Sync from backend in background
  fetchDialogMessages(activeDialogHash, { limit: 100 }).then(backendMessages => {
    if (backendMessages && backendMessages.length > 0) {
      const sorted = backendMessages.sort((a, b) => a.timestamp - b.timestamp);
      setHistories(prev => ({ ...prev, [activeChatId]: sorted }));

      // Save to IndexedDB for next time
      // (implementation in next step)
    }
  });

}, [activeChatId, activeDialogHash, publicKey, messageStorage]);
```

### 1.4 Зберігання повідомлень в IndexedDB

```typescript
// Модифікувати handleNewMessage (близько рядка 207)

const handleNewMessage = React.useCallback((msg: Message & { recipient?: string, recipientHash?: string, dialogHash?: string }) => {
  // ... існуючий код ...

  // After adding to histories, save to IndexedDB
  if (msg.dialogHash) {
    messageStorage.saveMessage({
      ...msg,
      dialogHash: msg.dialogHash,
      sender: msg.isMine ? (publicKey || '') : (msg.senderId !== 'me' ? msg.senderId : ''),
      recipient: msg.isMine ? (msg.recipient || '') : (publicKey || ''),
      encryptedPayload: '', // Should be passed from WS message
      encryptedPayloadSelf: '',
    }).catch(err => logger.error('[IndexedDB] Failed to save message:', err));
  }

  // Also save contact to IndexedDB
  if (counterpartyAddress && counterpartyAddress !== 'unknown') {
    messageStorage.saveContact({
      address: counterpartyAddress,
      name: contacts.find(c => c.address === counterpartyAddress)?.name || `User ${counterpartyAddress.slice(0, 10)}...`,
      dialogHash: msg.dialogHash,
      lastMessage: msg.text,
      lastMessageTime: msg.timestamp,
    }).catch(err => logger.error('[IndexedDB] Failed to save contact:', err));
  }

}, [/* existing deps */, messageStorage, publicKey, contacts]);
```

---

## Крок 2: Передача encrypted payload в handleNewMessage

### 2.1 Модифікувати useSync.ts

```typescript
// У функції обробки message_detected (близько рядка 665)

const msg: Message & {
  recipient: string;
  encryptedPayload?: string;  // ADD THIS
  encryptedPayloadSelf?: string;  // ADD THIS
} = {
  id: rawMsg.id,
  text: text || "Decryption Failed",
  // ... existing fields ...
  encryptedPayload: rawMsg.encryptedPayload || rawMsg.content_encrypted,  // ADD
  encryptedPayloadSelf: rawMsg.encryptedPayloadSelf || rawMsg.encrypted_payload_self,  // ADD
};

onNewMessage(msg);
```

### 2.2 Оновити тип Message

```typescript
// У types.ts додати опціональні поля

export interface Message {
  id: string;
  text: string;
  // ... existing fields ...
  encryptedPayload?: string;  // ADD
  encryptedPayloadSelf?: string;  // ADD
}
```

---

## Крок 3: Blockchain Sync

### 3.1 Створити blockchain sync сервіс

```typescript
// frontend/src/services/blockchain-sync.ts

import { logger } from '../utils/logger';
import { indexedDBStorage } from '../utils/indexeddb-storage';

export interface BlockchainMessage {
  transactionId: string;
  sender: string;
  recipient: string;
  senderHash: string;
  recipientHash: string;
  payload: string[];
  timestamp: number;
  blockHeight: number;
}

/**
 * Scan blockchain for all messages involving the user
 */
export async function syncMessagesFromBlockchain(
  userAddress: string,
  fromBlock = 0,
  toBlock?: number
): Promise<BlockchainMessage[]> {
  try {
    logger.info(`[BlockchainSync] Scanning blocks ${fromBlock} to ${toBlock || 'latest'}...`);

    // Use Aleo explorer API to get transactions
    const endpoint = 'https://api.explorer.provable.com/v1';
    const programId = 'ghost_msg_018.aleo';

    // Query transactions where user is sender or recipient
    const response = await fetch(
      `${endpoint}/program/${programId}/transitions?page=0&size=100`
    );

    if (!response.ok) {
      throw new Error(`Explorer API error: ${response.status}`);
    }

    const data = await response.json();
    const messages: BlockchainMessage[] = [];

    // Parse send_message transitions
    for (const transition of data.transitions || []) {
      if (transition.function === 'send_message') {
        // Extract inputs
        const [senderHash, recipientHash, , payload, timestamp] = transition.inputs;

        messages.push({
          transactionId: transition.id,
          sender: '', // Resolve from hash
          recipient: '', // Resolve from hash
          senderHash: senderHash.value,
          recipientHash: recipientHash.value,
          payload: payload.value, // Array of fields
          timestamp: parseInt(timestamp.value),
          blockHeight: transition.block_height,
        });
      }
    }

    logger.info(`[BlockchainSync] Found ${messages.length} messages on blockchain`);
    return messages;

  } catch (error) {
    logger.error('[BlockchainSync] Failed to sync from blockchain:', error);
    return [];
  }
}

/**
 * Rebuild IndexedDB from blockchain (recovery mode)
 */
export async function rebuildFromBlockchain(userAddress: string): Promise<number> {
  try {
    logger.info('[BlockchainSync] Rebuilding from blockchain...');

    // Scan blockchain
    const messages = await syncMessagesFromBlockchain(userAddress);

    // Save to IndexedDB
    const stored = messages.map(msg => ({
      id: msg.transactionId,
      dialogHash: '', // Compute from hashes
      sender: msg.sender,
      recipient: msg.recipient,
      encryptedPayload: msg.payload.join(','),
      timestamp: msg.timestamp,
      status: 'sent' as const,
    }));

    await indexedDBStorage.saveMessages(stored);

    logger.info(`[BlockchainSync] Rebuilt ${stored.length} messages from blockchain`);
    return stored.length;

  } catch (error) {
    logger.error('[BlockchainSync] Rebuild failed:', error);
    return 0;
  }
}
```

### 3.2 Додати кнопку "Sync from Blockchain" в Settings

```typescript
// У SettingsView.tsx додати секцію

<div className="setting-item">
  <div className="setting-info">
    <h3>Blockchain Sync</h3>
    <p className="setting-description">
      Rebuild message history from Aleo blockchain (recovery mode)
    </p>
  </div>
  <button
    className="btn-primary"
    onClick={async () => {
      if (!publicKey) return;
      toast.loading('Scanning blockchain...', { id: 'blockchain-sync' });
      const { rebuildFromBlockchain } = await import('../services/blockchain-sync');
      const count = await rebuildFromBlockchain(publicKey);
      toast.success(`Rebuilt ${count} messages from blockchain`, { id: 'blockchain-sync' });
    }}
  >
    Rebuild from Blockchain
  </button>
</div>
```

---

## Крок 4: Тестування

### 4.1 Перевірка IndexedDB

```javascript
// У браузері (DevTools > Console):

// Відкрити IndexedDB
const db = await indexedDB.open('ghost_messenger_db', 1);

// Перевірити збережені повідомлення
const tx = db.transaction('messages', 'readonly');
const messages = await tx.objectStore('messages').getAll();
console.log('Stored messages:', messages.length);

// Перевірити контакти
const contactsTx = db.transaction('contacts', 'readonly');
const contacts = await contactsTx.objectStore('contacts').getAll();
console.log('Stored contacts:', contacts.length);
```

### 4.2 Тест персистентності

1. Відправити повідомлення користувачу
2. Закрити браузер повністю
3. Відкрити знову
4. ✅ Чати мають з'явитися миттєво (<100ms) з IndexedDB
5. ✅ Потім синхронізуватися з бекендом (фоново)

### 4.3 Тест blockchain recovery

1. У DevTools: `indexedDB.deleteDatabase('ghost_messenger_db')`
2. Закрити/відкрити вкладку
3. Settings → Blockchain Sync → "Rebuild from Blockchain"
4. ✅ Повідомлення мають відновитися з блокчейну

---

## Крок 5: Оптимізації

### 5.1 Lazy loading повідомлень

```typescript
// Завантажувати тільки останні 50 повідомлень спочатку
const loadMore = async () => {
  const currentCount = histories[activeChatId]?.length || 0;
  const older = await messageStorage.loadDialogMessages(
    activeDialogHash,
    50,
    currentCount  // offset
  );

  if (older.length > 0) {
    setHistories(prev => ({
      ...prev,
      [activeChatId]: [...older, ...(prev[activeChatId] || [])]
    }));
  }
};
```

### 5.2 Автоматичне очищення старих повідомлень

```typescript
// Видаляти повідомлення старіші за 90 днів
const cleanupOldMessages = async () => {
  const cutoff = Date.now() - (90 * 24 * 60 * 60 * 1000); // 90 days
  // Implementation in indexeddb-storage.ts
};
```

### 5.3 Storage quota моніторинг

```typescript
// Попереджати якщо використано >80% квоти
const stats = await messageStorage.getStorageStats();
if (stats && parseInt(stats.percentUsed) > 80) {
  toast.warning(`Storage almost full: ${stats.percentUsed}% used`);
}
```

---

## Переваги нової архітектури

| Функція | До | Після |
|---------|-----|-------|
| **Швидкість завантаження** | ~500-2000ms (backend REST) | ~50-100ms (IndexedDB) |
| **Офлайн доступ** | ❌ Ні | ✅ Так (read-only) |
| **Кросс-девайс синхронізація** | ✅ Так (backend) | ✅ Так (backend) |
| **Blockchain proof** | ⚠️ Опціонально | ✅ Повна підтримка |
| **Втрата даних при очищенні браузера** | ✅ Захищено (backend) | ⚠️ Втрата локальних даних (можна відновити з backend/blockchain) |
| **Використання storage** | ~0KB (тільки preferences) | ~5-50MB (залежно від історії) |

---

## Deployment Checklist

- [ ] Створено `indexeddb-storage.ts`
- [ ] Створено `useMessageStorage.ts`
- [ ] Інтегровано в `App.tsx` (storage hook)
- [ ] Модифіковано `handleNewMessage` (save to IndexedDB)
- [ ] Модифіковано `useSync.ts` (pass encrypted payloads)
- [ ] Оновлено `types.ts` (Message interface)
- [ ] Створено `blockchain-sync.ts`
- [ ] Додано UI для blockchain sync (Settings)
- [ ] Перевірено TypeScript compilation
- [ ] Протестовано персистентність
- [ ] Протестовано blockchain recovery
- [ ] Задеплоєно на Netlify

---

## Troubleshooting

### IndexedDB не зберігає дані
- Перевірити DevTools > Application > IndexedDB
- Перевірити чи не блокується приватним режимом браузера
- Перевірити storage quota: `navigator.storage.estimate()`

### Повідомлення дублюються
- Перевірити дедуплікацію за `message.id`
- Перевірити чи `processedMsgIds` працює коректно

### Blockchain sync не працює
- Перевірити Aleo Explorer API доступність
- Перевірити program ID: `ghost_msg_018.aleo`
- Перевірити чи транзакції є на блокчейні

---

**Наступний крок:** Почати з інтеграції IndexedDB в App.tsx (Крок 1.2)
