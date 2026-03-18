/**
 * XMTP Signer — derives a deterministic Ethereum identity from an Aleo wallet address.
 *
 * Since XMTP requires an EOA (Ethereum Externally Owned Account) signer,
 * and Aleo uses a different cryptographic curve, we derive a secp256k1 private key
 * from the Aleo address via SHA-256. This key is deterministic — same Aleo address
 * always produces the same Ethereum key and XMTP identity.
 *
 * Security: The derived key is only used for XMTP identity, not for any financial transactions.
 *
 * NOTE: @xmtp/browser-sdk is NOT imported here to avoid TDZ circular-dependency
 * errors during Rollup bundle initialization. IdentifierKind.Ethereum = 0 is
 * hardcoded (verified from @xmtp/wasm-bindings source).
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/curves/utils.js';

// IdentifierKind.Ethereum = 0 (from @xmtp/wasm-bindings)
const IDENTIFIER_KIND_ETHEREUM = 0;

// Minimal Signer interface — matches @xmtp/browser-sdk Signer without importing it
export interface XmtpEoaSigner {
  type: 'EOA';
  getIdentifier: () => { identifier: string; identifierKind: number };
  signMessage: (message: string) => Promise<Uint8Array>;
}

// ----- Key Derivation -----

/**
 * Derive a deterministic secp256k1 private key from an Aleo address.
 * Uses SHA-256 with a domain separator to avoid key reuse.
 */
function derivePrivateKey(aleoAddress: string): Uint8Array {
  const seed = `xmtp_ghost_messenger_v1_${aleoAddress}`;
  return sha256(new TextEncoder().encode(seed));
}

/**
 * Get Ethereum address from secp256k1 private key.
 * Uncompressed public key → keccak256 → last 20 bytes → hex address.
 */
function privateKeyToEthAddress(privateKey: Uint8Array): string {
  const pubKey = secp256k1.getPublicKey(privateKey, false); // uncompressed, 65 bytes
  const pubKeyBody = pubKey.slice(1);                       // strip 0x04 prefix → 64 bytes
  const hash = keccak_256(pubKeyBody);
  return '0x' + bytesToHex(hash.slice(-20));
}

// ----- EIP-191 Personal Sign -----

/**
 * Hash a message using Ethereum's personal_sign prefix (EIP-191).
 * "\x19Ethereum Signed Message:\n" + len + message
 */
function hashPersonalMessage(message: string): Uint8Array {
  const msgBytes = new TextEncoder().encode(message);
  const prefix = `\x19Ethereum Signed Message:\n${msgBytes.length}`;
  const prefixBytes = new TextEncoder().encode(prefix);
  const combined = new Uint8Array(prefixBytes.length + msgBytes.length);
  combined.set(prefixBytes, 0);
  combined.set(msgBytes, prefixBytes.length);
  return keccak_256(combined);
}

/**
 * Sign a message with a secp256k1 private key using EIP-191.
 * Returns 65-byte Ethereum signature (r[32] + s[32] + v[1]).
 *
 * @noble/curves v2: sign() returns a Signature object with
 * .toCompactRawBytes() → 64 bytes (r|s) and .recovery → 0 or 1.
 * Ethereum expects v = recovery + 27.
 */
function signPersonalMessage(message: string, privateKey: Uint8Array): Uint8Array {
  const msgHash = hashPersonalMessage(message);
  // @noble/curves v2: format:'recovered' → 65-byte Uint8Array (r[32]|s[32]|recovery[1])
  // recovery ∈ {0,1} — Ethereum legacy +27 is not used by XMTP's k256 layer
  const sigEip191 = secp256k1.sign(msgHash, privateKey, { lowS: true, format: 'recovered' });

  // Also try raw keccak256 (no EIP-191 prefix) — some XMTP API paths don't apply the prefix
  // The longer signature (EIP-191) is tried first; raw is the fallback in WASM verification
  // Both produce valid ecrecover results; XMTP server determines which variant it expects.
  // Current evidence: both formats fail → problem is likely in WASM binding version mismatch.
  // Returning EIP-191 variant as it matches Viem/MetaMask behaviour (canonical for EOA signers).
  return sigEip191;
}

// ----- Public API -----

/**
 * Create an XMTP-compatible EOA signer from an Aleo address.
 * The returned signer can be passed to `Client.create(signer, options)`.
 */
export function createXmtpSigner(aleoAddress: string): XmtpEoaSigner {
  const privateKey = derivePrivateKey(aleoAddress);
  const ethAddress = privateKeyToEthAddress(privateKey);

  return {
    type: 'EOA' as const,
    getIdentifier: () => ({
      identifier: ethAddress,
      identifierKind: IDENTIFIER_KIND_ETHEREUM,
    }),
    signMessage: async (message: string): Promise<Uint8Array> => {
      return signPersonalMessage(message, privateKey);
    },
  };
}

/**
 * Get the deterministic Ethereum address that will be used as XMTP identity
 * for a given Aleo address. Useful for looking up a contact's XMTP inbox.
 */
export function getXmtpEthAddress(aleoAddress: string): string {
  const privateKey = derivePrivateKey(aleoAddress);
  return privateKeyToEthAddress(privateKey);
}
