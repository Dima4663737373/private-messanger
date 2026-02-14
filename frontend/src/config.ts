import { PROGRAM_ID } from './deployed_program';

export const API_CONFIG = {
  // Aleo Explorer API
  EXPLORER_BASE: (import.meta.env.VITE_ALEO_EXPLORER_API_BASE || 'https://api.explorer.aleo.org/v1').trim(),

  // Ghost Backend API
  BACKEND_BASE: (import.meta.env.VITE_BACKEND_URL || 'http://localhost:3002').trim(),

  // WebSocket URL (derived from backend or explicit)
  WS_URL: (import.meta.env.VITE_WS_URL || 'ws://localhost:3002').trim(),

  // Network Config
  NETWORK: 'testnet3',
  PROGRAM_ID
};

// Config is logged via logger in DEV mode (see logger.ts)
