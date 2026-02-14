import './style.css';
import { getOrCreateKeys, encryptForRecipient, decryptFromSender, deriveRoomKey, encryptRoom, decryptRoom, KeyPair } from './crypto';
import { GhostWS } from './ws-client';
import { createSecretMessage, readSecretMessage, verifySecretHash } from './secret';
import { fetchRooms, fetchRoomMessages, fetchDMMessages, fetchChannels, fetchGroups, verifyAleoHash } from './api';

// ── State ──────────────────────────────────────────

let myKeys: KeyPair;
let myUserId = '';
let myUsername = '';
const users = new Map<string, { id: string; username: string; publicKey: string }>();
const channels = new Map<string, { id: string; name: string; type: 'channel'; createdBy?: string }>();
const groups = new Map<string, { id: string; name: string; type: 'group'; createdBy?: string }>();
const roomKeys = new Map<string, string>(); // roomId → derived key (base64)

type TabType = 'messages' | 'channels' | 'groups';
let activeTab: TabType = 'messages';
let activeChat: { type: 'dm' | 'channel' | 'group'; id: string; name: string } | null = null;
let pendingSecrets = new Map<string, { id: string; senderId: string; aleoHash: string }>();
let joiningRoomId = '';
let joiningRoomType: 'channel' | 'group' = 'channel';

const WS_URL = location.protocol === 'https:' ? `wss://${location.host}` : `ws://${location.hostname}:3001`;
const ws = new GhostWS(WS_URL);

// ── DOM References ──────────────────────────────────

const $ = (sel: string) => document.querySelector(sel)!;
const loginScreen = $('#login-screen') as HTMLElement;
const appScreen = $('#app-screen') as HTMLElement;
const loginInput = $('#login-username') as HTMLInputElement;
const loginBtn = $('#login-btn') as HTMLButtonElement;
const connDot = $('#conn-status') as HTMLElement;
const myNameEl = $('#my-username') as HTMLElement;

// List panel
const messagesListView = $('#messages-list-view') as HTMLElement;
const channelsListView = $('#channels-list-view') as HTMLElement;
const groupsListView = $('#groups-list-view') as HTMLElement;
const usersList = $('#users-list') as HTMLElement;
const channelsList = $('#channels-list') as HTMLElement;
const groupsList = $('#groups-list') as HTMLElement;

// Chat area
const chatEmpty = $('#chat-empty') as HTMLElement;
const chatActive = $('#chat-active') as HTMLElement;
const chatTitle = $('#chat-title') as HTMLElement;
const messagesEl = $('#messages') as HTMLElement;
const msgForm = $('#message-form') as HTMLFormElement;
const msgInput = $('#message-input') as HTMLInputElement;
const typingEl = $('#typing-indicator') as HTMLElement;
const typingUserEl = $('#typing-user') as HTMLElement;
const leaveBtn = $('#leave-room-btn') as HTMLElement;
const deleteRoomBtn = $('#delete-room-btn') as HTMLElement;
const clearDmBtn = $('#clear-dm-btn') as HTMLElement;

// ── Login ──────────────────────────────────────────

loginBtn.onclick = () => doLogin();
loginInput.onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };

function doLogin() {
  const username = loginInput.value.trim();
  if (!username) return;

  myUsername = username;
  myKeys = getOrCreateKeys(username);

  ws.connect();
  ws.on('_connected', () => {
    ws.send({ type: 'auth', username, publicKey: myKeys.publicKey });
  });

  loginBtn.disabled = true;
  loginBtn.textContent = 'Connecting...';
}

// ── WS Events ──────────────────────────────────────

ws.on('auth_ok', (data) => {
  myUserId = data.userId;
  myNameEl.textContent = myUsername;

  for (const u of data.users) {
    users.set(u.id, u);
  }

  loginScreen.classList.remove('active');
  appScreen.classList.add('active');
  connDot.classList.add('online');

  loadChannels();
  loadGroups();
  renderUsers();
});

ws.on('room_list', (data: any) => {
  for (const r of data.rooms) {
    if (r.type === 'channel') {
      channels.set(r.id, { id: r.id, name: r.name, type: 'channel', createdBy: r.createdBy });
    } else if (r.type === 'group') {
      groups.set(r.id, { id: r.id, name: r.name, type: 'group', createdBy: r.createdBy });
    }
  }
  renderChannels();
  renderGroups();
});

ws.on('error', (data) => {
  console.error('[Ghost]', data.message);
  loginBtn.disabled = false;
  loginBtn.textContent = 'Connect';
});

