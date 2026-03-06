# Технічна Концепція: Порівняння Архітектур Месенджера

## Огляд

Документ порівнює дві фундаментально різні архітектури побудови сучасного месенджера:
- **Варіант А**: Класичний централізований месенджер (WebSocket-based)
- **Варіант Б**: Децентралізований блокчейн-месенджер

---

## Варіант А: Класичний Месенджер (WebSocket)

### Архітектура

```
┌─────────────┐                    ┌─────────────┐
│  Client A   │◄──────WebSocket────┤  Backend    │
│  (Browser)  │                    │   Server    │
└─────────────┘                    │             │
                                   │  ┌────────┐ │
┌─────────────┐                    │  │  WS    │ │
│  Client B   │◄──────WebSocket────┤  │ Pool   │ │
│  (Browser)  │                    │  └────────┘ │
└─────────────┘                    │             │
                                   │  ┌────────┐ │
┌─────────────┐                    │  │  DB    │ │
│  Client C   │◄──────WebSocket────┤  │ SQLite │ │
│   (Mobile)  │                    │  │   /    │ │
└─────────────┘                    │  │Postgres│ │
                                   │  └────────┘ │
                                   └─────────────┘
```

### Стек Технологій

#### Frontend
```typescript
// Core
- React 18 + TypeScript
- Vite (build tool)
- TailwindCSS (styling)

// Real-time Communication
- WebSocket API (native browser)
- Reconnection logic with exponential backoff

// State Management
- React Context / Zustand / Redux Toolkit
- IndexedDB для локального кешу

// Encryption
- TweetNaCl (NaCl Curve25519 + Salsa20/Poly1305)
- WebCrypto API для key derivation

// UI Components
- Framer Motion (animations)
- React Hot Toast (notifications)
- Emoji Picker React
```

#### Backend
```typescript
// Server
- Node.js 20+
- Express.js (REST API)
- ws (WebSocket library)

// Database
- SQLite (development) / PostgreSQL (production)
- Sequelize ORM

// Authentication
- Challenge-Response auth (NaCl box encryption)
- Session tokens (JWT or UUID + in-memory store)
- HMAC message authentication

// Security
- Rate limiting (express-rate-limit)
- Helmet.js (security headers)
- CORS configuration

// Scaling (optional)
- Redis (session store + pub/sub)
- Message queue (RabbitMQ / BullMQ)
```

### Компоненти Системи

#### Backend Components

```typescript
// 1. WebSocket Server
class WebSocketServer {
  clients: Map<string, WebSocket>;        // Active connections
  sessions: Map<string, Session>;         // Auth sessions

  handleAuth(ws, address): Promise<void>; // Challenge-response
  broadcast(msg, recipients): void;       // Send to multiple clients
  handleMessage(ws, data): Promise<void>; // Route messages
}

// 2. Message Storage
interface Message {
  id: string;
  sender: string;
  recipient: string;
  encrypted_payload: string;
  timestamp: number;
  status: 'sent' | 'delivered' | 'read';
  dialog_hash: string;
}

// 3. Session Manager
class SessionManager {
  sessions: Map<string, Session>;

  createSession(address): Session;
  validateSession(token): boolean;
  cleanup(): void; // Remove expired sessions
}

// 4. Database Schema
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  status TEXT DEFAULT 'sent',
  dialog_hash TEXT,
  INDEX(dialog_hash),
  INDEX(timestamp)
);

CREATE TABLE profiles (
  address TEXT PRIMARY KEY,
  username TEXT,
  encryption_public_key TEXT,
  address_hash TEXT,
  last_seen BIGINT
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
```

#### Frontend Components

```typescript
// 1. WebSocket Hook
const useWebSocket = (address: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  const connect = () => {
    ws.current = new WebSocket(WS_URL);
    ws.current.onmessage = handleMessage;
    ws.current.onopen = handleAuth;
  };

  const sendMessage = (data: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(data));
    }
  };

  return { isConnected, sendMessage };
};

// 2. Message Storage (IndexedDB)
class MessageStorage {
  db: IDBDatabase;

  saveMessage(msg: Message): Promise<void>;
  getMessages(dialogHash: string): Promise<Message[]>;
  updateStatus(msgId: string, status: string): Promise<void>;
}

// 3. Encryption Service
class EncryptionService {
  encryptMessage(text: string, recipientPubKey: string): string;
  decryptMessage(encrypted: string, senderPubKey: string): string;
  generateKeypair(): KeyPair;
}
```

### Потік Відправки Повідомлення

```
┌──────────────────────────────────────────────────────────────┐
│                   ВІДПРАВКА ПОВІДОМЛЕННЯ                      │
└──────────────────────────────────────────────────────────────┘

[Client A]                [Backend]                [Client B]
    │                         │                         │
    │ 1. Введення тексту     │                         │
    │    "Hello!"             │                         │
    │                         │                         │
    │ 2. Шифрування E2E      │                         │
    │    (NaCl box)           │                         │
    │    Key: recipient_pub   │                         │
    │                         │                         │
    │ 3. WS send              │                         │
    │──────{dm_send}─────────>│                         │
    │                         │                         │
    │                         │ 4. Валідація session    │
    │                         │    HMAC перевірка       │
    │                         │                         │
    │                         │ 5. Збереження в DB      │
    │                         │    INSERT INTO messages │
    │                         │                         │
    │                         │ 6. Broadcast recipients │
    │<──────{dm_sent}─────────│─────{message_detected}──>│
    │                         │                         │
    │ 7. UI update (optimistic)                        │
    │    Показати повідомлення│                         │
    │    зі статусом "sent"   │                         │
    │                         │                         │
    │                         │                         │ 8. Розшифрування
    │                         │                         │    (NaCl box.open)
    │                         │                         │
    │                         │                         │ 9. UI update
    │                         │                         │    Показати текст
    │                         │                         │
    │                         │<────{read_receipt}──────│
    │                         │                         │
    │<──────{msg_read}────────│                         │
    │                         │                         │
    │ 10. Status → "read"     │                         │
    │     Дві сині галочки    │                         │
    │                         │                         │

⏱️ Час доставки: 50-200ms (локальна мережа), 200-500ms (інтернет)
```

