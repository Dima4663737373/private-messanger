/**
 * Application Constants
 * Centralized location for all magic numbers, URLs, and configuration values
 */

// ═══════════════════════════════════════════════════════════
// External Service URLs
// ═══════════════════════════════════════════════════════════

/** UI Avatars service for generating user avatars */
export const UI_AVATARS_BASE_URL = 'https://ui-avatars.com/api/';

/** IPFS gateway for file attachments */
export const IPFS_GATEWAY_URL = 'https://ipfs.io/ipfs/';

/** Aleo RPC endpoints (fallback chain) */
export const ALEO_RPC_ENDPOINTS = [
  'https://api.explorer.provable.com/v1',
  'https://api.explorer.aleo.org/v1',
  'https://testnet.aleorpc.com/v1',
  'https://api.testnet.aleo.org/v1'
] as const;

/** Aleo Explorer URLs by network */
export const ALEO_EXPLORER_URLS = {
  testnet: 'https://testnet.aleoscan.io',
  mainnet: 'https://aleoscan.io'
} as const;

// ═══════════════════════════════════════════════════════════
// Transaction & Blockchain Constants
// ═══════════════════════════════════════════════════════════

/** Default transaction fee in microcredits */
export const TRANSACTION_FEE = 50000;

/** Minimum fee in microcredits (Aleo network requirement) */
export const MIN_FEE_MICROCREDITS = 10_000_000_000;

/** Wallet transaction timeout (ms) */
export const WALLET_TIMEOUT = 30000;

/** Retry delay between wallet transaction attempts (ms) */
export const RETRY_DELAY = 2000;

/** Transaction polling interval (ms) */
export const TX_POLL_INTERVAL = 10000;

/** Maximum timestamp drift allowed (Unix timestamp, year 2038) */
export const MAX_TIMESTAMP_UNIX = 2147483647;

// ═══════════════════════════════════════════════════════════
// Display & UI Constants
// ═══════════════════════════════════════════════════════════

/** Address display formats */
export const ADDRESS_DISPLAY = {
  /** Short prefix for avatars (e.g., "aleo1a...") */
  SHORT_PREFIX: 6,
  /** Short suffix for avatars */
  SHORT_SUFFIX: 6,
  /** Initials length for avatar fallback */
  INITIALS: 2,
  /** Medium length for chat header */
  MEDIUM: 8,
  /** Full short format (prefix + suffix) */
  FULL_SHORT: 10,
  /** Transaction ID display length */
  TX_ID: 12
} as const;

/** Message preview lengths */
export const MESSAGE_PREVIEW = {
  /** Sidebar chat preview */
  CHAT_LIST: 80,
  /** Notification preview */
  NOTIFICATION: 60,
  /** Error message truncation */
  ERROR: 100,
  /** Maximum notifications to keep */
  MAX_NOTIFICATIONS: 200
} as const;

// ═══════════════════════════════════════════════════════════
// File Upload Constants
// ═══════════════════════════════════════════════════════════

/** Maximum file size for uploads (100 MB) */
export const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Maximum filename length */
export const MAX_FILENAME_LENGTH = 255;

/** IPFS upload retry delay (ms) */
export const IPFS_UPLOAD_RETRY_DELAY = 500;

// ═══════════════════════════════════════════════════════════
// Cache & Session Constants
// ═══════════════════════════════════════════════════════════

/** Encryption key cache TTL (4 hours) */
export const KEY_CACHE_TTL = 4 * 60 * 60 * 1000;

/** API request timeout (ms) */
export const API_TIMEOUT = 5000;

/** Preferences update debounce delay (ms) */
export const PREFERENCES_DEBOUNCE = 1000;

/** Link preview cache size limit */
export const LINK_PREVIEW_CACHE_LIMIT = 200;

/** Link preview cache TTL (15 minutes) */
export const LINK_PREVIEW_CACHE_TTL = 15 * 60 * 1000;

// ═══════════════════════════════════════════════════════════
// Offline Queue Constants
// ═══════════════════════════════════════════════════════════

/** IndexedDB database name for offline queue */
export const OFFLINE_DB_NAME = 'ghost_offline_queue';

/** IndexedDB version */
export const OFFLINE_DB_VERSION = 1;

/** Maximum offline queue size */
export const MAX_OFFLINE_QUEUE_SIZE = 100;

/** Offline queue retention period (7 days) */
export const OFFLINE_QUEUE_TTL = 7 * 24 * 60 * 60 * 1000;