ws.on('user_joined', (data) => {
  users.set(data.user.id, data.user);
  renderUsers();
});

ws.on('user_left', (data) => {
  users.delete(data.userId);
  renderUsers();
});

ws.on('room_created', (data) => {
  const room = data.room;
  if (room.type === 'channel') {
    channels.set(room.id, { id: room.id, name: room.name, type: 'channel', createdBy: room.createdBy });
    renderChannels();
  } else if (room.type === 'group') {
    groups.set(room.id, { id: room.id, name: room.name, type: 'group', createdBy: room.createdBy });
    renderGroups();
  }
});

ws.on('room_joined', () => {
  renderChannels();
  renderGroups();
});

ws.on('room_left', (data) => {
  if (channels.has(data.roomId)) renderChannels();
  if (groups.has(data.roomId)) renderGroups();
});

ws.on('room_deleted', (data: any) => {
  const roomId = data.roomId;
  channels.delete(roomId);
  groups.delete(roomId);
  roomKeys.delete(roomId);
  localStorage.removeItem(`ghost_roomkey_${roomId}`);
  renderChannels();
  renderGroups();

  if (activeChat && (activeChat.type === 'channel' || activeChat.type === 'group') && activeChat.id === roomId) {
    activeChat = null;
    chatActive.classList.add('hidden');
    chatEmpty.style.display = '';
    leaveBtn.classList.add('hidden');
    deleteRoomBtn.classList.add('hidden');
  }
});

ws.on('dm_cleared', (data: any) => {
  if (activeChat && activeChat.type === 'dm' && activeChat.id === data.recipientId) {
    messagesEl.innerHTML = '';
    appendSystemMessage('Chat history cleared');
  }
});

ws.on('message', (data) => {
  const msg = data.message;
  if (activeChat) {
    const isRoom = (activeChat.type === 'channel' || activeChat.type === 'group') && msg.roomId === activeChat.id;
    const isDM = activeChat.type === 'dm' && (msg.senderId === activeChat.id || msg.recipientId === activeChat.id || msg.senderId === myUserId);

    if (isRoom || isDM) {
      appendMessage(msg);
    }
  }
});

ws.on('typing', (data) => {
  const user = users.get(data.userId);
  if (user) {
    typingUserEl.textContent = user.username;
    typingEl.classList.remove('hidden');
    clearTimeout((typingEl as any)._timeout);
    (typingEl as any)._timeout = setTimeout(() => typingEl.classList.add('hidden'), 3000);
  }
});

ws.on('secret_available', (data) => {
  pendingSecrets.set(data.id, data);
  const sender = users.get(data.senderId);
  if (activeChat && activeChat.type === 'dm' && activeChat.id === data.senderId) {
    showSecretNotification(data.id, sender?.username || 'Someone');
  }
});

ws.on('secret_data', (data) => {
  const secret = data.message;
  try {
    const plaintext = readSecretMessage(secret.payload, secret.nonce, secret.ephemeralPk, myKeys.secretKey);
    showSecretReadModal(plaintext, secret.aleoHash);
  } catch (e) {
    alert('Failed to decrypt secret message');
  }
});

ws.on('secret_read', () => {
  appendSystemMessage('🔥 Your secret message was read and destroyed');
});

ws.on('_disconnected', () => {
  connDot.classList.remove('online');
});

ws.on('_connected', () => {
  connDot.classList.add('online');
});

// ── Navigation ──────────────────────────────────────

document.querySelectorAll('#nav-bar .nav-icon[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = (btn as HTMLElement).dataset.tab as TabType;
    switchTab(tab);
  });
});

function switchTab(tab: TabType) {
  activeTab = tab;

  // Update nav icons
  document.querySelectorAll('#nav-bar .nav-icon[data-tab]').forEach(b => b.classList.remove('active'));
  document.querySelector(`#nav-bar .nav-icon[data-tab="${tab}"]`)?.classList.add('active');

  // Update list views
  messagesListView.classList.remove('active');
  channelsListView.classList.remove('active');
  groupsListView.classList.remove('active');

  if (tab === 'messages') messagesListView.classList.add('active');
  else if (tab === 'channels') channelsListView.classList.add('active');
  else if (tab === 'groups') groupsListView.classList.add('active');
}

// ── Channels ──────────────────────────────────────

