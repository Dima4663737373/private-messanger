/**
 * User Preferences API Client
 *
 * Replaces localStorage-based preferences with backend API storage.
 * All user preferences (pinned chats, muted chats, deleted chats, disappear timers)
 * are now stored in the backend database for cross-device sync.
 */

import { API_CONFIG } from '../config';

export interface UserPreferences {
  address: string;
  pinned_chats: string[];
  muted_chats: string[];
  deleted_chats: string[];
  disappear_timers: Record<string, string>;
  encrypted_keys: any | null;
  key_nonce: string | null;
}

const BACKEND_URL = API_CONFIG.BACKEND_BASE;

/**
 * Fetch user preferences from backend
 */
export async function fetchPreferences(address: string): Promise<UserPreferences> {
  try {
    const response = await fetch(`${BACKEND_URL}/preferences/${address}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch preferences: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('fetchPreferences error:', error);
    // Return defaults on error
    return {
      address,
      pinned_chats: [],
      muted_chats: [],
      deleted_chats: [],
      disappear_timers: {},
      encrypted_keys: null,
      key_nonce: null
    };
  }
}

/**
 * Update user preferences in backend
 *
 * @param address - User's Aleo address
 * @param updates - Partial preferences to update
 */
export async function updatePreferences(
  address: string,
  updates: Partial<{
    pinnedChats: string[];
    mutedChats: string[];
    deletedChats: string[];
    disappearTimers: Record<string, string>;
    encryptedKeys: any;
    keyNonce: string;
  }>
): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/preferences/${address}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      throw new Error(`Failed to update preferences: ${response.statusText}`);
    }

    return true;
  } catch (error) {
    console.error('updatePreferences error:', error);
    return false;
  }
}

/**
 * Debounced preferences updater to avoid hammering the backend
 *
 * Usage:
 *   const debouncedUpdate = createDebouncedUpdater(publicKey);
 *   debouncedUpdate({ pinnedChats: [...] });
 */
export function createDebouncedUpdater(address: string, delay: number = 1000) {
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingUpdates: any = {};

  return (updates: Parameters<typeof updatePreferences>[1]) => {
    // Merge updates
    pendingUpdates = { ...pendingUpdates, ...updates };

    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Schedule update
    timeoutId = setTimeout(async () => {
      await updatePreferences(address, pendingUpdates);
      pendingUpdates = {};
      timeoutId = null;
    }, delay);
  };
}
