/**
 * XMTP Signer — derives a deterministic Ethereum identity from an Aleo wallet address.
 *
 * Since XMTP requires an EOA (Ethereum Externally Owned Account) signer,
 * and Aleo uses a different cryptographic curve, we derive a secp256k1 private key
 * from the Aleo address via SHA-256. This key is deterministic — same Aleo address
 * always produces the same Ethereum key and XMTP identity.
 *
 * Security: The derived key is only used for XMTP identity, not for any financial transactions.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { IdentifierKind, type Signer } from '@xmtp/browser-sdk';

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
 * @noble/curves v2 sign() with format:'recovered' returns 65 bytes:
 * bytes 0-31 = r, bytes 32-63 = s, byte 64 = recovery (0 or 1).
 * Ethereum expects v = recovery + 27.
 */
function signPersonalMessage(message: string, privateKey: Uint8Array): Uint8Array {
  const msgHash = hashPersonalMessage(message);
  // prehash: false — msgHash is already keccak256(EIP-191 prefix + message)
  const sigBytes = secp256k1.sign(msgHash, privateKey, {
    format: 'recovered',
    lowS: true,
    prehash: false,
  });

  // Convert recovery (0/1) to Ethereum v (27/28)
  const result = new Uint8Array(65);
  result.set(sigBytes.slice(0, 64), 0); // r || s
  result[64] = sigBytes[64] + 27;       // v
  return result;
}

// ----- Public API -----

/**
 * Create an XMTP-compatible EOA signer from an Aleo address.
 * The returned signer can be passed to `Client.create(signer, options)`.
 */
export function createXmtpSigner(aleoAddress: string): Signer {
  const privateKey = derivePrivateKey(aleoAddress);
  const ethAddress = privateKeyToEthAddress(privateKey);

  return {
    type: 'EOA' as const,
    getIdentifier: () => ({
      identifier: ethAddress,
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: (message: string): Uint8Array => {
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