### Детальний Розбір Потоку

#### 1. Client A: Підготовка Повідомлення

```typescript
async function sendMessage(text: string, recipientAddress: string) {
  // 1.1. Генерація ID
  const msgId = uuidv4();
  const timestamp = Date.now();

  // 1.2. Шифрування E2E
  const recipientProfile = await fetchProfile(recipientAddress);
  const recipientPubKey = recipientProfile.encryption_public_key;

  const encryptedPayload = encryptMessage(
    text,
    recipientPubKey,
    mySecretKey
  );

  // 1.3. Відправка через WebSocket
  ws.send(JSON.stringify({
    type: 'dm_send',
    payload: {
      id: msgId,
      recipient: recipientAddress,
      encryptedPayload,
      timestamp,
      hmac: generateHMAC(sessionSecret, payload)
    }
  }));

  // 1.4. Optimistic UI update
  addMessageToUI({
    id: msgId,
    text,
    status: 'pending',
    timestamp
  });
}
```

#### 2. Backend: Обробка та Маршрутизація

```typescript
async function handleDMSend(ws: WebSocket, data: any) {
  // 2.1. Валідація HMAC
  const session = sessions.get(ws.sessionToken);
  const validHMAC = verifyHMAC(session.secret, data.payload, data.hmac);
  if (!validHMAC) {
    return ws.send({ type: 'error', message: 'Invalid HMAC' });
  }

  // 2.2. Збереження в БД
  await Message.create({
    id: data.payload.id,
    sender: ws.authenticatedAddress,
    recipient: data.payload.recipient,
    encrypted_payload: data.payload.encryptedPayload,
    timestamp: data.payload.timestamp,
    status: 'sent',
    dialog_hash: computeDialogHash(sender, recipient)
  });

  // 2.3. Підтвердження відправнику
  ws.send(JSON.stringify({
    type: 'dm_sent',
    payload: { id: data.payload.id, timestamp: Date.now() }
  }));

  // 2.4. Broadcast отримувачу
  const recipientClients = findConnectedClients(data.payload.recipient);
  recipientClients.forEach(clientWS => {
    clientWS.send(JSON.stringify({
      type: 'message_detected',
      payload: {
        id: data.payload.id,
        sender: ws.authenticatedAddress,
        recipient: data.payload.recipient,
        encryptedPayload: data.payload.encryptedPayload,
        timestamp: data.payload.timestamp,
        senderEncryptionKey: session.senderPublicKey
      }
    }));
  });
}
```

#### 3. Client B: Отримання та Розшифрування

```typescript
function handleMessageDetected(data: any) {
  // 3.1. Розшифрування
  const decrypted = decryptMessage(
    data.payload.encryptedPayload,
    data.payload.senderEncryptionKey,
    mySecretKey
  );

  // 3.2. Збереження в IndexedDB
  await indexedDB.saveMessage({
    id: data.payload.id,
    sender: data.payload.sender,
    recipient: data.payload.recipient,
    encryptedPayload: data.payload.encryptedPayload,
    decryptedText: decrypted,
    timestamp: data.payload.timestamp,
    status: 'delivered'
  });

  // 3.3. UI update
  addMessageToUI({
    id: data.payload.id,
    text: decrypted,
    isMine: false,
    timestamp: data.payload.timestamp,
    status: 'delivered'
  });

  // 3.4. Відправка read receipt (якщо чат активний)
  if (activeChatId === data.payload.sender) {
    ws.send(JSON.stringify({
      type: 'read_receipt',
      payload: { messageId: data.payload.id }
    }));
  }

  // 3.5. Нотифікація
  if (document.hidden) {
    new Notification('New message', { body: decrypted.slice(0, 50) });
  }
  playNotificationSound();
}
```

### Авторизація: Challenge-Response Flow

