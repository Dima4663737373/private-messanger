/**
 * Push Notification Registration
 * Registers service worker and subscribes to web push notifications.
 */
import { logger } from './logger';
import { safeBackendFetch } from './api-client';

let swRegistration: ServiceWorkerRegistration | null = null;

/** Register service worker and return registration */
async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (swRegistration) return swRegistration;
  if (!('serviceWorker' in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    logger.debug('[Push] Service worker registered');
    return swRegistration;
  } catch (e) {
    logger.error('[Push] SW registration failed:', e);
    return null;
  }
}

/** Subscribe to push notifications */
export async function subscribeToPush(): Promise<boolean> {
  try {
    const reg = await getRegistration();
    if (!reg) return false;

    // Check permission
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission !== 'granted') return false;

    // Get VAPID public key from backend
    const { data } = await safeBackendFetch<{ publicKey: string }>('push/vapid-key');
    if (!data?.publicKey) {
      logger.debug('[Push] Server has no VAPID key configured');
      return false;
    }

    // Convert VAPID key to Uint8Array
    const vapidBytes = urlBase64ToUint8Array(data.publicKey);

    // Check existing subscription
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidBytes
      });
    }

    // Send subscription to backend
    const subJSON = sub.toJSON();
    await safeBackendFetch('push/subscribe', {
      method: 'POST',
      body: {
        endpoint: subJSON.endpoint,
        keys: subJSON.keys
      }
    });

    logger.debug('[Push] Subscribed to push notifications');
    return true;
  } catch (e) {
    logger.error('[Push] Subscribe failed:', e);
    return false;
  }
}

/** Unsubscribe from push notifications */
export async function unsubscribeFromPush(): Promise<void> {
  try {
    const reg = await getRegistration();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await safeBackendFetch('push/subscribe', {
        method: 'DELETE',
        body: { endpoint: sub.endpoint }
      });
      await sub.unsubscribe();
    }
  } catch (e) {
    logger.error('[Push] Unsubscribe failed:', e);
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
