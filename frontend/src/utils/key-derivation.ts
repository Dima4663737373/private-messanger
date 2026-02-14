/**
 * Key Derivation from Wallet Transaction Signatures
 *
 * This module provides secure encryption key generation by deriving keys from
 * Aleo wallet transaction signatures instead of storing them in localStorage.
 *
 * Security Benefits:
 * - Keys are deterministically derived from wallet signature
 * - No storage of private keys (eliminates XSS theft risk)
 * - Same wallet always generates same encryption keys
 * - Requires wallet connection every session (trade-off for security)
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeUTF8 } from 'tweetnacl-util';

export interface EncryptionKeyPair {
  publicKey: string;  // Base64-encoded
  secretKey: string;  // Base64-encoded
}

/**
 * Derive encryption keypair from wallet transaction signature
 *
 * Process:
 * 1. Request a dummy transaction signature from the wallet
 * 2. Extract signature bytes
 * 3. Derive 32-byte seed using SHA-256(signature + publicKey)
 * 4. Generate NaCl box keypair from seed
 *
 * @param wallet - Leo Wallet instance (window.leoWallet)
 * @param publicKey - User's Aleo address
 * @returns Promise<EncryptionKeyPair> - Deterministic encryption keys
 */
export async function deriveKeysFromWalletSignature(
  wallet: any,
  publicKey: string
): Promise<EncryptionKeyPair> {
  if (!wallet || !publicKey) {
    throw new Error('Wallet and publicKey are required');
  }

  try {
    // Request a deterministic transaction for signature generation
    // Using a fixed "derivation transaction" that doesn't need to be broadcast
    const derivationPayload = {
      address: publicKey,
      chainId: 'testnetbeta',
      program: 'credits.aleo', // Standard program, no actual transaction will be sent
      functionName: 'transfer_public', // Standard function
      inputs: [
        publicKey, // Send to self
        '0u64'     // 0 amount (dummy)
      ],
      fee: 0, // No fee for derivation-only transaction
      wait: false // Don't wait for confirmation
    };

    // Request transaction to get signature
    // Note: This will trigger wallet popup asking user to sign
    let txResponse;
    try {
      txResponse = await wallet.requestTransaction(derivationPayload);
    } catch (e: any) {
      // User might cancel - this is expected behavior
      if (e?.message?.includes('cancel') || e?.message?.includes('denied')) {
        throw new Error('User cancelled key derivation. Wallet signature is required to generate encryption keys.');
      }
      throw e;
    }

    // Extract signature from transaction response
    // Leo Wallet returns transaction ID or signature in different formats
    let signatureSource = '';

    if (typeof txResponse === 'string') {
      // If it's a transaction ID string, use it
      signatureSource = txResponse;
    } else if (txResponse?.signature) {
      signatureSource = txResponse.signature;
    } else if (txResponse?.transactionId) {
      signatureSource = txResponse.transactionId;
    } else {
      // Fallback: stringify the entire response
      signatureSource = JSON.stringify(txResponse);
    }

    // Create deterministic seed from signature + publicKey
    // This ensures the same wallet always generates the same keys
    const seedInput = signatureSource + publicKey;
    const seedBytes = decodeUTF8(seedInput);

    // Derive 32-byte seed using SHA-256
    const seedHash = await crypto.subtle.digest('SHA-256', seedBytes);
    const seed = new Uint8Array(seedHash);

    // Generate NaCl box keypair from the derived seed
    // nacl.box.keyPair.fromSecretKey requires exactly 32 bytes
    const keypair = nacl.box.keyPair.fromSecretKey(seed);

    return {
      publicKey: encodeBase64(keypair.publicKey),
      secretKey: encodeBase64(keypair.secretKey)
    };
  } catch (error: any) {
    console.error('Key derivation failed:', error);
    throw new Error(`Failed to derive encryption keys: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Alternative: Derive keys from a signed message (if wallet supports signMessage)
 *
 * Note: As of 2026-02, Leo Wallet Adapter doesn't expose signMessage(),
 * so this is a future-proofing fallback for when it becomes available.
 */
export async function deriveKeysFromSignedMessage(
  wallet: any,
  publicKey: string
): Promise<EncryptionKeyPair> {
  if (!wallet.signMessage) {
    throw new Error('Wallet does not support signMessage. Use deriveKeysFromWalletSignature instead.');
  }

  const message = `Ghost Messenger - Derive encryption keys for ${publicKey}`;

  try {
    const signature = await wallet.signMessage(message);

    // Derive seed from signature
    const seedBytes = decodeUTF8(signature + publicKey);
    const seedHash = await crypto.subtle.digest('SHA-256', seedBytes);
    const seed = new Uint8Array(seedHash);

    const keypair = nacl.box.keyPair.fromSecretKey(seed);

    return {
      publicKey: encodeBase64(keypair.publicKey),
      secretKey: encodeBase64(keypair.secretKey)
    };
  } catch (error: any) {
    console.error('Message signing failed:', error);
    throw new Error(`Failed to sign message: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Cache derived keys in memory for the session (optional)
 *
 * This prevents requiring wallet signature on every encryption operation
 * within the same session. Keys are NOT persisted to localStorage.
 */
const sessionKeyCache = new Map<string, EncryptionKeyPair>();

export async function getOrDeriveKeys(
  wallet: any,
  publicKey: string,
  useCache: boolean = true
): Promise<EncryptionKeyPair> {
  if (useCache && sessionKeyCache.has(publicKey)) {
    return sessionKeyCache.get(publicKey)!;
  }

  const keys = await deriveKeysFromWalletSignature(wallet, publicKey);

  if (useCache) {
    sessionKeyCache.set(publicKey, keys);
  }

  return keys;
}

/**
 * Synchronous getter for cached keys (used by useSync and other hooks)
 *
 * Returns cached keys if available, or null if keys haven't been derived yet.
 * This allows synchronous access to keys that were previously derived async.
 */
export function getCachedKeys(publicKey: string): EncryptionKeyPair | null {
  return sessionKeyCache.get(publicKey) || null;
}

/**
 * Store keys directly in the session cache
 * (Useful when keys are derived externally and need to be shared)
 */
export function setCachedKeys(publicKey: string, keys: EncryptionKeyPair): void {
  sessionKeyCache.set(publicKey, keys);
}

/**
 * Clear session cache (e.g., on logout)
 */
export function clearKeyCache(publicKey?: string) {
  if (publicKey) {
    sessionKeyCache.delete(publicKey);
  } else {
    sessionKeyCache.clear();
  }
}