```typescript
// Backend: Генерація Challenge
async function handleAuth(ws: WebSocket, address: string) {
  // 1. Завантажити публічний ключ користувача з БД
  const profile = await Profile.findByPk(address);

  if (!profile) {
    // Новий користувач → видати limited token
    return ws.send({
      type: 'AUTH_SUCCESS',
      token: generateToken(),
      requiresProfile: true
    });
  }

  // 2. Згенерувати випадковий challenge
  const challenge = randomBytes(32).toString('base64');
  const serverKeys = nacl.box.keyPair();
  const nonce = randomBytes(24);

  // 3. Зашифрувати challenge публічним ключем клієнта
  const encrypted = nacl.box(
    Buffer.from(challenge),
    nonce,
    Buffer.from(profile.encryption_public_key, 'base64'),
    serverKeys.secretKey
  );

  // 4. Відправити зашифрований challenge
  pendingChallenges.set(ws, { challenge, address });
  ws.send({
    type: 'AUTH_CHALLENGE',
    encryptedChallenge: encrypted.toString('base64'),
    nonce: nonce.toString('base64'),
    serverPublicKey: serverKeys.publicKey.toString('base64')
  });
}

// Client: Відповідь на Challenge
async function handleAuthChallenge(data: any) {
  // 1. Розшифрувати challenge приватним ключем
  const decrypted = nacl.box.open(
    Buffer.from(data.encryptedChallenge, 'base64'),
    Buffer.from(data.nonce, 'base64'),
    Buffer.from(data.serverPublicKey, 'base64'),
    mySecretKey
  );

  // 2. Відправити розшифрований challenge назад
  ws.send({
    type: 'AUTH_RESPONSE',
    decryptedChallenge: decrypted.toString()
  });
}

// Backend: Верифікація Відповіді
function handleAuthResponse(ws: WebSocket, response: string) {
  const pending = pendingChallenges.get(ws);

  if (response === pending.challenge) {
    // ✅ Успішна автентифікація
    const token = generateSessionToken();
    const sessionSecret = generateHMACSecret();

    sessions.set(token, {
      address: pending.address,
      createdAt: Date.now(),
      sessionSecret
    });

    ws.send({
      type: 'AUTH_SUCCESS',
      token,
      sessionSecret
    });
  } else {
    ws.send({ type: 'AUTH_FAILED' });
  }
}
```

### Масштабування

#### Horizontal Scaling (Декілька Backend Інстансів)

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Client 1 │────>│ Backend  │     │ Backend  │
└──────────┘     │  Node 1  │     │  Node 2  │
                 │          │     │          │
┌──────────┐     │  ┌────┐  │     │  ┌────┐  │
│ Client 2 │────>│  │ WS │  │     │  │ WS │  │
└──────────┘     │  └────┘  │     │  └────┘  │
                 │          │     │          │
┌──────────┐     │          │     │          │
│ Client 3 │────────────────────>│          │
└──────────┘     └────┬─────┘     └────┬─────┘
                      │                │
                      │   ┌─────────┐  │
                      └───┤  Redis  │──┘
                          │ Pub/Sub │
                          └─────────┘
                               │
                          ┌────┴─────┐
                          │ Postgres │
                          │    DB    │
                          └──────────┘
```

**Компоненти для масштабування:**

```typescript
// 1. Redis Pub/Sub для синхронізації між нодами
class RedisMessageBroker {
  publisher: Redis;
  subscriber: Redis;

  async publish(channel: string, message: any) {
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, handler: Function) {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, msg) => {
      if (ch === channel) handler(JSON.parse(msg));
    });
  }
}

// Використання:
redisbroker.subscribe('messages', (msg) => {
  // Broadcast до локальних WS клієнтів
  const localClients = wsServer.clients.get(msg.recipient);
  localClients?.forEach(ws => ws.send(msg));
});

// 2. Sticky Sessions (Load Balancer)
// Nginx config
upstream backend {
  ip_hash;  # Sticky sessions based on IP
  server backend1:3000;
  server backend2:3000;
  server backend3:3000;
}

// 3. Shared Session Store (Redis)
class RedisSessionStore {
  async save(token: string, session: Session) {
    await redis.setex(
      `session:${token}`,
      SESSION_TTL,
      JSON.stringify(session)
    );
  }

  async get(token: string): Promise<Session | null> {
    const data = await redis.get(`session:${token}`);
    return data ? JSON.parse(data) : null;
  }
}
```

### Переваги Варіанту А

✅ **Швидкість**: 50-500ms latency, real-time delivery
✅ **Простота**: Звична архітектура, багато готових бібліотек
✅ **Масштабованість**: Легко додавати ноди через Redis pub/sub
✅ **Вартість**: Низька (тільки server hosting)
✅ **Контроль**: Повний контроль над даними та логікою
✅ **Надійність**: Гарантована доставка через DB persistence
✅ **Функціональність**: Read receipts, typing indicators, присутність

### Недоліки Варіанту А

❌ **Централізація**: Single point of failure (backend server)
❌ **Довіра**: Користувачі повинні довіряти серверу
❌ **Приватність**: Сервер має доступ до метаданих (хто, коли, кому)
❌ **Цензура**: Можливість блокування/модерації
❌ **Vendor Lock-in**: Важко мігрувати на інший сервер

### Складність Реалізації

⭐⭐⭐ **3/5** - Середня складність

**Easy:**
- WebSocket підключення
- REST API для профілів
- SQLite/Postgres для зберігання

**Medium:**
- E2E шифрування (NaCl)
- Challenge-Response auth
- Reconnection logic

**Hard:**
- Horizontal scaling (Redis pub/sub)
- Cross-device sync
- Offline message queue

**Час розробки:** 2-3 місяці (1 fullstack developer)

---

## Варіант Б: Блокчейн Месенджер (Aleo)

### Архітектура

```
┌─────────────┐                    ┌──────────────┐
│  Client A   │                    │   Aleo       │
│  (Browser)  │◄────────RPC────────┤  Blockchain  │
│             │                    │   Testnet    │
│  ┌────────┐ │                    │              │
│  │IndexedDB│ │                    │ ┌──────────┐ │
│  └────────┘ │                    │ │ Smart    │ │
│             │                    │ │ Contract │ │
│  ┌────────┐ │                    │ │ (Leo)    │ │
│  │ Wallet │ │                    │ └──────────┘ │
│  │  Leo   │ │                    │              │
│  └────────┘ │                    │ ┌──────────┐ │
└─────────────┘                    │ │ Mappings │ │
                                   │ │ On-chain │ │
       ▲                           │ └──────────┘ │
       │                           └──────────────┘
       │ WebSocket                        ▲
       │ (optional)                       │
       │                                  │ Transaction
       │                                  │ Broadcasting
       ▼                                  │
