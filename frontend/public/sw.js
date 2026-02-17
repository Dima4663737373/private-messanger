/**
 * Ghost Messenger — Service Worker
 * Handles push notification display when the app tab is in background.
 */

const CACHE_NAME = 'ghost-v1';

// Install — cache shell assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Push notification received
self.addEventListener('push', (event) => {
  let data = { title: 'Ghost Messenger', body: 'New message', icon: '/ghost-icon.png' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text() || data.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/ghost-icon.png',
      badge: '/ghost-icon.png',
      tag: data.tag || 'ghost-message',
      renotify: true,
      data: data
    })
  );
});

// Notification click — focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const chatId = event.notification.data?.chatId;
  const url = chatId ? `/#${chatId}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing tab
      for (const client of clients) {
        if (client.url.includes(self.registration.scope)) {
          client.focus();
          if (chatId) client.postMessage({ type: 'NAVIGATE_CHAT', chatId });
          return;
        }
      }
      // Open new tab
      return self.clients.openWindow(url);
    })
  );
});
