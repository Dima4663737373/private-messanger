/**
 * useXMTP — React hook for XMTP decentralized messaging.
 *
 * Architecture:
 * - WebSocket remains the PRIMARY transport (instant, existing flow unchanged)
 * - XMTP is a SECONDARY transport (decentralized backup, 60-day retention)
 * - Both sender and recipient are auto-registered on XMTP when they connect
 * - Messages are sent via both channels simultaneously (background for XMTP)
 * - Messages can be recovered from XMTP if the backend/WebSocket is down
 *
 * Multi-tab handling:
 * - dbPath: null → no OPFS database → no multi-tab conflicts
 * - Each tab initializes its own in-memory XMTP client
 * - Messages are fetched fresh from XMTP network when needed
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Client, IdentifierKind, type DecodedMessage } from '@xmtp/browser-sdk';
import { createXmtpSigner, getXmtpEthAddress } from '../utils/xmtp-signer';
import { logger } from '../utils/logger';

// ----- Types -----

export interface XmtpMessage {
  id: string;
  senderInboxId: string;
  content: string;
  sentAt: Date;
  conversationId: string;
  isMine: boolean;
}

export interface UseXmtpReturn {
  /** Whether XMTP client is ready to send/receive */
  isXmtpReady: boolean;
  /** Error message if XMTP failed to initialize */
  xmtpError: string | null;
  /** The derived Ethereum address used as XMTP identity */
  xmtpIdentity: string | null;
  /** Send a message via XMTP (returns true if sent successfully) */
  sendXmtpMessage: (recipientAleoAddress: string, plaintext: string) => Promise<boolean>;
  /** Fetch recent XMTP message history for a dialog */
  getXmtpHistory: (recipientAleoAddress: string, limit?: number) => Promise<XmtpMessage[]>;
  /** Check if a recipient is registered on XMTP */
  canXmtpMessage: (recipientAleoAddress: string) => Promise<boolean>;
}

// ----- Hook -----