┌─────────────┐                           │
│  Backend    │───────────────────────────┘
│  (Helper)   │
│             │
│ ┌─────────┐ │      Hybrid Model:
│ │Indexer/ │ │      - Backend спостерігає за blockchain
│ │ Sync    │ │      - Шифровані payloads зберігаються off-chain
│ └─────────┘ │      - Blockchain зберігає proof/metadata
│             │
│ ┌─────────┐ │
│ │ SQLite  │ │
│ │ Cache   │ │
│ └─────────┘ │
└─────────────┘
```

### Стек Технологій

#### Frontend
```typescript
// Blockchain Interaction
- @provablehq/aleo-wallet-adaptor-react
- @provablehq/aleo-wallet-adaptor-shield
- Aleo SDK / leo-wasm

// Storage
- IndexedDB (primary storage for messages)
- sessionStorage (encryption keys cache)

// Crypto
- TweetNaCl (E2E encryption, same as Variant A)
- Aleo native hashing (BHP256)

// Communication
- REST API для синхронізації (optional)
- WebSocket для instant notification (optional)
```

#### Backend (Helper Server - Optional)
```typescript
// Blockchain Indexer
- Node.js + Express
- Aleo Explorer API client
- SQLite для кешу транзакцій

// Services
- Sync service (сканує blockchain для нових messages)
- Notification service (push через WebSocket)
- Profile cache (уникнення повторних RPC calls)
```

#### Smart Contract (Leo)
```leo
// ghost_msg.aleo
program ghost_msg.aleo {
    // Структури
    struct MessageProof {
        sender_hash: field,
        recipient_hash: field,
        content_hash: field,
        timestamp: u64
    }

    // Mappings (on-chain storage)
    mapping profile_pubkey: field => (field, field);  // address_hash => (pubkey_part1, pubkey_part2)
    mapping dialog_last_block: field => u32;           // dialog_hash => last_block_height
    mapping contacts: field => field;                  // user_hash => contact_hash

    // Transitions (функції)
    async transition register_profile(
        public encryption_key_part1: field,
        public encryption_key_part2: field
    ) -> Future {
        return finalize_register_profile(self.caller, encryption_key_part1, encryption_key_part2);
    }

    async function finalize_register_profile(
        caller: address,
        key_part1: field,
        key_part2: field
    ) {
        let caller_hash: field = BHP256::hash_to_field(caller);
        profile_pubkey.set(caller_hash, (key_part1, key_part2));
    }

    async transition send_message(
        public recipient: address,
        public content_hash: field,
        public timestamp: u64
    ) -> Future {
        let sender_hash: field = BHP256::hash_to_field(self.caller);
        let recipient_hash: field = BHP256::hash_to_field(recipient);
        let dialog_hash: field = compute_dialog_hash(sender_hash, recipient_hash);

        return finalize_send_message(sender_hash, recipient_hash, dialog_hash, content_hash, timestamp);
    }

    async function finalize_send_message(
        sender_hash: field,
        recipient_hash: field,
        dialog_hash: field,
        content_hash: field,
        timestamp: u64
    ) {
        // Записати блок як останній у діалозі
        dialog_last_block.set(dialog_hash, block.height);
    }
}
```

### Компоненти Системи

#### On-Chain Components

```typescript
// 1. Smart Contract Transitions
interface Transition {
  id: string;                    // Transaction ID
  program: string;               // "ghost_msg.aleo"
  function: string;              // "send_message"
  inputs: any[];                 // Function arguments
  outputs: any[];                // Return values
  block_height: number;          // Block number
  timestamp: number;             // Block timestamp
  status: 'accepted' | 'rejected';
}

// 2. On-Chain Mappings
interface Mappings {
  // Профілі: address_hash => encryption_public_key
  profile_pubkey: Map<Field, [Field, Field]>;

  // Останній блок діалогу: dialog_hash => block_height
  dialog_last_block: Map<Field, u32>;

  // Контакти: user_hash => contact_hash
  contacts: Map<Field, Field>;
}
```

#### Off-Chain Components

```typescript
// 1. IndexedDB Storage (Primary Storage)
class BlockchainMessageStorage {
  db: IDBDatabase;

  // Зберігає повні повідомлення локально
  async saveMessage(msg: {
    id: string;                    // Transaction ID
    dialogHash: string;
    sender: string;
    recipient: string;
    encryptedPayload: string;      // Encrypted message text
    timestamp: number;
    blockHeight: number;
    status: 'pending' | 'confirmed';
  }): Promise<void>;

  // Завантажує з локального сховища
  async getDialogMessages(dialogHash: string): Promise<Message[]>;
}

// 2. Blockchain Sync Service
class BlockchainSyncService {
  async scanBlockchain(
    userAddress: string,
    fromBlock: number,
    toBlock: number
  ): Promise<Transaction[]> {
    // Сканує Aleo Explorer API
    const transactions = await aleoExplorer.getTransactions({
      program: 'ghost_msg.aleo',
      function: 'send_message',
      block_range: [fromBlock, toBlock]
    });

    // Фільтрує тільки транзакції користувача
    return transactions.filter(tx =>
      tx.inputs.includes(userAddressHash) ||
      tx.inputs.includes(hashAddress(userAddress))
    );
  }

  async rebuildFromBlockchain(userAddress: string): Promise<void> {
    // Перебудувати IndexedDB з blockchain
    const messages = await this.scanBlockchain(userAddress, 0, 'latest');
    await indexedDB.saveMessages(messages);
  }
}

