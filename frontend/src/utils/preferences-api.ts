/**
 * User Preferences API Client
 *
 * Replaces localStorage-based preferences with backend API storage.
 * All user preferences (pinned chats, muted chats, deleted chats, disappear timers)
 * are now stored in the backend database for cross-device sync.
 *
 * Uses safeBackendFetch for automatic auth token injection.
 */

import { safeBackendFetch } from './api-client';
import { waitForToken } from './auth-store';
import { PREFERENCES_DEBOUNCE } from '../constants';
import { logger } from './logger';

export interface UserSettings {
  // Privacy
  typingIndicators: boolean;
  readReceipts: boolean;
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  showProfilePhoto: boolean;
  linkPreview: boolean;
  // Notifications
  notifEnabled: boolean;
  notifSound: boolean;
  notifPreview: boolean;
  // Profile
  avatarColor: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  typingIndicators: true,
  readReceipts: true,
  showOnlineStatus: true,
  showLastSeen: true,
  showProfilePhoto: true,
  linkPreview: true,
  notifEnabled: true,
  notifSound: true,
  notifPreview: true,
  avatarColor: '#FF8C00',
};

export interface SavedContact {
  address: string;
  name: string;
}

export interface UserPreferences {
  address: string;
  pinned_chats: string[];
  muted_chats: string[];
  deleted_chats: string[];
  saved_contacts: SavedContact[];
  disappear_timers: Record<string, string>;
  settings: Partial<UserSettings>;
  migrated?: boolean;
}

const DEFAULT_PREFS = (address: string): UserPreferences => ({
  address,
  pinned_chats: [],
  muted_chats: [],
  deleted_chats: [],
  saved_contacts: [],
  disappear_timers: {},
  settings: {},
});

/**
 * Fetch user preferences from backend
 */
export async function fetchPreferences(address: string): Promise<UserPreferences> {
  // Wait for WS auth to complete and session token to become available
  try {
    await waitForToken();
  } catch {
    // Token timeout — return defaults (user may not be authenticated yet)
    return DEFAULT_PREFS(address);
  }
  const { data, error } = await safeBackendFetch<UserPreferences>(`/preferences/${address}`);
  if (error || !data) {
    return DEFAULT_PREFS(address);
  }
  return data;
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
    savedContacts: SavedContact[];
    disappearTimers: Record<string, string>;
    settings: Partial<UserSettings>;
    migrated: boolean;
  }>
): Promise<boolean> {
  // Wait for WS auth to complete and session token to become available
  try {
    await waitForToken();
  } catch {
    logger.error('updatePreferences: auth token not available');
    return false;
  }
  const { error } = await safeBackendFetch(`/preferences/${address}`, {
    method: 'POST',
    body: updates,
  });
  if (error) {
    logger.error('updatePreferences error:', error);
    return false;
  }
  return true;
}

/**
 * Debounced preferences updater to avoid hammering the backend
 *
 * Usage:
 *   const debouncedUpdate = createDebouncedUpdater(publicKey);
 *   debouncedUpdate({ pinnedChats: [...] });
 */
export function createDebouncedUpdater(address: string, delay: number = PREFERENCES_DEBOUNCE) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingUpdates: Partial<Parameters<typeof updatePreferences>[1]> = {};

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
