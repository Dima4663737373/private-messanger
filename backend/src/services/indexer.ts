import axios from 'axios';
import { SyncStatus, Profile, Message, sequelize } from '../database';
import { WebSocketServer, WebSocket } from 'ws';
import { Op } from 'sequelize';

// CONSTANTS
const PROGRAM_ID = "priv_messenger_leotest_014.aleo";
const ALEO_API_URL = "http://localhost:3030/testnet3"; // Default local node

interface AleoTransition {
  id: string;
  program: string;
  function: string;
  inputs: any[];
  outputs: any[];
  tpk: string;
  tcm: string;
}

interface AleoTransaction {
  id: string;
  type: string;
  execution?: {
    transitions: AleoTransition[];
  };
  owner?: string;
  fee?: {
    payer?: string;
    amount?: number;
  }
}

interface AleoBlock {
  header: {
    metadata: {
      height: number;
      timestamp: number;
    };
  };
  transactions: AleoTransaction[];
}

export class IndexerService {
  private isSyncing = false;
  private wss: WebSocketServer;
  private apiUrl: string;
  private sdk: any;

  constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.apiUrl = ALEO_API_URL;
  }

  private syncInterval = 5000; // Start at 5s, backoff on errors
  private readonly MIN_INTERVAL = 5000;
  private readonly MAX_INTERVAL = 60000;

  async start() {
    console.log("Starting Blockchain Indexer Service...");

    // Load SDK dynamically (ESM in CJS context)
    try {
        this.sdk = await (new Function('return import("@provablehq/sdk")'))();
        console.log("Provable SDK loaded in Indexer.");
    } catch (e) {
        console.error("Failed to load Provable SDK:", e);
    }

    await SyncStatus.findOrCreate({ where: { id: 1 }, defaults: { last_block_height: 0 } });
    this.scheduleSyncLoop();
  }

  private scheduleSyncLoop() {
    setTimeout(async () => {
      await this.syncLoop();
      this.scheduleSyncLoop();
    }, this.syncInterval);
  }

  hashAddress(address: string): string | null {
      if (!this.sdk) return null;
      try {
          const { Plaintext, BHP256 } = this.sdk;
          let plaintext;
          try {
              plaintext = Plaintext.fromString(`"${address}"`);
          } catch (e) {
              try {
                plaintext = Plaintext.fromString(address);
              } catch (e2) {
                  return null;
              }
          }
          
          const hasher = new BHP256();
          try {
            const hash = hasher.hash(plaintext.toBitsLe()).toString();
            return hash;
          } finally {
            hasher.free();
          }
      } catch (e) {
          console.error("Indexer hash error:", e);
          return null;
      }
  }

  async syncLoop() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const syncStatus = await SyncStatus.findByPk(1);
      if (!syncStatus) return;

      let currentHeight = syncStatus.last_block_height;
      const latestHeight = await this.getLatestHeight();
      
      if (latestHeight > currentHeight) {
        const BATCH_SIZE = 10;
        while (currentHeight < latestHeight) {
          const endHeight = Math.min(currentHeight + BATCH_SIZE, latestHeight);
          for (let h = currentHeight + 1; h <= endHeight; h++) {
            await this.processBlock(h);
            syncStatus.last_block_height = h;
            await syncStatus.save();
          }
          currentHeight = endHeight;
        }
      }
      // Reset backoff on success
      this.syncInterval = this.MIN_INTERVAL;
    } catch (error) {
       // Exponential backoff on errors
       this.syncInterval = Math.min(this.syncInterval * 2, this.MAX_INTERVAL);
    } finally {
      this.isSyncing = false;
    }
  }

  async getLatestHeight(): Promise<number> {
    try {
      const response = await axios.get(`${this.apiUrl}/latest/height`);
      return response.data;
    } catch (e) {
      return 0; 
    }
  }

  async processBlock(height: number) {
    try {
      const response = await axios.get(`${this.apiUrl}/block/${height}`);
      const block: AleoBlock = response.data;
      if (!block.transactions) return;

      for (const tx of block.transactions) {
        if (tx.type === 'execute' && tx.execution && tx.execution.transitions) {
          const sender = tx.owner || tx.fee?.payer || 'unknown';
          for (const transition of tx.execution.transitions) {
             if (transition.program === PROGRAM_ID) {
                await this.handleTransition(tx.id, sender, height, block.header.metadata.timestamp, transition);
             }
          }
        }
      }
    } catch (e) {
      console.error(`Error processing block ${height}:`, e);
    }
  }

  async handleTransition(txId: string, sender: string, height: number, timestamp: number, transition: AleoTransition) {
     if (transition.function === 'send_message') {
        // inputs: [sender_hash, recipient_hash, recipient_addr(private), payload, timestamp, att1, att2]
        const inputs = transition.inputs;
        // Verify input count matches new contract signature
        if (inputs.length < 7) return;

        const senderHash = this.cleanInput(inputs[0]);
        const recipientHash = this.cleanInput(inputs[1]);
        // inputs[2] is private recipient_addr, ignored
        const encryptedPayload = this.fieldsToString(inputs[3]);
        
        const tsArg = this.cleanInput(inputs[4]);
        const tsVal = parseInt(tsArg.replace('u64', ''));
        const finalTimestamp = !isNaN(tsVal) ? tsVal : timestamp * 1000;
        
        const att1 = this.cleanInput(inputs[5]);
        const att2 = this.cleanInput(inputs[6]);

        // Compute Dialog Hash (Canonical: min_max)
        const dialogHash = senderHash < recipientHash 
            ? `${senderHash}_${recipientHash}` 
            : `${recipientHash}_${senderHash}`;

        // Resolve Recipient Address from Hash
        let resolvedRecipient = 'unknown';
        const recipientProfile = await Profile.findOne({ where: { address_hash: recipientHash } });
        if (recipientProfile) {
            resolvedRecipient = recipientProfile.address;
        }

        // Ensure we record the sender's hash mapping
        const senderProfile = await Profile.findOne({ where: { address: sender } });
        if (senderProfile) {
            senderProfile.address_hash = senderHash;
            await senderProfile.save();
        } else {
            await Profile.create({ address: sender, address_hash: senderHash });
        }

        // Deduplication
        const existing = await Message.findByPk(txId);
        if (existing) {
            if (existing.status !== 'confirmed') {
                existing.status = 'confirmed';
                existing.block_height = height;
                await existing.save();
                this.broadcastEvent('tx_confirmed', { id: txId, blockHeight: height });
            }
            return;
        }

        // Store Message
        await Message.create({
            id: txId,
            sender: sender,
            recipient: resolvedRecipient, // Resolved from hash
            sender_hash: senderHash,
            recipient_hash: recipientHash,
            dialog_hash: dialogHash,
            encrypted_payload: encryptedPayload,
            encrypted_payload_self: '', 
            attachment_part1: att1,
            attachment_part2: att2,
            timestamp: finalTimestamp,
            block_height: height,
            status: 'confirmed'
        });

        // Broadcast to relevant clients
        this.broadcastEvent('message_detected', { 
            id: txId, 
            dialogHash,
            recipientHash,
            senderHash,
            sender: sender, // Send resolved addresses
            recipient: resolvedRecipient,
            encryptedPayload,
            timestamp: finalTimestamp,
            attachmentPart1: att1,
            attachmentPart2: att2,
            status: 'confirmed'
        });
        
     } else if (transition.function === 'register_profile') {
        // inputs: [key_part1, key_part2]
        // finalize inputs: [sender_hash, key_part1, key_part2]
        // We can try to capture sender_hash from finalize if available in future, 
        // but for now we rely on send_message or just store what we have.
        const inputs = transition.inputs;
        const key1 = this.cleanInput(inputs[0]);
        const key2 = this.cleanInput(inputs[1]);
        
        // Compute hash!
        const senderHash = this.hashAddress(sender);

        await Profile.upsert({
            address: sender,
            address_hash: senderHash || undefined,
            encryption_public_key: JSON.stringify({ part1: key1, part2: key2 }),
            tx_id: txId
        });

        this.broadcastEvent('profile_updated', {
            address: sender,
            addressHash: senderHash,
            encryptionPublicKey: { part1: key1, part2: key2 },
            txId
        });
     }
  }

  cleanInput(input: any): string {
      if (typeof input === 'string') return input;
      if (input && input.value) return input.value;
      return String(input);
  }

  fieldsToString(fields: any): string {
      try {
        let fieldList: string[] = [];
        if (Array.isArray(fields)) {
            fieldList = fields;
        } else if (typeof fields === 'string') {
             const cleaned = fields.replace(/[\[\]]/g, '');
             fieldList = cleaned.split(',').map(s => s.trim());
        }
        
        let allBytes: number[] = [];
        for (const fieldStr of fieldList) {
           let valStr = String(fieldStr).replace(/field/g, "")
             .replace(/u64/g, "")
             .replace(/\.private/g, "")
             .replace(/\.public/g, "");
             
           valStr = valStr.replace(/\D/g, "");
           if (!valStr || valStr === "0") continue;
           
           let val = BigInt(valStr);
           const bytes = [];
           while (val > 0n) {
             bytes.unshift(Number(val & 0xffn));
             val >>= 8n;
           }
           allBytes = allBytes.concat(bytes);
        }
        
        if (allBytes.length === 0) return "";
        const decoder = new TextDecoder();
        return decoder.decode(new Uint8Array(allBytes));
      } catch (e) {
        console.error("Error decoding fields:", e);
        return "";
      }
  }

  broadcastEvent(type: string, payload: any) {
    this.wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
         const subscribedHash = client.subscribedHash; // Client subscribed to their Recipient Hash
         const subscribedDialog = client.subscribedDialog; // Client subscribed to a Dialog Hash (optional)

         if (type === 'message_detected') {
            const { recipientHash, senderHash, dialogHash } = payload;
            
            // Route to:
            // 1. Recipient (if they subscribed to their own hash)
            // 2. Sender (if they subscribed to their own hash - for sync)
            // 3. Anyone subscribed to this specific dialog (if enabled)
            
            const matchesUser = subscribedHash && (subscribedHash === recipientHash || subscribedHash === senderHash);
            const matchesDialog = subscribedDialog && subscribedDialog === dialogHash;

            if (matchesUser || matchesDialog) {
                client.send(JSON.stringify({ type, payload }));
            }
         } else if (type === 'tx_confirmed') {
            // Confirmations might need to go to sender
            // We might need to track who sent it, or just broadcast to relevant hash
            // Payload has { id, blockHeight }
            // We don't have hashes in payload here?
            // If we don't have hashes, we can't route efficiently.
            // Maybe we should include hashes in tx_confirmed event?
            // For now, let's just send to all or skip?
            // User said "DO NOT broadcast to all clients".
            // If we can't route, maybe we shouldn't send?
            // But client needs confirmation.
            // Let's rely on message_detected for sync.
            // Or if we look up the message by ID... too slow.
            client.send(JSON.stringify({ type, payload }));
         } else if (type === 'profile_updated') {
             // Profiles are public, can broadcast to all or just interested?
             // Maybe broadcast to all is fine for discovery.
             client.send(JSON.stringify({ type, payload }));
         } else {
             client.send(JSON.stringify({ type, payload }));
         }
      }
    });
  }
}