// 3. Transaction Builder
class TransactionBuilder {
  async buildSendMessage(
    recipient: string,
    encryptedPayload: string,
    timestamp: number
  ): Promise<Transaction> {
    const contentHash = BHP256.hash(encryptedPayload);

    return {
      program: 'ghost_msg.aleo',
      function: 'send_message',
      inputs: [
        recipient,                // address
        contentHash,              // field
        BigInt(timestamp)         // u64
      ]
    };
  }
}
```

### Потік Відправки Повідомлення

```
┌──────────────────────────────────────────────────────────────┐
│           ВІДПРАВКА ПОВІДОМЛЕННЯ (BLOCKCHAIN)                 │
└──────────────────────────────────────────────────────────────┘

[Client A]              [Shield Wallet]         [Aleo Blockchain]    [Client B]
    │                       │                        │                │
    │ 1. Введення тексту   │                        │                │
    │    "Hello!"           │                        │                │
    │                       │                        │                │
    │ 2. Шифрування E2E    │                        │                │
    │    encrypted_payload  │                        │                │
    │    content_hash       │                        │                │
    │                       │                        │                │
    │ 3. Створити TX       │                        │                │
    │    send_message(      │                        │                │
    │      recipient,       │                        │                │
    │      content_hash,    │                        │                │
    │      timestamp        │                        │                │
    │    )                  │                        │                │
    │                       │                        │                │
    │ 4. Request TX sign   │                        │                │
    │──────────────────────>│                        │                │
    │                       │                        │                │
    │                       │ 5. Wallet popup        │                │
    │                       │    User approves       │                │
    │                       │                        │                │
    │                       │ 6. Sign & broadcast TX │                │
    │                       │───────────────────────>│                │
    │                       │                        │                │
    │                       │                        │ 7. Validate TX │
    │                       │                        │    Execute     │
    │                       │                        │    transition  │
    │                       │                        │                │
    │                       │<──────TX confirmed─────│                │
    │<──────TX ID───────────│                        │                │
    │                       │                        │                │
    │ 8. Зберегти локально │                        │                │
    │    IndexedDB.save(    │                        │                │
    │      id: txId,        │                        │                │
    │      encrypted_payload│                        │                │
    │    )                  │                        │                │
    │                       │                        │                │
    │ 9. UI update          │                        │                │
    │    Show "pending"     │                        │                │
    │                       │                        │                │
    │                       │                        │ 10. Block      │
    │                       │                        │     mined      │
    │                       │                        │     (15-30s)   │
    │                       │                        │                │
    │ 11. Poll/WS notify    │                        │                │
    │<──────"confirmed"─────│                        │                │
    │                       │                        │                │
    │ 12. Status → confirmed│                        │                │
    │                       │                        │                │
    │                       │                        │                │
    │                       │                        │                │ 13. Client B
    │                       │                        │                │     scans
    │                       │                        │                │     blockchain
    │                       │                        │<───RPC poll────│
    │                       │                        │                │
    │                       │                        │──transitions──>│
    │                       │                        │                │
    │ [Optional WebSocket для instant notification]                  │
    │──────────────{msg_sent via backend}────────────────────────────>│
    │                       │                        │                │
    │                       │                        │                │ 14. Fetch encrypted
    │                       │                        │                │     payload
    │                       │                        │                │     (from sender's
    │                       │                        │                │      IndexedDB via
    │                       │                        │                │      backend API)
    │<──────────────────────────encrypted_payload────────────────────│
    │                       │                        │                │
    │                       │                        │                │ 15. Decrypt
    │                       │                        │                │     Display
    │                       │                        │                │

⏱️ Час доставки: 15-60 секунд (block time) + polling interval
⏱️ З WebSocket helper: 1-3 секунди (off-chain notification)
💰 Вартість: ~0.001-0.01 Aleo credits per transaction
```

### Детальний Розбір Потоку

#### 1. Client A: Підготовка та Відправка

```typescript
async function sendMessageOnChain(
  recipientAddress: string,
  text: string
) {
  // 1.1. Генерація даних
  const timestamp = Date.now();
  const tempId = `temp_${timestamp}`;

  // 1.2. Завантажити публічний ключ отримувача
  const recipientProfile = await fetchProfileFromBlockchain(recipientAddress);
  const recipientPubKey = recipientProfile.encryption_public_key;

  // 1.3. Шифрування E2E
  const encryptedPayload = encryptMessage(text, recipientPubKey, mySecretKey);

  // 1.4. Обчислення хешу для on-chain proof
  const contentHash = BHP256.hash(encryptedPayload);

  // 1.5. Optimistic UI update (показати одразу)
  await indexedDBStorage.saveMessage({
    id: tempId,
    dialogHash: computeDialogHash(myAddress, recipientAddress),
    sender: myAddress,
    recipient: recipientAddress,
    encryptedPayload,
    timestamp,
    status: 'pending'
  });

  addMessageToUI({
    id: tempId,
    text,
    status: 'pending',
    timestamp
  });

  // 1.6. Викликати Shield Wallet для підпису транзакції
  try {
    const txId = await wallet.requestTransaction({
      program: 'ghost_msg.aleo',
      function: 'send_message',
      inputs: [
        recipientAddress,          // address
        contentHash,               // field (BHP256 hash)
        BigInt(timestamp)          // u64
      ]
    });

    // 1.7. Оновити статус на "confirmed"
    await indexedDBStorage.updateMessage(tempId, {
      id: txId,
      status: 'confirmed'
    });

    updateMessageStatus(tempId, 'confirmed', txId);

    // 1.8. (Optional) Відправити encrypted payload через backend
    //      щоб отримувач міг одразу завантажити, не чекаючи blockchain sync
    await backendAPI.uploadEncryptedMessage({
      txId,
      encryptedPayload,
      recipientHash: hashAddress(recipientAddress)
    });

  } catch (error) {
    // Користувач відхилив транзакцію
    await indexedDBStorage.updateMessage(tempId, { status: 'failed' });
    updateMessageStatus(tempId, 'failed');
    throw error;
  }
}
```

#### 2. Blockchain: Виконання Smart Contract

```leo
// Виконується на валідаторах Aleo
async transition send_message(
    public recipient: address,
    public content_hash: field,
    public timestamp: u64
) -> Future {
    // 2.1. Обчислити хеші
    let sender_hash: field = BHP256::hash_to_field(self.caller);
    let recipient_hash: field = BHP256::hash_to_field(recipient);

    // 2.2. Обчислити dialog_hash (мінімальний порядок для consistency)
    let dialog_hash: field = sender_hash < recipient_hash
        ? BHP256::hash_to_field((sender_hash, recipient_hash))
        : BHP256::hash_to_field((recipient_hash, sender_hash));

    // 2.3. Запустити async finalize
    return finalize_send_message(
        sender_hash,
        recipient_hash,
        dialog_hash,
        content_hash,
        timestamp
    );
}

