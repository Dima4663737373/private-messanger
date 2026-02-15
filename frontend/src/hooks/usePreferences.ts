/**
 * usePreferences Hook
 *
 * Manages user preferences with automatic backend synchronization.
 * Replaces localStorage-based preferences with server-side storage.
 *
 * Features:
 * - Automatic loading from backend on mount
 * - Debounced saves to reduce API calls
 * - Type-safe preference updates
 * - Cross-device synchronization
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchPreferences, updatePreferences, UserSettings, DEFAULT_SETTINGS, SavedContact } from '../utils/preferences-api';
import { logger } from '../utils/logger';

export interface Preferences {
  pinnedChats: string[];
  mutedChats: string[];
  deletedChats: string[];
  savedContacts: SavedContact[];
  disappearTimers: Record<string, string>;
  settings: UserSettings;
}

const DEFAULT_PREFERENCES: Preferences = {
  pinnedChats: [],
  mutedChats: [],
  deletedChats: [],
  savedContacts: [],
  disappearTimers: {},
  settings: { ...DEFAULT_SETTINGS }
};

export function usePreferences(publicKey: string | null) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdates = useRef<Partial<Preferences>>({});

  // Load preferences from backend on mount
  useEffect(() => {
    if (!publicKey) {
      setPreferences(DEFAULT_PREFERENCES);
      setIsLoaded(false);
      return;
    }

    let isMounted = true;

    fetchPreferences(publicKey).then(prefs => {
      if (!isMounted) return;

      setPreferences({
        pinnedChats: prefs.pinned_chats || [],
        mutedChats: prefs.muted_chats || [],
        deletedChats: prefs.deleted_chats || [],
        savedContacts: prefs.saved_contacts || [],
        disappearTimers: prefs.disappear_timers || {},
        settings: { ...DEFAULT_SETTINGS, ...(prefs.settings || {}) }
      });
      setIsLoaded(true);
      logger.debug('Loaded preferences from backend:', prefs);
    }).catch(error => {
      logger.error('Failed to load preferences:', error);
      setPreferences(DEFAULT_PREFERENCES);
      setIsLoaded(true);
    });

    return () => {
      isMounted = false;
    };
  }, [publicKey]);

  // Debounced save to backend
  const saveToBackend = useCallback((updates: Partial<Preferences>) => {
    if (!publicKey) return;

    // Merge pending updates
    pendingUpdates.current = { ...pendingUpdates.current, ...updates };

    // Clear existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Schedule save
    debounceTimer.current = setTimeout(async () => {
      const toSave = { ...pendingUpdates.current };
      pendingUpdates.current = {};

      try {
        await updatePreferences(publicKey, toSave);
        logger.debug('Saved preferences to backend:', toSave);
      } catch (error) {
        logger.error('Failed to save preferences:', error);
      }
    }, 1000); // 1 second debounce
  }, [publicKey]);

  // Update pinned chats
  const setPinnedChats = useCallback((chatIds: string[] | ((prev: string[]) => string[])) => {
    setPreferences(prev => {
      const next = typeof chatIds === 'function' ? chatIds(prev.pinnedChats) : chatIds;
      saveToBackend({ pinnedChats: next });
      return { ...prev, pinnedChats: next };
    });
  }, [saveToBackend]);

  // Update muted chats
  const setMutedChats = useCallback((chatIds: string[] | ((prev: string[]) => string[])) => {
    setPreferences(prev => {
      const next = typeof chatIds === 'function' ? chatIds(prev.mutedChats) : chatIds;
      saveToBackend({ mutedChats: next });
      return { ...prev, mutedChats: next };
    });
  }, [saveToBackend]);

  // Update deleted chats
  const setDeletedChats = useCallback((chatIds: string[] | ((prev: string[]) => string[])) => {
    setPreferences(prev => {
      const next = typeof chatIds === 'function' ? chatIds(prev.deletedChats) : chatIds;
      saveToBackend({ deletedChats: next });
      return { ...prev, deletedChats: next };
    });
  }, [saveToBackend]);

  // Update saved contacts
  const setSavedContacts = useCallback((contacts: SavedContact[] | ((prev: SavedContact[]) => SavedContact[])) => {
    setPreferences(prev => {
      const next = typeof contacts === 'function' ? contacts(prev.savedContacts) : contacts;
      saveToBackend({ savedContacts: next });
      return { ...prev, savedContacts: next };
    });
  }, [saveToBackend]);

  // Update disappear timers
  const setDisappearTimers = useCallback((timers: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => {
    setPreferences(prev => {
      const next = typeof timers === 'function' ? timers(prev.disappearTimers) : timers;
      saveToBackend({ disappearTimers: next });
      return { ...prev, disappearTimers: next };
    });
  }, [saveToBackend]);

  // Toggle pin status for a chat
  const togglePin = useCallback((chatId: string) => {
    setPinnedChats(prev =>
      prev.includes(chatId) ? prev.filter(id => id !== chatId) : [...prev, chatId]
    );
  }, [setPinnedChats]);

  // Toggle mute status for a chat
  const toggleMute = useCallback((chatId: string) => {
    setMutedChats(prev =>
      prev.includes(chatId) ? prev.filter(id => id !== chatId) : [...prev, chatId]
    );
  }, [setMutedChats]);

  // Mark chat as deleted
  const markChatDeleted = useCallback((chatId: string) => {
    setDeletedChats(prev =>
      prev.includes(chatId) ? prev : [...prev, chatId]
    );
  }, [setDeletedChats]);

  // Set disappear timer for a specific chat
  const setDisappearTimer = useCallback((chatId: string, timer: string) => {
    setDisappearTimers(prev => ({ ...prev, [chatId]: timer }));
  }, [setDisappearTimers]);

  // Update a single setting (toggleable)
  const updateSetting = useCallback(<K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setPreferences(prev => {
      const nextSettings = { ...prev.settings, [key]: value };
      saveToBackend({ settings: nextSettings } as any);
      return { ...prev, settings: nextSettings };
    });
  }, [saveToBackend]);

  return {
    ...preferences,
    isLoaded,
    setPinnedChats,
    setMutedChats,
    setDeletedChats,
    setSavedContacts,
    setDisappearTimers,
    togglePin,
    toggleMute,
    markChatDeleted,
    setDisappearTimer,
    updateSetting
  };
}