async function loadChannels() {
  try {
    const list = await fetchChannels();
    for (const r of list) {
      channels.set(r.id, { id: r.id, name: r.name, type: 'channel' });
    }
    renderChannels();
  } catch { /* ignore */ }
}

function renderChannels() {
  channelsList.innerHTML = '';
  for (const [id, ch] of channels) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="icon">📢</span><span class="name">${esc(ch.name)}</span>`;
    li.onclick = () => selectChannel(id);
    if (activeChat?.type === 'channel' && activeChat.id === id) li.classList.add('active');
    channelsList.appendChild(li);
  }
}

function selectChannel(channelId: string) {
  const ch = channels.get(channelId);
  if (!ch) return;

  if (!roomKeys.has(channelId)) {
    joiningRoomId = channelId;
    joiningRoomType = 'channel';
    ($('#join-modal-title') as HTMLElement).textContent = 'Join Channel';
    showJoinModal();
    return;
  }

  activeChat = { type: 'channel', id: channelId, name: ch.name };
  chatTitle.textContent = `📢 ${ch.name}`;
  chatEmpty.style.display = 'none';
  chatActive.classList.remove('hidden');
  leaveBtn.classList.remove('hidden');
  clearDmBtn.classList.add('hidden');
  deleteRoomBtn.classList.toggle('hidden', ch.createdBy !== myUserId);
  messagesEl.innerHTML = '';
  renderChannels();
  renderGroups();
  renderUsers();

  loadRoomHistory(channelId);
}

// ── Groups ──────────────────────────────────────

async function loadGroups() {
  try {
    const list = await fetchGroups(myUserId);
    for (const r of list) {
      groups.set(r.id, { id: r.id, name: r.name, type: 'group' });
    }
    renderGroups();
  } catch { /* ignore */ }
}

function renderGroups() {
  groupsList.innerHTML = '';
  for (const [id, gr] of groups) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="icon">👥</span><span class="name">${esc(gr.name)}</span>`;
    li.onclick = () => selectGroup(id);
    if (activeChat?.type === 'group' && activeChat.id === id) li.classList.add('active');
    groupsList.appendChild(li);
  }
}

function selectGroup(groupId: string) {
  const gr = groups.get(groupId);
  if (!gr) return;

  if (!roomKeys.has(groupId)) {
    joiningRoomId = groupId;
    joiningRoomType = 'group';
    ($('#join-modal-title') as HTMLElement).textContent = 'Join Group';
    showJoinModal();
    return;
  }

  activeChat = { type: 'group', id: groupId, name: gr.name };
  chatTitle.textContent = `👥 ${gr.name}`;
  chatEmpty.style.display = 'none';
  chatActive.classList.remove('hidden');
  leaveBtn.classList.remove('hidden');
  clearDmBtn.classList.add('hidden');
  deleteRoomBtn.classList.toggle('hidden', gr.createdBy !== myUserId);
  messagesEl.innerHTML = '';
  renderChannels();
  renderGroups();
  renderUsers();

  loadRoomHistory(groupId);
}

// ── Users / DM ──────────────────────────────────────

function renderUsers() {
  usersList.innerHTML = '';
  for (const [id, user] of users) {
    if (id === myUserId) continue;
    const li = document.createElement('li');
    li.innerHTML = `<span class="icon">👤</span><span class="name">${esc(user.username)}</span>`;
    li.onclick = () => selectDM(id);
    if (activeChat?.type === 'dm' && activeChat.id === id) li.classList.add('active');
    usersList.appendChild(li);
  }
}

function selectDM(userId: string) {
  const user = users.get(userId);
  if (!user) return;

  activeChat = { type: 'dm', id: userId, name: user.username };
  chatTitle.textContent = `🔒 ${user.username}`;
  chatEmpty.style.display = 'none';
  chatActive.classList.remove('hidden');
  leaveBtn.classList.add('hidden');
  deleteRoomBtn.classList.add('hidden');
  clearDmBtn.classList.remove('hidden');
  messagesEl.innerHTML = '';
  renderChannels();
  renderGroups();
  renderUsers();

  loadDMHistory(userId);

  for (const [sid, s] of pendingSecrets) {
    if (s.senderId === userId) {
      showSecretNotification(sid, user.username);
    }
  }
}

// ── Room History ──────────────────────────────────────

async function loadRoomHistory(roomId: string) {
  try {
    const msgs = await fetchRoomMessages(roomId);
    for (const msg of msgs) appendMessage(msg);
  } catch { /* ignore */ }
}