// Виконується після підтвердження блоку
async function finalize_send_message(
    sender_hash: field,
    recipient_hash: field,
    dialog_hash: field,
    content_hash: field,
    timestamp: u64
) {
    // 2.4. Записати в mapping останній блок для діалогу
    //      (це дозволяє швидко знайти нові повідомлення)
    dialog_last_block.set(dialog_hash, block.height);

    // 2.5. Також можна зберегти proof у mapping (optional)
    // message_proofs.set(content_hash, MessageProof {
    //     sender_hash,
    //     recipient_hash,
    //     content_hash,
    //     timestamp
    // });
}
```

#### 3. Client B: Сканування та Отримання

```typescript
// Варіант 3A: Polling Blockchain (без backend)
async function pollForNewMessages() {
  const myAddressHash = hashAddress(myAddress);

  while (true) {
    // 3.1. Запит до Aleo Explorer API
    const latestBlock = await aleoExplorer.getLatestBlock();
    const lastScannedBlock = await indexedDBStorage.getLastScannedBlock();

    if (latestBlock.height > lastScannedBlock) {
      // 3.2. Завантажити транзакції з нових блоків
      const transactions = await aleoExplorer.getTransactions({
        program: 'ghost_msg.aleo',
        function: 'send_message',
        block_range: [lastScannedBlock + 1, latestBlock.height]
      });

      // 3.3. Фільтрувати тільки повідомлення для мене
      const myMessages = transactions.filter(tx => {
        const recipientHash = tx.inputs[1]; // recipient_hash
        return recipientHash === myAddressHash;
      });

      // 3.4. Для кожного повідомлення:
      for (const tx of myMessages) {
        const senderAddress = tx.caller;
        const contentHash = tx.inputs[1];
        const timestamp = tx.inputs[2];

        // 3.5. Завантажити encrypted payload
        //      (два варіанти)

        // Варіант A: З backend API (fast)
        const encryptedPayload = await backendAPI.getEncryptedMessage(tx.id);

        // Варіант B: P2P з відправника через WebRTC/libp2p (slow)
        // const encryptedPayload = await p2p.requestMessage(senderAddress, tx.id);

        // 3.6. Розшифрувати
        const senderProfile = await fetchProfileFromBlockchain(senderAddress);
        const decrypted = decryptMessage(
          encryptedPayload,
          senderProfile.encryption_public_key,
          mySecretKey
        );

        // 3.7. Зберегти в IndexedDB
        await indexedDBStorage.saveMessage({
          id: tx.id,
          dialogHash: computeDialogHash(senderAddress, myAddress),
          sender: senderAddress,
          recipient: myAddress,
          encryptedPayload,
          decryptedText: decrypted,
          timestamp: Number(timestamp),
          blockHeight: tx.block_height,
          status: 'confirmed'
        });

        // 3.8. UI update
        addMessageToUI({
          id: tx.id,
          text: decrypted,
          isMine: false,
          timestamp: Number(timestamp),
          status: 'confirmed'
        });
      }

      // 3.9. Оновити lastScannedBlock
      await indexedDBStorage.setLastScannedBlock(latestBlock.height);
    }

    // 3.10. Почекати перед наступним poll
    await sleep(30000); // 30 секунд
  }
}

