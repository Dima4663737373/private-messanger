/**
 * localStorage Migration Utility
 *
 * Migrates existing localStorage data to backend preferences API.
 * This is a one-time migration for users who have data stored in the old
 * localStorage-based system.
 *
 * Migration status is tracked on the backend (preferences.migrated field),
 * NOT in localStorage — ensuring zero local storage usage.
 *
 * Security Note:
 * Encryption keys (ghost_msg_keys_*) are NOT migrated - they will be
 * regenerated from wallet signature using the new key-derivation system.
 */

import { fetchPreferences, updatePreferences } from './preferences-api';
import { logger } from './logger';

export interface LegacyData {
  pinnedChats: string[];
  mutedChats: string[];
  deletedChats: string[];
  disappearTimers: Record<string, string>;
  encryptionKeys: { publicKey: string; secretKey: string } | null;
}

/**
 * Check if migration is needed for this wallet (via backend flag)
 */
async function checkMigrationNeeded(publicKey: string): Promise<boolean> {
  try {
    const prefs = await fetchPreferences(publicKey);
    return !prefs.migrated;
  } catch {
    return true; // If fetch fails, assume migration needed
  }
}

/**
 * Extract all legacy localStorage data for a wallet (if any exists)
 */
function extractLegacyData(publicKey: string): LegacyData | null {
  try {
    // If localStorage is not available (SSR, etc.), skip
    if (typeof localStorage === 'undefined') return null;

    const pinnedChats = JSON.parse(localStorage.getItem(`ghost_pinned_${publicKey}`) || '[]');
    const mutedChats = JSON.parse(localStorage.getItem(`ghost_muted_${publicKey}`) || '[]');
    const deletedChats = JSON.parse(localStorage.getItem(`ghost_deleted_chats_${publicKey}`) || '[]');
    const disappearTimers = JSON.parse(localStorage.getItem(`ghost_disappear_${publicKey}`) || '{}');

    // Try to extract old encryption keys
    let encryptionKeys: { publicKey: string; secretKey: string } | null = null;
    try {
      const rawKeys = localStorage.getItem(`ghost_msg_keys_${publicKey}`);
      if (rawKeys) {
        const parsed = JSON.parse(rawKeys);
        if (parsed.publicKey && parsed.secretKey) {
          encryptionKeys = { publicKey: parsed.publicKey, secretKey: parsed.secretKey };
        }
      }
    } catch { /* ignore malformed keys */ }

    // Check if there's any data to migrate
    const hasData =
      pinnedChats.length > 0 ||
      mutedChats.length > 0 ||
      deletedChats.length > 0 ||
      Object.keys(disappearTimers).length > 0 ||
      encryptionKeys !== null;

    if (!hasData) {
      return null; // No data to migrate
    }

    return {
      pinnedChats,
      mutedChats,
      deletedChats,
      disappearTimers,
      encryptionKeys
    };
  } catch (error) {
    logger.error('Failed to extract legacy data:', error);
    return null;
  }
}

/**
 * Upload legacy data to backend
 */
async function uploadLegacyData(publicKey: string, data: LegacyData): Promise<boolean> {
  try {
    const updates: Parameters<typeof updatePreferences>[1] = {
      pinnedChats: data.pinnedChats,
      mutedChats: data.mutedChats,
      deletedChats: data.deletedChats,
      disappearTimers: data.disappearTimers
    };

    // Note: encryption keys are no longer migrated to backend — they are now
    // derived from wallet signature per session for security

    const success = await updatePreferences(publicKey, updates);

    if (!success) {
      throw new Error('Backend update failed');
    }

    logger.debug('Successfully uploaded legacy data to backend');
    return true;
  } catch (error) {
    logger.error('Failed to upload legacy data:', error);
    return false;
  }
}

/**
 * Clean up ALL localStorage keys for this wallet
 */
function cleanupAllLocalStorage(publicKey: string) {
  if (typeof localStorage === 'undefined') return;

  const keysToRemove = [
    `ghost_pinned_${publicKey}`,
    `ghost_muted_${publicKey}`,
    `ghost_deleted_chats_${publicKey}`,
    `ghost_disappear_${publicKey}`,
    `ghost_msg_keys_${publicKey}`,
    `ghost_migrated_${publicKey}`, // Old migration flag itself
  ];

  for (const key of keysToRemove) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      logger.warn(`Failed to remove localStorage key: ${key}`, error);
    }
  }

  logger.debug('Cleaned up all legacy localStorage keys');
}

/**
 * Main migration function - call this on wallet connect
 *
 * Migration status is tracked on the backend, not in localStorage.
 *
 * @param publicKey - User's Aleo address
 * @returns Promise<boolean> - true if migration was performed (or not needed)
 */
export async function migrateLegacyPreferences(publicKey: string): Promise<boolean> {
  if (!publicKey) {
    logger.warn('No publicKey provided for migration');
    return false;
  }

  // Check migration status on backend
  const needsMigration = await checkMigrationNeeded(publicKey);
  if (!needsMigration) {
    // Already migrated — still clean up any leftover localStorage keys
    cleanupAllLocalStorage(publicKey);
    return true;
  }

  // Extract legacy data from localStorage
  const legacyData = extractLegacyData(publicKey);

  if (!legacyData) {
    // No data to migrate — mark as migrated on backend and clean up
    await updatePreferences(publicKey, { migrated: true });
    cleanupAllLocalStorage(publicKey);
    return true;
  }

  // Upload to backend
  const success = await uploadLegacyData(publicKey, legacyData);

  if (!success) {
    logger.error('Migration failed - will retry next time');
    return false;
  }

  // Mark as migrated on backend
  await updatePreferences(publicKey, { migrated: true });

  // Clean up all localStorage
  cleanupAllLocalStorage(publicKey);

  logger.info('Successfully migrated preferences to backend');
  return true;
}