async function loadDMHistory(userId: string) {
  try {
    const msgs = await fetchDMMessages(myUserId, userId);
    for (const msg of msgs) appendMessage(msg);
  } catch { /* ignore */ }
}

// ── Sending Messages ──────────────────────────────

msgForm.onsubmit = (e) => {
  e.preventDefault();
  const text = msgInput.value.trim();
  if (!text || !activeChat) return;

  if (activeChat.type === 'dm') {
    const recipient = users.get(activeChat.id);
    if (!recipient) return;
    const { payload, nonce } = encryptForRecipient(text, recipient.publicKey, myKeys.secretKey);
    ws.send({ type: 'message', recipientId: activeChat.id, payload, nonce });
  } else if (activeChat.type === 'channel' || activeChat.type === 'group') {
    const roomKey = roomKeys.get(activeChat.id);
    if (!roomKey) { alert('Missing room key'); return; }
    const { payload, nonce } = encryptRoom(text, roomKey);
    ws.send({ type: 'message', roomId: activeChat.id, payload, nonce });
  }

  msgInput.value = '';
};

// Typing indicator
let typingTimeout: number | null = null;
msgInput.oninput = () => {
  if (!activeChat) return;
  if (!typingTimeout) {
    const isRoom = activeChat.type === 'channel' || activeChat.type === 'group';
    ws.send({ type: 'typing', ...(isRoom ? { roomId: activeChat.id } : { recipientId: activeChat.id }) });
  }
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => { typingTimeout = null; }, 2000) as any;
};

// ── Message Rendering ──────────────────────────────