export function useXMTP(aleoAddress: string | null): UseXmtpReturn {
  const [isXmtpReady, setIsXmtpReady] = useState(false);
  const [xmtpError, setXmtpError] = useState<string | null>(null);
  const [xmtpIdentity, setXmtpIdentity] = useState<string | null>(null);

  const clientRef = useRef<Client | null>(null);
  const myInboxIdRef = useRef<string | null>(null);
  const initAttemptedRef = useRef<string | null>(null); // track which address we initialized for

  // Initialize XMTP client when Aleo address becomes available
  useEffect(() => {
    if (!aleoAddress) {
      // Cleanup on disconnect
      clientRef.current?.close();
      clientRef.current = null;
      myInboxIdRef.current = null;
      setIsXmtpReady(false);
      setXmtpError(null);
      setXmtpIdentity(null);
      initAttemptedRef.current = null;
      return;
    }

    // Don't re-initialize for the same address
    if (initAttemptedRef.current === aleoAddress) return;
    initAttemptedRef.current = aleoAddress;

    const initialize = async () => {
      try {
        logger.info('[XMTP] Initializing client for', aleoAddress.slice(0, 12) + '...');

        const signer = createXmtpSigner(aleoAddress);
        const ethAddress = getXmtpEthAddress(aleoAddress);
        setXmtpIdentity(ethAddress);

        const client = await Client.create(signer, {
          env: 'production',
          // dbPath: null → no local SQLite database
          // This avoids OPFS multi-tab conflicts entirely
          // Messages are always fetched from XMTP network
          dbPath: null,
          appVersion: 'ghost-messenger/1.0',
        });

        clientRef.current = client;
        myInboxIdRef.current = client.inboxId ?? null;
        setIsXmtpReady(true);
        setXmtpError(null);

        logger.info('[XMTP] Ready. InboxId:', client.inboxId?.slice(0, 12) + '...');
      } catch (err: any) {
        const msg: string = err?.message ?? String(err);

        // Known non-fatal errors
        if (
          msg.includes('lock') ||
          msg.includes('OPFS') ||
          msg.includes('unable to open') ||
          msg.includes('SharedArrayBuffer')
        ) {
          logger.warn('[XMTP] Storage conflict (likely multi-tab). XMTP disabled for this tab.');
          setXmtpError('multi-tab');
        } else {
          logger.error('[XMTP] Init failed:', msg);
          setXmtpError(msg);
        }

        // Reset so a retry can happen if address changes
        if (initAttemptedRef.current === aleoAddress) {
          initAttemptedRef.current = null;
        }
      }
    };

    initialize();

    return () => {
      // Cleanup when address changes or component unmounts
      clientRef.current?.close();
      clientRef.current = null;
      myInboxIdRef.current = null;
      setIsXmtpReady(false);
      initAttemptedRef.current = null;
    };
  }, [aleoAddress]);

  // ----- Check if recipient is on XMTP -----

  const canXmtpMessage = useCallback(async (recipientAleoAddress: string): Promise<boolean> => {
    const client = clientRef.current;
    if (!client || !isXmtpReady) return false;

    try {
      const ethAddress = getXmtpEthAddress(recipientAleoAddress);
      const result = await client.canMessage([
        { identifier: ethAddress, identifierKind: IdentifierKind.Ethereum },
      ]);
      return result.get(ethAddress) === true;
    } catch (err: any) {
      logger.debug('[XMTP] canMessage error:', err?.message);
      return false;
    }
  }, [isXmtpReady]);

  // ----- Send a message via XMTP -----

  const sendXmtpMessage = useCallback(async (
    recipientAleoAddress: string,
    plaintext: string,
  ): Promise<boolean> => {
    const client = clientRef.current;
    if (!client || !isXmtpReady) return false;

    try {
      const ethAddress = getXmtpEthAddress(recipientAleoAddress);

      // Check registration first
      const canMsg = await client.canMessage([
        { identifier: ethAddress, identifierKind: IdentifierKind.Ethereum },
      ]);

      if (!canMsg.get(ethAddress)) {
        logger.debug('[XMTP] Recipient not on XMTP, skipping', recipientAleoAddress.slice(0, 12) + '...');
        return false;
      }

      // Get recipient's inbox ID
      const inboxId = await client.getInboxIdByIdentifier({
        identifier: ethAddress,
        identifierKind: IdentifierKind.Ethereum,
      });

      if (!inboxId) {
        logger.debug('[XMTP] No inbox ID for recipient');
        return false;
      }

      // Create or get existing DM conversation
      const dm = await client.conversations.createDm(inboxId);
      await dm.sendText(plaintext);

      logger.debug('[XMTP] Message sent via XMTP');
      return true;
    } catch (err: any) {
      logger.error('[XMTP] Send error:', err?.message);
      return false;
    }
  }, [isXmtpReady]);

  // ----- Fetch XMTP message history -----

  const getXmtpHistory = useCallback(async (
    recipientAleoAddress: string,
    limit = 50,
  ): Promise<XmtpMessage[]> => {
    const client = clientRef.current;
    if (!client || !isXmtpReady) return [];

    try {
      const ethAddress = getXmtpEthAddress(recipientAleoAddress);

      const inboxId = await client.getInboxIdByIdentifier({
        identifier: ethAddress,
        identifierKind: IdentifierKind.Ethereum,
      });

      if (!inboxId) return [];

      const dm = await client.conversations.createDm(inboxId);
      await dm.sync();

      const rawMessages = await dm.messages({ limit: BigInt(limit) });
      const myInboxId = myInboxIdRef.current;

      return rawMessages
        .filter((msg): msg is DecodedMessage<string> => typeof msg.content === 'string')
        .map(msg => ({
          id: msg.id,
          senderInboxId: msg.senderInboxId,
          content: msg.content as string,
          sentAt: msg.sentAt,
          conversationId: dm.id,
          isMine: msg.senderInboxId === myInboxId,
        }));
    } catch (err: any) {
      logger.error('[XMTP] History fetch error:', err?.message);
      return [];
    }
  }, [isXmtpReady]);

  return {
    isXmtpReady,
    xmtpError,
    xmtpIdentity,
    sendXmtpMessage,
    getXmtpHistory,
    canXmtpMessage,
  };
}
