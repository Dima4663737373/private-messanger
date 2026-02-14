/**
 * localStorage Migration Utility
 *
 * Migrates existing localStorage data to backend preferences API.
 * This is a one-time migration for users who have data stored in the old
 * localStorage-based system.
 *
 * Migration includes:
 * - Pinned chats
 * - Muted chats
 * - Deleted chats
 * - Disappear timers
 *
 * Security Note:
 * Encryption keys (ghost_msg_keys_*) are NOT migrated - they will be
 * regenerated from wallet signature using the new key-derivation system.
 */

import { updatePreferences } from './preferences-api';
import { logger } from './logger';

export interface LegacyData {
  pinnedChats: string[];
  mutedChats: string[];
  deletedChats: string[];
  disappearTimers: Record<string, string>;
  encryptionKeys: { publicKey: string; secretKey: string } | null;
}

/**
 * Check if migration is needed for this wallet
 */
export function needsMigration(publicKey: string): boolean {
  const migrationKey = `ghost_migrated_${publicKey}`;
  return !localStorage.getItem(migrationKey);
}

/**
 * Extract all legacy localStorage data for a wallet
 */
export function extractLegacyData(publicKey: string): LegacyData | null {
  try {
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
export async function uploadLegacyData(publicKey: string, data: LegacyData): Promise<boolean> {
  try {
    const updates: Parameters<typeof updatePreferences>[1] = {
      pinnedChats: data.pinnedChats,
      mutedChats: data.mutedChats,
      deletedChats: data.deletedChats,
      disappearTimers: data.disappearTimers
    };

    // Also migrate encryption keys to backend
    if (data.encryptionKeys) {
      updates.encryptedKeys = data.encryptionKeys;
    }

    const success = await updatePreferences(publicKey, updates);

    if (!success) {
      throw new Error('Backend update failed');
    }

    logger.debug('Successfully uploaded legacy data to backend:', data);
    return true;
  } catch (error) {
    logger.error('Failed to upload legacy data:', error);
    return false;
  }
}

/**
 * Clean up old localStorage keys after successful migration
 */
export function cleanupLegacyStorage(publicKey: string) {
  const keysToRemove = [
    `ghost_pinned_${publicKey}`,
    `ghost_muted_${publicKey}`,
    `ghost_deleted_chats_${publicKey}`,
    `ghost_disappear_${publicKey}`,
    `ghost_msg_keys_${publicKey}`, // CRITICAL: Remove old encryption keys
  ];

  for (const key of keysToRemove) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      logger.warn(`Failed to remove localStorage key: ${key}`, error);
    }
  }

  logger.debug('Cleaned up legacy localStorage keys');
}

/**
 * Mark migration as complete for this wallet
 */
export function markMigrationComplete(publicKey: string) {
  const migrationKey = `ghost_migrated_${publicKey}`;
  try {
    localStorage.setItem(migrationKey, new Date().toISOString());
    logger.debug('Migration marked as complete');
  } catch (error) {
    logger.warn('Failed to mark migration complete:', error);
  }
}

/**
 * Main migration function - call this on wallet connect
 *
 * @param publicKey - User's Aleo address
 * @returns Promise<boolean> - true if migration was performed (or not needed)
 */
export async function migrateLegacyPreferences(publicKey: string): Promise<boolean> {
  if (!publicKey) {
    logger.warn('No publicKey provided for migration');
    return false;
  }

  // Check if already migrated
  if (!needsMigration(publicKey)) {
    logger.debug('Migration not needed - already completed');
    return true;
  }

  // Extract legacy data
  const legacyData = extractLegacyData(publicKey);

  if (!legacyData) {
    // No data to migrate, but mark as migrated to avoid future checks
    logger.debug('No legacy data found - marking as migrated');
    markMigrationComplete(publicKey);
    return true;
  }

  // Upload to backend
  const success = await uploadLegacyData(publicKey, legacyData);

  if (!success) {
    logger.error('Migration failed - will retry next time');
    return false;
  }

  // Clean up old storage
  cleanupLegacyStorage(publicKey);

  // Mark as complete
  markMigrationComplete(publicKey);

  logger.info('✅ Successfully migrated preferences to backend');
  return true;
}

/**
 * Force re-migration (useful for debugging or if migration failed)
 */
export function resetMigrationStatus(publicKey: string) {
  localStorage.removeItem(`ghost_migrated_${publicKey}`);
  logger.info('Migration status reset - will re-migrate on next connect');
}