// Варіант 3B: WebSocket Notification (з backend helper)
function handleBlockchainNotification(data: any) {
  // Backend відправив нотифікацію про нову транзакцію
  // Одразу завантажити та показати
  const { txId, encryptedPayload, sender, timestamp } = data;

  // Розшифрувати та показати (аналогічно до Варіанту A)
  const decrypted = decryptMessage(encryptedPayload, senderPubKey, mySecretKey);
  addMessageToUI({ id: txId, text: decrypted, ... });
}
```

### Гібридна Модель (Optimal для Ghost Messenger)

```
┌───────────────────────────────────────────────────────────────┐
│                    HYBRID ARCHITECTURE                         │
│                                                                │
│  ┌─────────────┐         ┌──────────────┐                    │
│  │  IndexedDB  │◄────────┤   Backend    │                    │
│  │  (Primary)  │         │   (Helper)   │                    │
│  └─────────────┘         └──────────────┘                    │
│        ▲                        ▲                             │
│        │                        │                             │
│        │   WebSocket            │ REST API                    │
│        │   (instant)            │ (sync)                      │
│        │                        │                             │
│  ┌─────┴────────────────────────┴─────┐                      │
│  │          Frontend Client           │                      │
│  └────────────────────────────────────┘                      │
│                    │                                          │
│                    │ Transaction                              │
│                    │ Broadcasting                             │
│                    ▼                                          │
│         ┌──────────────────────┐                             │
│         │  Aleo Blockchain     │                             │
│         │  (Immutable Proof)   │                             │
│         └──────────────────────┘                             │
│                                                                │
│  Data Flow:                                                   │
│  1. Message sent → WebSocket (instant preview)                │
│  2. Message sent → Blockchain (immutable proof)               │
│  3. Message stored → IndexedDB (persistent local)             │
│  4. Message synced → Backend (cross-device)                   │
└───────────────────────────────────────────────────────────────┘
```

**Переваги гібридної моделі:**

✅ **Швидкість**: WebSocket забезпечує instant delivery (200ms)
✅ **Персистентність**: IndexedDB зберігає локально
✅ **Immutability**: Blockchain забезпечує незмінність
✅ **Приватність**: E2E шифрування, тільки хеші on-chain
✅ **Відновлення**: Можливість rebuild з blockchain
✅ **Offline**: Працює без інтернету (через IndexedDB)

### Переваги Варіанту Б (Pure Blockchain)

✅ **Децентралізація**: Немає single point of failure
✅ **Незмінність**: Повідомлення не можна видалити/змінити
✅ **Прозорість**: Всі транзакції публічні та верифіковані
✅ **Цензуростійкість**: Неможливо заблокувати
✅ **Довіра**: Не потрібно довіряти серверу
✅ **Приватність**: Тільки хеші on-chain, encrypted payloads off-chain

### Недоліки Варіанту Б

❌ **Latency**: 15-60 секунд на підтвердження блоку
❌ **Вартість**: Кожне повідомлення = транзакція (fees)
❌ **Складність**: Потребує wallet підключення
❌ **UX**: Користувач повинен підтверджувати кожну TX
❌ **Обмеженість**: Немає typing indicators, read receipts
❌ **Скейлінг**: Обмеження throughput blockchain
❌ **Залежність**: Потрібен працюючий blockchain network

### Складність Реалізації

⭐⭐⭐⭐⭐ **5/5** - Висока складність

**Easy:**
- IndexedDB для локального storage
- E2E encryption (NaCl)

**Medium:**
- Leo smart contract розробка
- Wallet adapter integration
- Transaction building

**Hard:**
- Blockchain scanning/indexing
- Cross-device sync без backend
- Handling pending/failed transactions
- Gas fee optimization

**Very Hard:**
- P2P encrypted payload distribution (без backend)
- Offline message queue
- Multi-signature group chats
- ZK proofs для приватності метаданих

**Час розробки:** 4-6 місяців (2-3 blockchain developers)

---

## Порівняння Архітектур

### Таблиця Порівняння

| Параметр | Варіант А (WebSocket) | Варіант Б (Blockchain) | Гібрид (Ghost) |
|----------|----------------------|------------------------|----------------|
| **Latency** | 50-500ms | 15-60 sec | 200ms (WS) + 30s (proof) |
| **Throughput** | 10,000+ msg/sec | 100-1000 tx/sec | 5,000 msg/sec |
| **Вартість повідомлення** | ~$0 | $0.001-0.01 | $0 (optional proof) |
| **Децентралізація** | ❌ Централізована | ✅ Повністю | ⚠️ Гібрид |
| **Незмінність** | ❌ Можна видалити | ✅ Immutable | ✅ Proof immutable |
| **Приватність метаданих** | ❌ Сервер бачить | ✅ Тільки хеші | ⚠️ Backend бачить |
| **Offline робота** | ❌ Потрібен WS | ✅ IndexedDB | ✅ IndexedDB |
| **Read receipts** | ✅ Легко | ❌ Складно | ✅ Off-chain |
| **Typing indicators** | ✅ Легко | ❌ Неможливо | ✅ Off-chain |
| **Group chats** | ✅ Легко | ⚠️ Складно | ✅ Легко |
| **Складність розробки** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Час розробки** | 2-3 місяці | 4-6 місяців | 3-4 місяці |
| **Hosting вартість** | $20-100/міс | $0 (P2P) або $50/міс (helper) | $30-80/міс |
| **UX складність** | ⭐ Easy | ⭐⭐⭐⭐⭐ Hard | ⭐⭐⭐ Medium |

### Use Cases

#### Коли використовувати Варіант А (WebSocket):

✅ **Consumer месенджер** (WhatsApp, Telegram альтернатива)
✅ **Enterprise chat** (Slack, Teams альтернатива)
✅ **Customer support** (Live chat)
✅ **Gaming chat** (швидка комунікація)
✅ **Dating apps** (high volume messaging)

**Приклади:**
- Стартап з обмеженим бюджетом
- Потрібна швидкість та простота
- Typing indicators, read receipts критичні
- Багато повідомлень (вартість blockchain занадто висока)

#### Коли використовувати Варіант Б (Blockchain):

✅ **Юридична комунікація** (потрібен immutable record)
✅ **Фінансові угоди** (proof of communication)
✅ **Whistleblower платформи** (цензуростійкість)
✅ **Decentralized social** (Web3 messaging)
✅ **Audit trails** (compliance, регуляторні вимоги)

**Приклади:**
- DAO governance обговорення
- Smart contract-based escrow chat
- Медичні консультації (HIPAA compliance)
- Політичні активісти в країнах з цензурою

#### Коли використовувати Гібрид:

✅ **Privacy-focused messenger** з blockchain proof
✅ **Crypto communities** (Web3 natives)
✅ **NFT/DeFi platforms** з вбудованим чатом
✅ **Transparent messaging** (журналістика, дослідження)

**Приклади:**
- Ghost Messenger (поточна реалізація)
- Crypto wallet з built-in messaging
- DeFi protocol з governance chat

---

## Приклади Потоків

### Scenario 1: Send Message (Варіант А)

```typescript
// 1. User types "Hello" and hits send
const handleSend = async (text: string) => {
  // 2. Client A: Encrypt & send via WebSocket
  const encrypted = encrypt(text, recipientPubKey);
  ws.send({ type: 'dm_send', payload: encrypted });

  // 3. Backend: Receive, validate, store
  await db.messages.insert({ sender, recipient, encrypted });

  // 4. Backend: Broadcast to recipient
  recipientWS.send({ type: 'message', payload: encrypted });

  // 5. Client B: Receive, decrypt, display
  const decrypted = decrypt(encrypted, mySecretKey);
  addMessage(decrypted); // ✅ Показати "Hello"

  // ⏱️ Total time: 200ms
};
```

### Scenario 2: Send Message (Варіант Б)

```typescript
// 1. User types "Hello" and hits send
const handleSend = async (text: string) => {
  // 2. Client A: Encrypt & build transaction
  const encrypted = encrypt(text, recipientPubKey);
  const hash = BHP256.hash(encrypted);

  // 3. Request wallet signature (popup)
  const txId = await wallet.signTransaction({
    program: 'ghost_msg.aleo',
    function: 'send_message',
    inputs: [recipient, hash, timestamp]
  });

  // 4. Broadcast to blockchain
  await aleo.broadcastTransaction(txId);

  // 5. Wait for block confirmation (15-30s)
  await waitForConfirmation(txId);

  // 6. Client B: Poll blockchain for new messages
  const newMessages = await scanBlockchain(myAddress);

  // 7. Client B: Fetch encrypted payload (from IPFS or backend)
  const encrypted = await fetchPayload(txId);

  // 8. Decrypt and display
  const decrypted = decrypt(encrypted, mySecretKey);
  addMessage(decrypted); // ✅ Показати "Hello"

  // ⏱️ Total time: 30-60 seconds
};
```

### Scenario 3: Send Message (Гібрид - Ghost)

```typescript
// 1. User types "Hello" and hits send
const handleSend = async (text: string) => {
  // 2. Client A: Encrypt
  const encrypted = encrypt(text, recipientPubKey);
  const hash = BHP256.hash(encrypted);

  // 3. Request blockchain transaction (optional, in background)
  const blockchainProof = settings.blockchainProof;
  let txId: string | undefined;

  if (blockchainProof) {
    // Non-blocking wallet popup
    wallet.signTransaction({
      program: 'ghost_msg.aleo',
      function: 'send_message',
      inputs: [recipient, hash, timestamp]
    }).then(id => txId = id);
  }

  // 4. Send via WebSocket (instant)
  ws.send({
    type: 'dm_send',
    payload: {
      encrypted,
      timestamp,
      hash
    }
  });

  // 5. Backend: Store + broadcast
  await db.messages.insert({ sender, recipient, encrypted });
  recipientWS.send({ type: 'message', payload: encrypted });

  // 6. Client B: Receive & display immediately
  const decrypted = decrypt(encrypted, mySecretKey);
  addMessage({ text: decrypted, status: 'sent' }); // ⚡ Instant

  // 7. Later: Blockchain confirms (30s)
  if (txId) {
    await waitForConfirmation(txId);
    updateMessage({ status: 'immutable', txId }); // 🔒 Blockchain proof
  }

  // ⏱️ Instant display (200ms) + optional proof (30s)
};
```

---

## Рекомендації

### Для Стартапів

**Початок:** Варіант А (WebSocket)
**Причина:** Швидкість розробки, низька вартість, знайомий UX
**Еволюція:** Додати blockchain proof як premium feature

### Для Web3 Проектів

**Початок:** Гібрид (Ghost модель)
**Причина:** Blockchain proof + реальний час
**Фокус:** Позиціонування як "immutable messaging"

### Для Enterprise

**Початок:** Варіант А з audit logging
**Причина:** Compliance, контроль, integration з existing systems
**Альтернатива:** Private blockchain (Hyperledger, Corda)

### Для Privacy Activists

**Початок:** Варіант Б (Pure blockchain)
**Причина:** Цензуростійкість, не потрібен довіра до сервера
**Фокус:** P2P distribution, Tor integration

---

## Висновок

**Варіант А (WebSocket)**: Класика. Швидко, дешево, просто. Підходить для 90% use cases.

**Варіант Б (Blockchain)**: Інновація. Decentralized, immutable, censorship-resistant. Складно, дорого, але унікальний value proposition.

**Гібрид (Ghost)**: Найкраще з обох світів. Instant delivery + blockchain proof. Ідеально для Web3 комʼюніті.

**Вибір залежить від:**
- Цільової аудиторії (Web2 vs Web3)
- Бюджету розробки
- Вимог до швидкості
- Потреби у decentralization
- Regulatory compliance

Для більшості випадків **гібридна модель** є оптимальною — вона поєднує user-friendly UX класичного месенджера з blockchain гарантіями приватності та незмінності.
