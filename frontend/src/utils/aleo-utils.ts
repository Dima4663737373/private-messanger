import { Plaintext, BHP256, Address } from '@provablehq/sdk';
import { logger } from './logger';

/**
 * Hashes an Aleo address using BHP256 to match the on-chain 'hash_to_field'
 * @param address The Aleo address to hash
 * @returns The field representation of the hash
 */
export const hashAddress = (address: string): string => {
  if (!address) throw new Error("Address is required for hashing");

  try {
    // 1. Try creating Plaintext from raw string
    // This often fails if the string is not quoted, but works for some formats
    let plaintext: Plaintext | undefined;
    
    try {
        plaintext = Plaintext.fromString(address);
    } catch (e) {
        // Ignore and try next method
    }

    // 2. Try creating Plaintext from quoted string (Common fix)
    if (!plaintext) {
        try {
            plaintext = Plaintext.fromString(`"${address}"`);
        } catch (e) {
            // Ignore and try next method
        }
    }

    // 3. If Plaintext creation worked, hash it
    if (plaintext) {
        const hasher = new BHP256();
        try {
            // Note: Plaintext from @provablehq/sdk does NOT have .hashBhp256() method.
            // We must use the BHP256 class hasher.
            const hash = hasher.hash(plaintext.toBitsLe());
            return hash.toString();
        } finally {
            hasher.free();
        }
    }

    // 4. Fallback: Use Address class if Plaintext failed completely
    // Address.from_string might be available (snake_case in WASM)
    // Check for both from_string (snake) and fromString (camel)
    let addr: Address | undefined;
    
    // @ts-ignore - Check for snake_case method which might exist in WASM bindings
    if (Address && typeof Address.from_string === 'function') {
         try {
             // @ts-ignore
             addr = Address.from_string(address);
         } catch (e) {
             logger.warn("Address.from_string failed:", e);
         }
    }
    
    // @ts-ignore - Check for camelCase method as fallback
    if (!addr && Address && typeof Address.fromString === 'function') {
        try {
            // @ts-ignore
            addr = Address.fromString(address);
        } catch (e) {
             logger.warn("Address.fromString failed:", e);
        }
    }

    if (addr) {
        const hasher = new BHP256();
        try {
            const hash = hasher.hash(addr.toBitsLe());
            return hash.toString();
        } finally {
            hasher.free();
        }
    }

    throw new Error("All address parsing methods failed");

  } catch (e) {
    logger.error(`[AleoUtils] Error hashing address ${address}:`, e);
    throw new Error(`Failed to hash address: ${e instanceof Error ? e.message : String(e)}`);
  }
};