function appendMessage(raw: any) {
  const isMine = raw.sender_id === myUserId || raw.senderId === myUserId;
  let text = '';

  try {
    if (activeChat?.type === 'dm') {
      const otherUser = users.get(activeChat.id);
      if (otherUser) {
        text = isMine
          ? decryptFromSender(raw.payload, raw.nonce, otherUser.publicKey, myKeys.secretKey)
          : decryptFromSender(raw.payload, raw.nonce, otherUser.publicKey, myKeys.secretKey);
      }
    } else if (activeChat?.type === 'channel' || activeChat?.type === 'group') {
      const roomKey = roomKeys.get(activeChat.id);
      if (roomKey) {
        text = decryptRoom(raw.payload, raw.nonce, roomKey);
      }
    }
  } catch {
    text = '[Decryption Failed]';
  }

  if (!text) text = '[Encrypted]';

  const senderId = raw.sender_id || raw.senderId;
  const sender = users.get(senderId);
  const time = new Date(Number(raw.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const div = document.createElement('div');
  div.className = `msg ${isMine ? 'mine' : 'theirs'}`;
  div.innerHTML = `
    ${!isMine ? `<div class="sender">${esc(sender?.username || 'Unknown')}</div>` : ''}
    <div>${esc(text)}</div>
    <div class="time">${time}</div>
  `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendSystemMessage(text: string) {
  const div = document.createElement('div');
  div.className = 'msg secret-notification';
  div.innerHTML = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showSecretNotification(secretId: string, senderName: string) {
  const div = document.createElement('div');
  div.className = 'msg secret-notification';
  div.innerHTML = `🤫 <strong>${esc(senderName)}</strong> sent you a secret message. <em>Click to read (one-time only)</em>`;
  div.onclick = () => {
    ws.send({ type: 'read_secret', messageId: secretId });
    pendingSecrets.delete(secretId);
    div.remove();
  };
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Create Channel Modal ──────────────────────────

$('#create-channel-btn').addEventListener('click', () => {
  ($('#channel-modal') as HTMLElement).classList.remove('hidden');
});

$('#channel-cancel-btn').addEventListener('click', () => {
  ($('#channel-modal') as HTMLElement).classList.add('hidden');
});

$('#channel-create-btn').addEventListener('click', () => {
  const name = ($('#channel-name-input') as HTMLInputElement).value.trim();
  const pass = ($('#channel-pass-input') as HTMLInputElement).value;
  if (!name || !pass) { alert('Name and passphrase required'); return; }

  ws.send({ type: 'create_room', name, isPrivate: false, roomType: 'channel' });

  const handler = (data: any) => {
    if (data.room.type === 'channel') {
      const roomKey = deriveRoomKey(pass);
      roomKeys.set(data.room.id, roomKey);
      localStorage.setItem(`ghost_roomkey_${data.room.id}`, roomKey);
      ws.send({ type: 'join_room', roomId: data.room.id });
      ws.off('room_created', handler);

      ($('#channel-modal') as HTMLElement).classList.add('hidden');
      ($('#channel-name-input') as HTMLInputElement).value = '';
      ($('#channel-pass-input') as HTMLInputElement).value = '';
      switchTab('channels');
      selectChannel(data.room.id);
    }
  };
  ws.on('room_created', handler);
});

// ── Create Group Modal ──────────────────────────

$('#create-group-btn').addEventListener('click', () => {
  ($('#group-modal') as HTMLElement).classList.remove('hidden');
});

$('#group-cancel-btn').addEventListener('click', () => {
  ($('#group-modal') as HTMLElement).classList.add('hidden');
});

$('#group-create-btn').addEventListener('click', () => {
  const name = ($('#group-name-input') as HTMLInputElement).value.trim();
  const pass = ($('#group-pass-input') as HTMLInputElement).value;
  if (!name || !pass) { alert('Name and passphrase required'); return; }

  ws.send({ type: 'create_room', name, isPrivate: true, roomType: 'group' });

  const handler = (data: any) => {
    if (data.room.type === 'group') {
      const roomKey = deriveRoomKey(pass);
      roomKeys.set(data.room.id, roomKey);
      localStorage.setItem(`ghost_roomkey_${data.room.id}`, roomKey);
      ws.send({ type: 'join_room', roomId: data.room.id });
      ws.off('room_created', handler);

      ($('#group-modal') as HTMLElement).classList.add('hidden');
      ($('#group-name-input') as HTMLInputElement).value = '';
      ($('#group-pass-input') as HTMLInputElement).value = '';
      switchTab('groups');
      selectGroup(data.room.id);
    }
  };
  ws.on('room_created', handler);
});

// ── Join Room Modal ──────────────────────────────

function showJoinModal() {
  ($('#join-modal') as HTMLElement).classList.remove('hidden');
}

$('#join-cancel-btn').addEventListener('click', () => {
  ($('#join-modal') as HTMLElement).classList.add('hidden');
});

$('#join-confirm-btn').addEventListener('click', () => {
  const pass = ($('#join-pass-input') as HTMLInputElement).value;
  if (!pass) return;

  const roomKey = deriveRoomKey(pass);
  roomKeys.set(joiningRoomId, roomKey);
  localStorage.setItem(`ghost_roomkey_${joiningRoomId}`, roomKey);
  ws.send({ type: 'join_room', roomId: joiningRoomId });

  ($('#join-modal') as HTMLElement).classList.add('hidden');
  ($('#join-pass-input') as HTMLInputElement).value = '';

  if (joiningRoomType === 'channel') {
    selectChannel(joiningRoomId);
  } else {
    selectGroup(joiningRoomId);
  }
});

// ── Leave Room ──────────────────────────────────

leaveBtn.addEventListener('click', () => {
  if (!activeChat || activeChat.type === 'dm') return;

  ws.send({ type: 'leave_room', roomId: activeChat.id });
  roomKeys.delete(activeChat.id);
  localStorage.removeItem(`ghost_roomkey_${activeChat.id}`);

  if (activeChat.type === 'channel') {
    channels.delete(activeChat.id);
    renderChannels();
  } else {
    groups.delete(activeChat.id);
    renderGroups();
  }

  activeChat = null;
  chatActive.classList.add('hidden');
  chatEmpty.style.display = '';
  leaveBtn.classList.add('hidden');
});

// ── Delete Room ──────────────────────────────────

deleteRoomBtn.addEventListener('click', () => {
  if (!activeChat || activeChat.type === 'dm') return;
  showConfirm(
    `Delete ${activeChat.type === 'channel' ? 'Channel' : 'Group'}`,
    `Are you sure you want to delete "${activeChat.name}"? All messages will be permanently removed.`,
    () => {
      ws.send({ type: 'delete_room', roomId: activeChat!.id });
    }
  );
});

// ── Clear DM History ──────────────────────────────

clearDmBtn.addEventListener('click', () => {
  if (!activeChat || activeChat.type !== 'dm') return;
  showConfirm(
    'Clear Chat',
    `Clear all messages with ${activeChat.name}? This cannot be undone.`,
    () => {
      ws.send({ type: 'clear_dm', recipientId: activeChat!.id });
    }
  );
});

// ── Confirm Modal ──────────────────────────────────

let confirmCallback: (() => void) | null = null;

function showConfirm(title: string, text: string, onConfirm: () => void) {
  ($('#confirm-title') as HTMLElement).textContent = title;
  ($('#confirm-text') as HTMLElement).textContent = text;
  confirmCallback = onConfirm;
  ($('#confirm-modal') as HTMLElement).classList.remove('hidden');
}

$('#confirm-cancel-btn').addEventListener('click', () => {
  ($('#confirm-modal') as HTMLElement).classList.add('hidden');
  confirmCallback = null;
});

$('#confirm-ok-btn').addEventListener('click', () => {
  ($('#confirm-modal') as HTMLElement).classList.add('hidden');
  if (confirmCallback) {
    confirmCallback();
    confirmCallback = null;
  }
});

// ── Secret Message Modal ──────────────────────────

$('#secret-btn').addEventListener('click', () => {
  if (!activeChat || activeChat.type !== 'dm') {
    alert('Secret messages work only in DMs');
    return;
  }
  ($('#secret-modal') as HTMLElement).classList.remove('hidden');
});

$('#secret-cancel-btn').addEventListener('click', () => {
  ($('#secret-modal') as HTMLElement).classList.add('hidden');
});

$('#secret-send-btn').addEventListener('click', () => {
  const text = ($('#secret-text') as HTMLTextAreaElement).value.trim();
  if (!text || !activeChat) return;

  const recipient = users.get(activeChat.id);
  if (!recipient) return;

  const secret = createSecretMessage(text, recipient.publicKey);
  ws.send({
    type: 'secret',
    recipientId: activeChat.id,
    payload: secret.payload,
    ephemeralPk: secret.ephemeralPk,
    nonce: secret.nonce,
    aleoHash: secret.aleoHash,
  });

  appendSystemMessage(`🤫 You sent a secret message (hash: ${secret.aleoHash.slice(0, 20)}...)`);

  ($('#secret-modal') as HTMLElement).classList.add('hidden');
  ($('#secret-text') as HTMLTextAreaElement).value = '';
});

// ── Secret Read Modal ──────────────────────────────

function showSecretReadModal(plaintext: string, aleoHash: string) {
  ($('#secret-read-content') as HTMLElement).textContent = plaintext;
  ($('#secret-aleo-hash') as HTMLElement).textContent = `Aleo Hash: ${aleoHash}`;
  ($('#secret-read-modal') as HTMLElement).classList.remove('hidden');
}

$('#secret-read-close-btn').addEventListener('click', () => {
  ($('#secret-read-content') as HTMLElement).textContent = '';
  ($('#secret-read-modal') as HTMLElement).classList.add('hidden');
});

// ── Logout ──────────────────────────────────────

$('#logout-btn').addEventListener('click', () => {
  ws.disconnect();
  appScreen.classList.remove('active');
  loginScreen.classList.add('active');
  loginBtn.disabled = false;
  loginBtn.textContent = 'Connect';
  users.clear();
  channels.clear();
  groups.clear();
  activeChat = null;
  chatActive.classList.add('hidden');
  chatEmpty.style.display = '';
});

// ── Restore Room Keys ──────────────────────────────

for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key?.startsWith('ghost_roomkey_')) {
    const roomId = key.replace('ghost_roomkey_', '');
    const val = localStorage.getItem(key);
    if (val) roomKeys.set(roomId, val);
  }
}

// ── Scroll Animations ──────────────────────────────

const scrollObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  }
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.fade-in-up').forEach(el => {
  scrollObserver.observe(el);
});

// ── Floating Particles ──────────────────────────────

function createParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.style.cssText = `
      position: absolute;
      width: ${2 + Math.random() * 3}px;
      height: ${2 + Math.random() * 3}px;
      background: rgba(255,140,0,${0.1 + Math.random() * 0.2});
      border-radius: 50%;
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      animation: particleFloat ${5 + Math.random() * 10}s ease-in-out infinite;
      animation-delay: ${-Math.random() * 10}s;
    `;
    container.appendChild(p);
  }
}
createParticles();

// Add particle animation to document
const particleStyle = document.createElement('style');
particleStyle.textContent = `
  @keyframes particleFloat {
    0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.3; }
    25% { transform: translate(${20}px, -${30}px) scale(1.5); opacity: 0.6; }
    50% { transform: translate(-${15}px, -${60}px) scale(1); opacity: 0.3; }
    75% { transform: translate(${25}px, -${20}px) scale(1.3); opacity: 0.5; }
  }
`;
document.head.appendChild(particleStyle);

// ── Util ──────────────────────────────────────────

function esc(str: string): string {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}
