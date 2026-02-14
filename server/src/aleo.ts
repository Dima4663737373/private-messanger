/**
 * Aleo blockchain integration service.
 * Provides methods to register secret hashes and verify their existence.
 *
 * Uses the Aleo REST API (explorer or local node).
 * For local development, use `leo run` or `snarkos` dev mode.
 */

const ALEO_API = process.env.ALEO_API_URL || 'https://api.explorer.aleo.org/v1';
const PROGRAM_ID = process.env.ALEO_PROGRAM_ID || 'ghost_secret_v1.aleo';
const NETWORK = process.env.ALEO_NETWORK || 'testnet';

export class AleoService {
  /**
   * Verify if a secret hash has been registered on-chain.
   * Queries the mapping `secret_hashes` for the given hash field.
   */
  async verifySecretHash(hash: string): Promise<boolean> {
    try {
      const url = `${ALEO_API}/${NETWORK}/program/${PROGRAM_ID}/mapping/secret_hashes/${hash}`;
      const res = await fetch(url);
      if (!res.ok) return false;
      const value = await res.text();
      return value.trim() === 'true';
    } catch (e) {
      console.error('[Aleo] verifySecretHash error:', e);
      return false;
    }
  }

  /**
   * Get the sender hash for a registered secret.
   */
  async getSecretSender(hash: string): Promise<string | null> {
    try {
      const url = `${ALEO_API}/${NETWORK}/program/${PROGRAM_ID}/mapping/secret_senders/${hash}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.text()).trim();
    } catch (e) {
      console.error('[Aleo] getSecretSender error:', e);
      return null;
    }
  }

  /**
   * Look up a user profile hash.
   */
  async getProfile(addressHash: string): Promise<string | null> {
    try {
      const url = `${ALEO_API}/${NETWORK}/program/${PROGRAM_ID}/mapping/profiles/${addressHash}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.text()).trim();
    } catch (e) {
      return null;
    }
  }
}

export const aleoService = new AleoService();

/**
 * ─── Example: calling Aleo program from Node.js ───────────────
 *
 * Option A — via @provablehq/sdk (requires ESM):
 *
 *   import { Account, ProgramManager } from '@provablehq/sdk';
 *
 *   const account = new Account({ privateKey: process.env.ALEO_PRIVATE_KEY });
 *   const pm = new ProgramManager(ALEO_API, undefined, undefined);
 *
 *   const txId = await pm.execute(
 *     PROGRAM_ID,
 *     'register_secret',
 *     0.5,                           // fee in credits
 *     false,                         // feePrivate
 *     [hashField, senderHashField],  // inputs
 *     undefined, undefined, undefined, undefined,
 *     account
 *   );
 *   console.log('Transaction ID:', txId);
 *
 * Option B — via leo CLI (for local development):
 *
 *   cd aleo-program
 *   leo run register_secret <hash>field <sender_hash>field
 *
 * Option C — via snarkos CLI:
 *
 *   snarkos developer execute ghost_secret_v1.aleo register_secret \
 *     <hash>field <sender_hash>field \
 *     --private-key <PRIVATE_KEY> \
 *     --query https://api.explorer.aleo.org/v1 \
 *     --broadcast https://api.explorer.aleo.org/v1/testnet/transaction/broadcast \
 *     --fee 500000 --record <FEE_RECORD>
 *
 * ─── Example: local deploy ────────────────────────────────────
 *
 *   # 1. Install Leo
 *   curl -sSf https://install.leo-lang.org | sh
 *
 *   # 2. Build the program
 *   cd aleo-program
 *   leo build
 *
 *   # 3. Deploy to testnet
 *   snarkos developer deploy ghost_secret_v1.aleo \
 *     --private-key <PRIVATE_KEY> \
 *     --query https://api.explorer.aleo.org/v1 \
 *     --broadcast https://api.explorer.aleo.org/v1/testnet/transaction/broadcast \
 *     --fee 5000000 --record <FEE_RECORD> \
 *     --path ./build/
 */
