
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { WalletProvider, useWallet } from "@demox-labs/aleo-wallet-adapter-react";
import { LeoWalletAdapter } from "@demox-labs/aleo-wallet-adapter-leo";
import { WalletAdapterNetwork, DecryptPermission } from "@demox-labs/aleo-wallet-adapter-base";
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import LandingPage from './components/LandingPage';
import Preloader from './components/Preloader';
import { AppView, Chat, Message, Contact, DisappearTimer, DISAPPEAR_TIMERS, Room, RoomType, ChatContextAction } from './types';
import { uploadFileToIPFS } from './utils/ipfs';
import { hashAddress } from './utils/aleo-utils';
import { getAccountBalance } from './utils/aleo-rpc';
import { logger } from './utils/logger';
import ContactsView from './components/ContactsView';
import SettingsView from './components/SettingsView';
import { Toaster, toast } from 'react-hot-toast';
import { mapErrorToUserMessage } from './utils/errors';
import { TransactionProgress } from './components/ui/TransactionProgress';
import { useSync } from './hooks/useSync';
import { useContract } from './hooks/useContract';
// lucide icons removed - FAB is now in Sidebar
import ProfileView from './components/ProfileView';

const mapContactToChat = (contact: Contact, isActive: boolean): Chat => ({
  id: contact.id,
  name: contact.name,
  avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(contact.name)}&background=random&color=fff`,
  status: 'offline',
  lastMessage: contact.lastMessage || 'Encrypted connection established',
  time: contact.lastMessageTime ? new Date(contact.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
  unreadCount: contact.unreadCount || 0,
  type: 'private',
  address: contact.address
});

const InnerApp: React.FC = () => {
  const { publicKey, wallet, requestTransaction, disconnect, select, wallets } = useWallet();
  const { executeTransaction, sendMessageOnChain, registerProfile: registerProfileOnChain, deleteMessage: deleteMessageOnChain, editMessage: editMessageOnChain, loading: contractLoading } = useContract();

  // Contacts State - In-Memory Only (Declared first to avoid ReferenceError)
  const [contacts, setContacts] = useState<Contact[]>([]);
  
  const decryptionCache = useRef<Record<string, string>>({});

  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>('chats');
  const [isInitializing, setIsInitializing] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  // Transaction Progress State
  const [txStatus, setTxStatus] = useState<{ step: 'idle' | 'preparing' | 'signing' | 'broadcasting' | 'confirming' | 'confirmed' | 'failed', txId?: string, error?: string }>({ step: 'idle' });

  // Data State
  const [chats, setChats] = useState<Chat[]>([]);
  const [histories, setHistories] = useState<Record<string, Message[]>>({});
  const [myProfile, setMyProfile] = useState<{username?: string, bio?: string} | null>(null);
  const [viewingProfile, setViewingProfile] = useState<Contact | any | null>(null);

  // Room State (Channels & Groups)
  const [channels, setChannels] = useState<Room[]>([]);
  const [groups, setGroups] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [roomHistories, setRoomHistories] = useState<Record<string, Message[]>>({});
  const [roomMembers, setRoomMembers] = useState<string[]>([]);

  // FAB Modal State
  const [fabModal, setFabModal] = useState<RoomType | null>(null);
  const [fabModalName, setFabModalName] = useState('');

  // New Message Modal State (for chats FAB)
  const [newMsgModal, setNewMsgModal] = useState(false);
  const [newMsgAddress, setNewMsgAddress] = useState('');
  const [newMsgName, setNewMsgName] = useState('');

  // Sidebar context-menu state: pinned & muted chat/channel/group IDs (localStorage)
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>([]);
  const [mutedChatIds, setMutedChatIds] = useState<string[]>([]);

  // Pins State (contextId -> pinned message objects)
  const [pinnedMessages, setPinnedMessages] = useState<Record<string, any[]>>({});
  
  // SYNC
  const handleNewMessage = React.useCallback((msg: Message & { recipient?: string, recipientHash?: string, dialogHash?: string }) => {
    // Determine counterparty
    let counterpartyAddress = msg.isMine ? msg.recipient : msg.senderId;
    
    // Handle 'unknown' recipient for sent messages — skip them (can't send on-chain)
    if (msg.isMine && (counterpartyAddress === 'unknown' || !counterpartyAddress)) {
         logger.warn('Skipping message with unknown recipient:', msg.recipientHash);
         return;
    }

    if (!counterpartyAddress) return; 

    // Check cache to avoid re-toast for same message ID if we processed it
    if (decryptionCache.current[msg.id]) return; 
    decryptionCache.current[msg.id] = msg.text;

    toast(`New message ${msg.isMine ? 'sent' : 'received'}`, { icon: '📨' });

    // Browser Notification when tab is not focused
    if (!msg.isMine && document.hidden && Notification.permission === 'granted') {
      new Notification('Ghost Messenger', {
        body: msg.text.length > 60 ? msg.text.slice(0, 60) + '...' : msg.text,
        icon: '/ghost-icon.png',
        tag: msg.id // Prevents duplicate notifications
      });
    }
    
    setContacts(prevContacts => {
      // Try to find by address OR dialogHash
      const existingIndex = prevContacts.findIndex(c => 
          c.address === counterpartyAddress || (msg.dialogHash && c.dialogHash === msg.dialogHash)
      );

      if (existingIndex === -1) {
        // Create new contact
        const newContact: Contact = {
          id: counterpartyAddress,
          name: `User ${counterpartyAddress.slice(0, 6)}...`,
          address: counterpartyAddress,
          dialogHash: msg.dialogHash,
          description: 'Discovered from network',
          context: 'Network',
          initials: 'UK',
          unreadCount: msg.isMine ? 0 : 1,
          lastMessage: msg.text,
          lastMessageTime: new Date()
        };
        // Fetch profile for this new contact
        if (counterpartyAddress.startsWith('aleo1')) {
            syncProfile(counterpartyAddress).then(profile => {
                 if (profile && profile.username) {
                     setContacts(curr => curr.map(c => c.id === counterpartyAddress ? { ...c, name: profile.username, initials: profile.username.slice(0,2).toUpperCase() } : c));
                 }
            });
        }
        return [...prevContacts, newContact];
      }
      
      // Update existing
      return prevContacts.map((c, idx) => {
          if (idx === existingIndex) {
              return { 
                  ...c, 
                  dialogHash: msg.dialogHash || c.dialogHash, // Ensure dialogHash is set
                  lastMessage: msg.text, 
                  lastMessageTime: new Date(),
                  unreadCount: msg.isMine ? c.unreadCount : (c.unreadCount || 0) + 1
              };
          }
          return c;
      });
    });

    // Use counterpartyAddress directly as contactId (matches contact.id we set above)
    const contactId = counterpartyAddress;

    setHistories(prev => {
       const current = prev[contactId] || [];

       // If message exists, update it (e.g. status change)
       const existingIndex = current.findIndex(m => m.id === msg.id);
       if (existingIndex !== -1) {
           const updatedList = [...current];
           updatedList[existingIndex] = { ...updatedList[existingIndex], ...msg };
           return { ...prev, [contactId]: updatedList };
       }

       return {
         ...prev,
         [contactId]: [...current, msg]
       };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Uses functional updates for state (no stale closures). syncProfile is stable by behavior.
  }, []);

  const handleMessageDeleted = React.useCallback((msgId: string) => {
      setHistories(prev => {
          const newHistories = { ...prev };
          for (const chatId in newHistories) {
              if (newHistories[chatId].some(m => m.id === msgId)) {
                  newHistories[chatId] = newHistories[chatId].filter(m => m.id !== msgId);
                  break;
              }
          }
          return newHistories;
      });
  }, []);

  const handleMessageUpdated = React.useCallback((msgId: string, newText: string) => {
      setHistories(prev => {
          const newHistories = { ...prev };
          for (const chatId in newHistories) {
              const idx = newHistories[chatId].findIndex(m => m.id === msgId);
              if (idx !== -1) {
                  const msgs = [...newHistories[chatId]];
                  msgs[idx] = { ...msgs[idx], text: newText, edited: true };
                  newHistories[chatId] = msgs;
                  break;
              }
          }
          return newHistories;
      });
  }, []);

  const handleReactionUpdate = React.useCallback((msgId: string, reactions: Record<string, string[]>) => {
      setHistories(prev => {
          const newHistories = { ...prev };
          for (const chatId in newHistories) {
              const idx = newHistories[chatId].findIndex(m => m.id === msgId);
              if (idx !== -1) {
                  const msgs = [...newHistories[chatId]];
                  msgs[idx] = { ...msgs[idx], reactions };
                  newHistories[chatId] = msgs;
                  break;
              }
          }
          return newHistories;
      });
  }, []);

  // Room callbacks
  const handleRoomMessage = React.useCallback((roomId: string, msg: Message) => {
    setRoomHistories(prev => {
      const current = prev[roomId] || [];
      if (current.some(m => m.id === msg.id)) return prev;
      return { ...prev, [roomId]: [...current, msg] };
    });
  }, []);

  const handleRoomCreated = React.useCallback((room: Room) => {
    if (room.type === 'channel') {
      setChannels(prev => prev.some(r => r.id === room.id) ? prev : [...prev, room]);
    } else {
      setGroups(prev => prev.some(r => r.id === room.id) ? prev : [...prev, room]);
    }
  }, []);

  const handleRoomDeleted = React.useCallback((roomId: string) => {
    setChannels(prev => prev.filter(r => r.id !== roomId));
    setGroups(prev => prev.filter(r => r.id !== roomId));
    if (activeRoomId === roomId) setActiveRoomId(null);
    setRoomHistories(prev => {
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
  }, [activeRoomId]);

  const handleDMCleared = React.useCallback((dialogHash: string) => {
    // Use contacts ref via functional update to avoid stale closure
    setContacts(currentContacts => {
      setHistories(prev => {
        const next = { ...prev };
        for (const chatId in next) {
          const contact = currentContacts.find(c => c.id === chatId);
          if (contact?.dialogHash === dialogHash) {
            next[chatId] = [];
            break;
          }
        }
        return next;
      });
      return currentContacts; // Don't modify contacts
    });
  }, []);

  const handlePinUpdate = React.useCallback((contextId: string, pins: any[]) => {
    setPinnedMessages(prev => ({ ...prev, [contextId]: pins }));
  }, []);

  const handleRoomMessageDeleted = React.useCallback((roomId: string, messageId: string) => {
    setRoomHistories(prev => {
      const msgs = prev[roomId];
      if (!msgs) return prev;
      return { ...prev, [roomId]: msgs.filter(m => m.id !== messageId) };
    });
  }, []);

  const handleRoomMessageEdited = React.useCallback((roomId: string, messageId: string, text: string) => {
    setRoomHistories(prev => {
      const msgs = prev[roomId];
      if (!msgs) return prev;
      return { ...prev, [roomId]: msgs.map(m => m.id === messageId ? { ...m, text, edited: true } : m) };
    });
  }, []);

  const handleDMSent = React.useCallback((tempId: string, realId: string) => {
    // Replace tempId with real ID in all histories
    setHistories(prev => {
      const next = { ...prev };
      for (const chatId in next) {
        const msgs = next[chatId];
        const idx = msgs.findIndex(m => m.id === tempId);
        if (idx !== -1) {
          next[chatId] = msgs.map(m => m.id === tempId ? { ...m, id: realId, status: 'sent' as const } : m);
          // Cache the text so handleNewMessage deduplicates
          if (decryptionCache.current) {
            decryptionCache.current[realId] = msgs[idx].text;
          }
          break;
        }
      }
      return next;
    });
  }, []);

  const { isConnected: isSyncConnected, typingUsers, notifyProfileUpdate, searchProfiles, fetchMessages, fetchDialogs, fetchDialogMessages, syncProfile, cacheDecryptedMessage, sendTyping, addReaction, removeReaction, fetchRooms, createRoom, deleteRoom: deleteRoomApi, renameRoom: renameRoomApi, joinRoom, leaveRoom, fetchRoomInfo, fetchRoomMessages, sendRoomMessage, subscribeRoom, sendRoomTyping, clearDMHistory, deleteRoomMessage, editRoomMessage, sendDMMessage, deleteDMMessage, editDMMessage, fetchPins, pinMessage, unpinMessage } = useSync(publicKey, handleNewMessage, handleMessageDeleted, handleMessageUpdated, handleReactionUpdate, handleRoomMessage, handleRoomCreated, handleRoomDeleted, handleDMCleared, handlePinUpdate, handleRoomMessageDeleted, handleRoomMessageEdited, handleDMSent);

  // Load pinned/muted IDs + blockchain proof toggle from localStorage
  useEffect(() => {
    if (publicKey) {
      try {
        const p = localStorage.getItem(`ghost_pinned_${publicKey}`);
        if (p) setPinnedChatIds(JSON.parse(p));
        const m = localStorage.getItem(`ghost_muted_${publicKey}`);
        if (m) setMutedChatIds(JSON.parse(m));
      } catch { /* ignore */ }
    }
  }, [publicKey]);

  // Disappearing Messages — per-chat timer stored in localStorage
  const [disappearTimers, setDisappearTimers] = useState<Record<string, DisappearTimer>>({});

  useEffect(() => {
    if (publicKey) {
      try {
        const stored = localStorage.getItem(`ghost_disappear_${publicKey}`);
        if (stored) setDisappearTimers(JSON.parse(stored));
      } catch { /* ignore */ }
    }
  }, [publicKey]);

  const setDisappearTimer = (chatId: string, timer: DisappearTimer) => {
    setDisappearTimers(prev => {
      const updated = { ...prev, [chatId]: timer };
      if (publicKey) {
        try { localStorage.setItem(`ghost_disappear_${publicKey}`, JSON.stringify(updated)); } catch { /* ignore */ }
      }
      return updated;
    });
    toast.success(timer === 'off' ? 'Disappearing messages disabled' : `Messages will disappear after ${timer}`);
  };

  // Disappearing messages cleanup timer
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setHistories(prev => {
        let changed = false;
        const newHistories = { ...prev };
        for (const chatId in newHistories) {
          const timer = disappearTimers[chatId];
          if (!timer || timer === 'off') continue;
          const ttl = DISAPPEAR_TIMERS[timer];
          if (!ttl) continue;
          const filtered = newHistories[chatId].filter(m => {
            if (!m.timestamp) return true;
            return now - m.timestamp < ttl;
          });
          if (filtered.length !== newHistories[chatId].length) {
            newHistories[chatId] = filtered;
            changed = true;
          }
        }
        return changed ? newHistories : prev;
      });
    }, 5000); // Check every 5s
    return () => clearInterval(interval);
  }, [disappearTimers]);

  // Sync initial messages & Profile
  useEffect(() => {
    if (!isSyncConnected || !publicKey) return;

    // 1. Sync My Profile
    syncProfile(publicKey).then(profile => {
      if (profile) {
        logger.debug("Synced profile:", profile);
        setMyProfile({ username: profile.username, bio: profile.bio });
      }
    });

    // 2. Sync Dialogs (Conversations)
    const loadDialogs = async () => {
      try {
        const addressHash = hashAddress(publicKey);
        const dialogs = await fetchDialogs(addressHash);
        if (dialogs.length === 0) return;

        const newContacts: Contact[] = [];

        // Process each dialog
        for (const dialogMsg of dialogs) {
          const isMine = dialogMsg.sender === publicKey;
          const counterpartyAddress = isMine ? dialogMsg.recipient : dialogMsg.sender;

          let finalAddress = counterpartyAddress;
          let displayName = `User ${counterpartyAddress.slice(0, 6)}...`;

          if (counterpartyAddress === 'unknown' && isMine) {
            // Skip unknown recipients (can't send on-chain messages to them)
            logger.warn('Skipping dialog with unknown recipient:', dialogMsg.recipient_hash);
            continue;
          }

          // Use decrypted text from fetchDialogs
          let previewText = dialogMsg.text || "Encrypted Message";
          if (decryptionCache.current[dialogMsg.id]) {
            previewText = decryptionCache.current[dialogMsg.id];
          }

          newContacts.push({
            id: finalAddress,
            name: displayName,
            address: finalAddress,
            dialogHash: dialogMsg.dialog_hash,
            description: 'Synced conversation',
            context: 'Network',
            initials: 'UK',
            unreadCount: 0,
            lastMessage: previewText,
            lastMessageTime: new Date(dialogMsg.timestamp)
          });

          // Fetch profile for aleo addresses
          if (finalAddress.startsWith("aleo")) {
            syncProfile(finalAddress).then(profile => {
              if (profile && profile.username) {
                setContacts(curr => curr.map(c =>
                  c.id === finalAddress
                    ? { ...c, name: profile.username, initials: profile.username.slice(0,2).toUpperCase() }
                    : c
                ));
              }
            });
          }
        }

        // Add new contacts (check duplicates via functional update to avoid stale closure)
        if (newContacts.length > 0) {
          setContacts(prev => {
            const combined = [...prev];
            newContacts.forEach(nc => {
              if (!combined.some(c => c.id === nc.id)) combined.push(nc);
            });
            return combined;
          });
        }
      } catch (e) {
        logger.error("Failed to sync dialogs:", e);
      }
    };

    loadDialogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // syncProfile, fetchDialogs, hashAddress are from useSync — stable by behavior but not by reference
  }, [isSyncConnected, publicKey]);

  // Load Channels & Groups on connect
  useEffect(() => {
    if (isSyncConnected && publicKey) {
      fetchRooms('channel').then(setChannels);
      fetchRooms('group').then(setGroups);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // fetchRooms is from useSync — stable by behavior
  }, [isSyncConnected, publicKey]);

  // Initialize
  useEffect(() => {
    const timer = setTimeout(() => setIsInitializing(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Request notification permission on wallet connect
  useEffect(() => {
    if (publicKey && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [publicKey]);

  // Fetch Balance (Initial + Single Interval)
  useEffect(() => {
    if (publicKey) {
      getAccountBalance(publicKey).then(setBalance);
      // Keep balance polling for now as it's not message sync
      const interval = setInterval(() => {
        getAccountBalance(publicKey).then(setBalance);
      }, 30000); 
      return () => clearInterval(interval);
    } else {
      setBalance(null);
    }
  }, [publicKey]);

  // Update Chats derived from Contacts
  useEffect(() => {
    const derivedChats = contacts.map(c => mapContactToChat(c, c.id === activeChatId));
    setChats(derivedChats);
  }, [contacts, activeChatId]);

  const activeDialogHash = useMemo(() => {
    return contacts.find(c => c.id === activeChatId)?.dialogHash;
  }, [contacts, activeChatId]);

  // Load messages when active chat changes
  useEffect(() => {
    if (!activeChatId || !publicKey || !activeDialogHash) return;

    fetchDialogMessages(activeDialogHash, { limit: 50 }).then(msgs => {
      if (msgs && msgs.length > 0) {
        setHistories(prev => ({
          ...prev,
          [activeChatId]: msgs.sort((a, b) => a.timestamp - b.timestamp)
        }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // fetchDialogMessages is from useSync — stable by behavior
  }, [activeChatId, activeDialogHash, publicKey]); 


  const handleConnectWallet = async () => {
    // If wallet is not selected, select it first
    if (!wallet && wallets.length > 0) {
        select(wallets[0].adapter.name);
        // We need to wait for the wallet to be selected in state
        // Since we can't await state update in this closure, we'll rely on the user clicking again
        // OR we can rely on the wallet adapter's internal state if we access it directly from `wallets`
        
        // Try to connect directly using the adapter instance if possible
        const adapter = wallets[0].adapter;
              if (adapter && !adapter.connected) {
                   setIsConnecting(true);
                   try {
                      await adapter.connect(
                        DecryptPermission.OnChainHistory,
                        WalletAdapterNetwork.TestnetBeta
                      );
                      toast.success('Wallet connected successfully');
                   } catch (err: any) {
                logger.error("Connection failed:", err);
                toast.error(mapErrorToUserMessage(err));
             } finally {
                setIsConnecting(false);
             }
        }
        return;
    }

    if (wallet?.adapter && !publicKey) {
            setIsConnecting(true);
            try {
              await wallet.adapter.connect(
                DecryptPermission.OnChainHistory,
                WalletAdapterNetwork.TestnetBeta
              );
              toast.success('Wallet connected successfully');
      } catch (err: any) {
        logger.error("Connection failed:", err);
        toast.error(mapErrorToUserMessage(err));
      } finally {
        setIsConnecting(false);
      }
    }
  };

  const handleSendMessage = async (text: string, file?: File, replyTo?: { id: string; text: string; sender: string }) => {
    if (!activeChatId || !publicKey) return;

    const contact = contacts.find(c => c.id === activeChatId);
    if (!contact || !contact.address) return;

    // Validate recipient address for on-chain transactions
    if (!contact.address.startsWith('aleo1')) {
      toast.error('Cannot send on-chain message: Invalid recipient address');
      logger.error('Invalid recipient address:', contact.address);
      return;
    }

    setIsSendingMessage(true);

    try {
      let attachmentCID: string | undefined;
      if (file) {
        toast.loading("Uploading attachment to IPFS...", { id: "ipfs-upload" });
        attachmentCID = await uploadFileToIPFS(file);
        toast.success("Attachment uploaded", { id: "ipfs-upload" });
      }

      // 1. Off-chain via backend WebSocket (instant delivery)
      const result = await sendDMMessage(contact.address, text, attachmentCID);

      if (!result) {
        toast.error('Not connected to server. Please wait and try again.');
        return;
      }

      const { tempId, encryptedPayload, timestamp } = result;

      // 2. Optimistic UI with tempId
      const newMessage: Message = {
        id: tempId,
        text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp,
        senderId: 'me',
        isMine: true,
        status: 'pending',
        replyToId: replyTo?.id,
        replyToText: replyTo?.text,
        replyToSender: replyTo?.sender,
        attachment: file && attachmentCID ? {
          type: file.type.startsWith('image/') ? 'image' : 'file',
          cid: attachmentCID,
          name: file.name,
          size: file.size,
          mimeType: file.type
        } : undefined
      };

      setHistories(prev => ({
        ...prev,
        [activeChatId]: [...(prev[activeChatId] || []), newMessage]
      }));

      // Cache the plaintext so deduplication works when dm_sent / message_detected arrives
      cacheDecryptedMessage(tempId, text);

      // 3. On-chain transaction (REQUIRED - wallet popup)
      try {
        toast.loading('Waiting for transaction approval...', { id: 'tx-approval' });
        const txId = await sendMessageOnChain(contact.address!, encryptedPayload, timestamp, attachmentCID);
        toast.dismiss('tx-approval');

        if (txId) {
          logger.debug('On-chain message txId:', txId);
          toast.success('Message sent on-chain');
          // Update message with txId
          setHistories(prev => {
            const msgs = prev[activeChatId!];
            if (!msgs) return prev;
            return { ...prev, [activeChatId!]: msgs.map(m => m.id === tempId || m.timestamp === timestamp ? { ...m, txId, status: 'confirmed' } : m) };
          });
        }
      } catch (e: any) {
        toast.dismiss('tx-approval');
        logger.error('On-chain transaction failed:', e?.message);
        toast.error('Transaction failed: ' + (e?.message || 'Unknown error'));
        // Remove optimistic message on failure
        setHistories(prev => ({
          ...prev,
          [activeChatId]: (prev[activeChatId] || []).filter(m => m.id !== tempId)
        }));
        throw e; // Re-throw to trigger outer catch
      }
    } catch (error) {
      logger.error("Failed to send message", error);
      toast.error('Failed to send message');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleAddContact = (address: string, name: string) => {
    if (!publicKey) {
        toast.error('Connect wallet to add contacts');
        return;
    }

    // Check for duplicates
    if (contacts.some(c => c.address === address)) {
        toast('Contact already exists', { icon: 'ℹ️' });
        return;
    }

    const newContact: Contact = {
      id: address, // Use address as ID for uniqueness
      name,
      address,
      description: 'Added via contacts',
      context: 'Manual add',
      initials: name.slice(0, 2).toUpperCase(),
      unreadCount: 0
    };

    const updatedContacts = [...contacts, newContact];
    setContacts(updatedContacts);
    localStorage.setItem(`ghost_contacts_${publicKey}`, JSON.stringify(updatedContacts));
    toast.success(`Contact ${name} added`);
  };

  const handleEditContact = (id: string, newName: string) => {
    if (!publicKey) return;
    setContacts(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, name: newName, initials: newName.slice(0, 2).toUpperCase() } : c);
      localStorage.setItem(`ghost_contacts_${publicKey}`, JSON.stringify(updated));
      return updated;
    });
    toast.success('Contact renamed');
  };

  const handleDeleteContact = (id: string) => {
    if (!publicKey) return;
    setContacts(prev => {
      const updated = prev.filter(c => c.id !== id);
      localStorage.setItem(`ghost_contacts_${publicKey}`, JSON.stringify(updated));
      return updated;
    });
    if (activeChatId === id) setActiveChatId(null);
    toast.success('Contact deleted');
  };

  const handleCreateProfile = async (name: string, bio: string) => {
    if (!publicKey) return;
    setIsProcessing(true);

    try {
      // 1. Off-chain profile save
      await notifyProfileUpdate(name, bio, 'off-chain');
      setMyProfile({ username: name, bio });

      // 2. On-chain profile registration (REQUIRED - wallet popup)
      toast.loading('Waiting for transaction approval...', { id: 'profile-tx' });
      await registerProfileOnChain();
      toast.dismiss('profile-tx');
      toast.success('Profile created on-chain');
      logger.debug('On-chain profile registered');
    } catch (e: any) {
      toast.dismiss('profile-tx');
      logger.error("Failed to create profile", e);
      toast.error('Profile creation failed: ' + (e?.message || 'Unknown error'));
      // Rollback optimistic update
      setMyProfile(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateProfile = async (name: string, bio: string) => {
    if (!publicKey) return;
    setIsProcessing(true);

    const oldProfile = myProfile;

    try {
      // 1. Off-chain profile update
      await notifyProfileUpdate(name, bio, 'off-chain');
      setMyProfile({ username: name, bio });

      // 2. On-chain profile update (REQUIRED - wallet popup)
      toast.loading('Waiting for transaction approval...', { id: 'profile-update-tx' });
      await registerProfileOnChain();
      toast.dismiss('profile-update-tx');
      toast.success('Profile updated on-chain');
      logger.debug('On-chain profile updated');
    } catch (e: any) {
      toast.dismiss('profile-update-tx');
      logger.error("Failed to update profile", e);
      toast.error('Profile update failed: ' + (e?.message || 'Unknown error'));
      // Rollback to old profile
      setMyProfile(oldProfile);
    } finally {
      setIsProcessing(false);
    }
  };


  const handleSendMessageFromProfile = (contact: Contact | any) => {
    // Check if contact exists
    const address = contact.address || contact.id; // Fallback if contact object structure varies
    const existing = contacts.find(c => c.address === address || c.id === address);
    
    if (existing) {
        setActiveChatId(existing.id);
    } else {
        // Add temp contact if not exists
        handleAddContact(address, contact.name || contact.username || 'Unknown');
        setActiveChatId(address);
    }
    setViewingProfile(null);
    setCurrentView('chats');
  };

  // --- Room Handlers ---
  const handleCreateRoom = async (name: string, type: RoomType) => {
    const result = await createRoom(name, type);
    if (result) {
      toast.success(`${type === 'channel' ? 'Channel' : 'Group'} "${name}" created`);
      fetchRooms(type).then(type === 'channel' ? setChannels : setGroups);

      // On-chain proof of creation (optional, non-blocking)
      if (publicKey) {
        (async () => {
          try {
            const nameHash = hashAddress(name);
            const creatorHash = hashAddress(publicKey);
            const fn = type === 'channel' ? 'create_channel' : 'create_group';
            await executeTransaction(fn, [nameHash, creatorHash]);
            toast.success(`On-chain ${type} proof recorded`);
          } catch (e: any) {
            logger.warn(`On-chain ${type} proof failed (non-critical):`, e?.message);
          }
        })();
      }
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    const room = [...channels, ...groups].find(r => r.id === roomId);
    await deleteRoomApi(roomId);
    setChannels(prev => prev.filter(r => r.id !== roomId));
    setGroups(prev => prev.filter(r => r.id !== roomId));
    if (activeRoomId === roomId) setActiveRoomId(null);
    toast.success('Room deleted');

    // On-chain deletion proof (optional, non-blocking)
    if (publicKey && room) {
      (async () => {
        try {
          const nameHash = hashAddress(room.name);
          const creatorHash = hashAddress(publicKey);
          const fn = room.type === 'channel' ? 'delete_channel' : 'delete_group';
          await executeTransaction(fn, [nameHash, creatorHash]);
        } catch (e: any) {
          logger.warn('On-chain room deletion failed (non-critical):', e?.message);
        }
      })();
    }
  };

  const handleJoinRoom = async (roomId: string) => {
    await joinRoom(roomId);
    subscribeRoom(roomId);
    toast.success('Joined room');
    // Refresh groups list
    fetchRooms('group').then(setGroups);
  };

  const handleLeaveRoom = async (roomId: string) => {
    await leaveRoom(roomId);
    if (activeRoomId === roomId) setActiveRoomId(null);
    toast.success('Left room');
    fetchRooms('group').then(setGroups);
  };

  const handleSelectRoom = async (roomId: string) => {
    setActiveRoomId(roomId);
    setActiveChatId(null);
    setRoomMembers([]);
    // Auto-join (idempotent on server: findOrCreate)
    await joinRoom(roomId);
    subscribeRoom(roomId);
    // Load room messages + members in parallel
    const [msgs, info] = await Promise.all([
      fetchRoomMessages(roomId),
      fetchRoomInfo(roomId)
    ]);
    setRoomHistories(prev => ({ ...prev, [roomId]: msgs }));
    if (info) setRoomMembers(info.members);
  };

  const handleSendRoomMessage = (text: string) => {
    if (!activeRoomId) return;
    sendRoomMessage(activeRoomId, text);
    // Optimistic update
    const tempMsg: Message = {
      id: Date.now().toString(),
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now(),
      senderId: 'me',
      isMine: true,
      status: 'sent',
      senderHash: myProfile?.username || publicKey?.slice(0, 10)
    };
    setRoomHistories(prev => ({
      ...prev,
      [activeRoomId]: [...(prev[activeRoomId] || []), tempMsg]
    }));
  };

  const handleDeleteRoomMessage = async (msgId: string) => {
    if (!activeRoomId) return;
    await deleteRoomMessage(activeRoomId, msgId);
    setRoomHistories(prev => ({
      ...prev,
      [activeRoomId]: (prev[activeRoomId] || []).filter(m => m.id !== msgId)
    }));
    toast.success('Message deleted');
  };

  const handleEditRoomMessage = async (msgId: string, newText: string) => {
    if (!activeRoomId) return;
    await editRoomMessage(activeRoomId, msgId, newText);
    setRoomHistories(prev => ({
      ...prev,
      [activeRoomId]: (prev[activeRoomId] || []).map(m => m.id === msgId ? { ...m, text: newText, edited: true } : m)
    }));
    toast.success('Message edited');
  };

  const handleClearDM = async () => {
    if (!activeChatId) return;
    const contact = contacts.find(c => c.id === activeChatId);
    if (!contact?.dialogHash) return;
    await clearDMHistory(contact.dialogHash);
    setHistories(prev => ({ ...prev, [activeChatId!]: [] }));
    toast.success('Chat history cleared');
  };

  const handleDeleteChat = (chatId: string) => {
    // Remove contact from state
    setContacts(prev => prev.filter(c => c.id !== chatId));
    // Clear history
    setHistories(prev => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
    // Close chat if it was active
    if (activeChatId === chatId) setActiveChatId(null);
    // Persist in localStorage
    if (publicKey) {
      const key = `ghost_deleted_chats_${publicKey}`;
      const deleted: string[] = JSON.parse(localStorage.getItem(key) || '[]');
      if (!deleted.includes(chatId)) {
        deleted.push(chatId);
        localStorage.setItem(key, JSON.stringify(deleted));
      }
      // Also update saved contacts
      const remaining = contacts.filter(c => c.id !== chatId);
      localStorage.setItem(`ghost_contacts_${publicKey}`, JSON.stringify(remaining));
    }
    toast.success('Chat deleted');
  };

  // --- Sidebar Context Menu Handler ---
  const handleContextAction = (action: ChatContextAction, id: string, itemType: 'chat' | 'channel' | 'group', newName?: string) => {
    switch (action) {
      case 'rename': {
        if (!newName) break;
        if (itemType === 'chat') {
          // Rename contact locally
          handleEditContact(id, newName);
        } else {
          // Rename room via backend
          renameRoomApi(id, newName).then(() => {
            if (itemType === 'channel') {
              setChannels(prev => prev.map(r => r.id === id ? { ...r, name: newName } : r));
            } else {
              setGroups(prev => prev.map(r => r.id === id ? { ...r, name: newName } : r));
            }
            toast.success('Renamed');
          });
        }
        break;
      }
      case 'pin': {
        setPinnedChatIds(prev => {
          const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
          if (publicKey) localStorage.setItem(`ghost_pinned_${publicKey}`, JSON.stringify(next));
          return next;
        });
        break;
      }
      case 'mute': {
        setMutedChatIds(prev => {
          const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
          if (publicKey) localStorage.setItem(`ghost_muted_${publicKey}`, JSON.stringify(next));
          return next;
        });
        toast.success(mutedChatIds.includes(id) ? 'Unmuted' : 'Muted');
        break;
      }
      case 'mark_unread': {
        if (itemType === 'chat') {
          setContacts(prev => prev.map(c => c.id === id ? { ...c, unreadCount: Math.max(c.unreadCount || 0, 1) } : c));
          toast.success('Marked as unread');
        }
        break;
      }
      case 'archive': {
        toast('Archive coming soon', { icon: '📦' });
        break;
      }
      case 'delete': {
        if (itemType === 'chat') {
          handleDeleteChat(id);
        } else {
          handleDeleteRoom(id);
        }
        break;
      }
      case 'open_new_tab': {
        // Open same URL in a new browser tab
        window.open(window.location.href, '_blank');
        break;
      }
    }
  };

  // --- Off-chain DM Delete / Edit (+ on-chain proof) ---
  const handleDeleteDMMessage = async (msgId: string) => {
    const msg = activeChatId ? (histories[activeChatId] || []).find(m => m.id === msgId) : undefined;

    // 1. Off-chain delete (instant)
    await deleteDMMessage(msgId);
    // Optimistic removal
    if (activeChatId) {
      setHistories(prev => ({
        ...prev,
        [activeChatId!]: (prev[activeChatId!] || []).filter(m => m.id !== msgId)
      }));
    }

    // 2. On-chain delete (REQUIRED)
    if (msg?.timestamp) {
      try {
        toast.loading('Deleting on-chain...', { id: 'delete-tx' });
        await deleteMessageOnChain(msg.timestamp!);
        toast.dismiss('delete-tx');
        toast.success('Message deleted on-chain');
        logger.debug('On-chain delete succeeded for timestamp:', msg.timestamp);
      } catch (e: any) {
        toast.dismiss('delete-tx');
        logger.error('On-chain delete failed:', e?.message);
        toast.error('On-chain delete failed: ' + (e?.message || 'Unknown error'));
      }
    }
  };

  const handleEditDMMessage = async (msgId: string, newText: string) => {
    if (!activeChatId) return;
    const contact = contacts.find(c => c.id === activeChatId);
    if (!contact?.address) return;
    const msg = (histories[activeChatId] || []).find(m => m.id === msgId);

    // 1. Off-chain edit (instant)
    await editDMMessage(msgId, newText, contact.address);
    // Optimistic update
    setHistories(prev => ({
      ...prev,
      [activeChatId!]: (prev[activeChatId!] || []).map(m => m.id === msgId ? { ...m, text: newText, edited: true } : m)
    }));

    // 2. On-chain edit (REQUIRED)
    if (msg?.timestamp && contact.address) {
      try {
        toast.loading('Updating on-chain...', { id: 'edit-tx' });
        await editMessageOnChain(msg.timestamp!, newText, contact.address!);
        toast.dismiss('edit-tx');
        toast.success('Message updated on-chain');
        logger.debug('On-chain edit succeeded for timestamp:', msg.timestamp);
      } catch (e: any) {
        toast.dismiss('edit-tx');
        logger.error('On-chain edit failed:', e?.message);
        toast.error('On-chain edit failed: ' + (e?.message || 'Unknown error'));
      }
    }
  };

  // --- Pin Handlers ---
  const handlePinMessage = async (msgId: string, msgText: string) => {
    const contextId = activeRoomId || activeDialogHash;
    if (!contextId) return;
    await pinMessage(contextId, msgId, msgText);
    const pins = await fetchPins(contextId);
    setPinnedMessages(prev => ({ ...prev, [contextId]: pins }));
    toast.success('Message pinned');
  };

  const handleUnpinMessage = async (msgId: string) => {
    const contextId = activeRoomId || activeDialogHash;
    if (!contextId) return;
    await unpinMessage(contextId, msgId);
    const pins = await fetchPins(contextId);
    setPinnedMessages(prev => ({ ...prev, [contextId]: pins }));
    toast.success('Message unpinned');
  };

  // Load pins when active chat/room changes
  useEffect(() => {
    const contextId = activeRoomId || activeDialogHash;
    if (!contextId || !isSyncConnected) return;
    fetchPins(contextId).then(pins => {
      setPinnedMessages(prev => ({ ...prev, [contextId]: pins }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // fetchPins is from useSync — stable by behavior
  }, [activeRoomId, activeDialogHash, isSyncConnected]);

  const handleLoadMore = async () => {
    if (!isSyncConnected || !publicKey || !activeChatId) return;
    
    const contact = contacts.find(c => c.id === activeChatId);
    if (!contact || !contact.dialogHash) {
        logger.warn("Cannot load more: No dialog hash for contact");
        return;
    }

    const currentMsgs = histories[activeChatId] || [];
    
    toast.loading("Loading older messages...", { id: "loading-more" });
    
    try {
        const olderMessages = await fetchDialogMessages(contact.dialogHash, { limit: 20, offset: currentMsgs.length });
        
        if (olderMessages.length > 0) {
            setHistories(prev => {
                const existing = prev[activeChatId] || [];
                // Merge and dedup
                const combined = [...existing];
                olderMessages.forEach(m => {
                     if (!combined.some(ex => ex.id === m.id)) combined.push(m);
                });
                combined.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                return { ...prev, [activeChatId]: combined };
            });
            toast.success(`Loaded ${olderMessages.length} older messages`, { id: "loading-more" });
        } else {
            toast("No more messages", { icon: 'End', id: "loading-more" });
        }
    } catch (e) {
        logger.error("Load more failed", e);
        toast.error("Failed to load history", { id: "loading-more" });
    }
  };

  if (isInitializing) return <Preloader />;

  if (!publicKey) {
    return (
      <>
        <Toaster 
          position="top-right"
          toastOptions={{
            style: {
              background: '#1A1A1A',
              color: '#fff',
              border: '1px solid #333',
            },
            success: {
              iconTheme: {
                primary: '#10B981',
                secondary: '#1A1A1A',
              },
            },
            error: {
              iconTheme: {
                primary: '#EF4444',
                secondary: '#1A1A1A',
              },
            },
          }}
        />
        <LandingPage onConnect={handleConnectWallet} isConnecting={isConnecting} />
      </>
    );
  }

  const activeChat = chats.find(c => c.id === activeChatId);
  const activeMessages = activeChatId ? (histories[activeChatId] || []) : [];
  const activeRoom = [...channels, ...groups].find(r => r.id === activeRoomId) || null;
  const activeRoomMessages = activeRoomId ? (roomHistories[activeRoomId] || []) : [];



  return (
    <div className="flex h-screen w-full bg-[#0A0A0A] overflow-hidden relative">
      <Toaster 
        position="top-right"
        toastOptions={{
          style: {
            background: '#1A1A1A',
            color: '#fff',
            border: '1px solid #333',
          },
          success: {
            iconTheme: {
              primary: '#10B981',
              secondary: '#1A1A1A',
            },
          },
          error: {
            iconTheme: {
              primary: '#EF4444',
              secondary: '#1A1A1A',
            },
          },
        }}
      />
      
      {/* Global Transaction Progress Overlay */}
      {txStatus.step !== 'idle' && (
        <div className="fixed bottom-4 right-4 z-[100] w-80 shadow-2xl">
          <TransactionProgress 
            step={txStatus.step} 
            txId={txStatus.txId} 
            error={txStatus.error} 
          />
        </div>
      )}

      {/* Profile View Overlay */}
      {viewingProfile && (
        <ProfileView 
          contact={viewingProfile} 
          onClose={() => setViewingProfile(null)} 
          onSendMessage={handleSendMessageFromProfile}
          onAddContact={handleAddContact}
          isContact={contacts.some(c => c.address === (viewingProfile.address || viewingProfile.id))}
        />
      )}

      <Sidebar
        activeChatId={activeChatId}
        onSelectChat={(id) => {
          setActiveChatId(id);
          setActiveRoomId(null);
          setCurrentView('chats');
          setContacts(prev => prev.map(c => c.id === id ? { ...c, unreadCount: 0 } : c));
        }}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        currentView={currentView}
        onSetView={setCurrentView}
        isWalletConnected={!!publicKey}
        onConnectWallet={handleConnectWallet}
        onDisconnect={() => disconnect && disconnect()}
        chats={chats}
        isConnecting={isConnecting}
        publicKey={publicKey}
        balance={balance}
        channels={channels}
        groups={groups}
        activeRoomId={activeRoomId}
        onSelectRoom={(id) => { handleSelectRoom(id); }}
        onCreateRoom={handleCreateRoom}
        onFabClick={() => {
          if (currentView === 'chats') {
            setNewMsgModal(true);
          } else {
            setFabModal(currentView === 'channels' ? 'channel' : 'group');
          }
        }}
        onContextAction={handleContextAction}
        pinnedIds={pinnedChatIds}
        mutedIds={mutedChatIds}
      />
      
      <main className="flex-1 flex overflow-hidden relative z-0 pointer-events-auto">
        {(currentView === 'chats' || currentView === 'channels' || currentView === 'groups') && (
          <ChatArea
            chatId={activeRoomId || activeChatId}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            activeChat={activeRoom ? { id: activeRoom.id, name: activeRoom.name, avatar: '', status: 'online' as const, lastMessage: '', time: '', unreadCount: 0, type: 'group' as const } : activeChat}
            messages={activeRoomId ? activeRoomMessages : activeMessages}
            currentUserId={publicKey || 'me'}
            currentView={currentView}
            onSendMessage={activeRoomId ? (text: string) => handleSendRoomMessage(text) : handleSendMessage}
            isSending={isSendingMessage}
            onLoadMore={activeRoomId ? undefined : handleLoadMore}
            isLoading={false}
            isTyping={activeRoomId
              ? !!(typingUsers[`room:${activeRoomId}`])
              : !!(activeDialogHash && typingUsers[activeDialogHash])}
            onTyping={activeRoomId
              ? () => sendRoomTyping(activeRoomId!)
              : () => activeDialogHash && sendTyping(activeDialogHash)}
            onViewProfile={activeRoomId ? undefined : (chat) => {
                const contact = contacts.find(c => c.id === chat.id);
                setViewingProfile(contact || { ...chat, address: chat.id });
            }}
            onReact={(msgId, emoji) => addReaction(msgId, emoji)}
            onRemoveReaction={(msgId, emoji) => removeReaction(msgId, emoji)}
            disappearTimer={activeChatId ? (disappearTimers[activeChatId] || 'off') : 'off'}
            onSetDisappearTimer={activeRoomId ? undefined : (timer) => activeChatId && setDisappearTimer(activeChatId, timer)}
            roomChat={activeRoom || undefined}
            onDeleteRoom={activeRoom && activeRoom.createdBy === publicKey ? () => handleDeleteRoom(activeRoom.id) : undefined}
            onLeaveRoom={activeRoom && activeRoom.createdBy !== publicKey ? () => handleLeaveRoom(activeRoom.id) : undefined}
            onClearDM={!activeRoomId && activeChatId ? handleClearDM : undefined}
            onDeleteChat={!activeRoomId && activeChatId ? () => handleDeleteChat(activeChatId!) : undefined}
            pinnedMessages={pinnedMessages[activeRoomId || activeDialogHash || ''] || []}
            onPinMessage={handlePinMessage}
            onUnpinMessage={handleUnpinMessage}
            onDeleteRoomMessage={activeRoomId ? handleDeleteRoomMessage : undefined}
            onEditRoomMessage={activeRoomId ? handleEditRoomMessage : undefined}
            onDeleteDMMessage={!activeRoomId && activeChatId ? handleDeleteDMMessage : undefined}
            onEditDMMessage={!activeRoomId && activeChatId ? handleEditDMMessage : undefined}
            roomMembers={activeRoomId ? roomMembers : undefined}
          />
        )}

        {currentView === 'contacts' && (
          <ContactsView
            contacts={contacts}
            onAddContact={handleAddContact}
            onEditContact={handleEditContact}
            onDeleteContact={handleDeleteContact}
            onSelectContact={(id) => {
              setActiveChatId(id);
              setCurrentView('chats');
            }}
            onSearchNetwork={searchProfiles}
            onViewProfile={setViewingProfile}
          />
        )}

        {currentView === 'settings' && (
          <SettingsView
            onCreateProfile={handleCreateProfile}
            onUpdateProfile={handleUpdateProfile}
            isProcessing={isProcessing}
            initialData={myProfile}
            error={txStatus.step === 'failed' ? txStatus.error : null}
            isWalletConnected={!!publicKey}
            publicKey={publicKey}
            balance={balance}
            onDisconnect={() => disconnect && disconnect()}
          />
        )}
      </main>

      {/* Create Room Modal */}
      {fabModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setFabModal(null); setFabModalName(''); }}>
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 w-[400px] max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-white text-lg font-bold mb-1">
              {fabModal === 'channel' ? 'Create Channel' : 'Create Group'}
            </h3>
            <p className="text-[#666] text-sm mb-4">
              {fabModal === 'channel' ? 'Public channel for open discussion' : 'Private group for invited members'}
            </p>
            <input
              type="text"
              placeholder={fabModal === 'channel' ? 'Channel name...' : 'Group name...'}
              value={fabModalName}
              onChange={e => setFabModalName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && fabModalName.trim()) {
                  handleCreateRoom(fabModalName.trim(), fabModal);
                  setFabModal(null);
                  setFabModalName('');
                }
                if (e.key === 'Escape') { setFabModal(null); setFabModalName(''); }
              }}
              autoFocus
              className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:border-[#FF8C00] transition-colors mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (fabModalName.trim()) {
                    handleCreateRoom(fabModalName.trim(), fabModal);
                    setFabModal(null);
                    setFabModalName('');
                  }
                }}
                disabled={!fabModalName.trim()}
                className="flex-1 py-2.5 bg-[#FF8C00] text-black font-bold rounded-xl hover:bg-[#FF9F2A] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create
              </button>
              <button
                onClick={() => { setFabModal(null); setFabModalName(''); }}
                className="flex-1 py-2.5 bg-[#2A2A2A] text-[#888] font-bold rounded-xl hover:bg-[#333] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Message Modal */}
      {newMsgModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setNewMsgModal(false); setNewMsgAddress(''); setNewMsgName(''); }}>
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 w-[420px] max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-white text-lg font-bold mb-1">New Message</h3>
            <p className="text-[#666] text-sm mb-4">Start a conversation with an Aleo address</p>

            {/* Existing contacts quick-pick */}
            {contacts.length > 0 && (
              <div className="mb-4">
                <p className="text-[#555] text-xs font-bold uppercase tracking-wider mb-2">Quick Pick</p>
                <div className="max-h-[140px] overflow-y-auto space-y-1 dark-scrollbar">
                  {contacts.map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setActiveChatId(c.id);
                        setActiveRoomId(null);
                        setCurrentView('chats');
                        setNewMsgModal(false);
                        setNewMsgAddress('');
                        setNewMsgName('');
                      }}
                      className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-[#2A2A2A] transition-colors text-left"
                    >
                      <div className="w-8 h-8 bg-[#2A2A2A] rounded-full flex items-center justify-center text-xs text-[#FF8C00] font-bold shrink-0">
                        {c.initials || c.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{c.name}</p>
                        <p className="text-[#666] text-xs font-mono truncate">{c.address ? `${c.address.slice(0, 10)}...` : ''}</p>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="border-t border-[#2A2A2A] my-3" />
              </div>
            )}

            <input
              type="text"
              placeholder="Wallet address (aleo1...)"
              value={newMsgAddress}
              onChange={e => setNewMsgAddress(e.target.value)}
              autoFocus
              className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl py-3 px-4 text-white text-sm font-mono focus:outline-none focus:border-[#FF8C00] transition-colors mb-3"
            />
            <input
              type="text"
              placeholder="Display name (optional)"
              value={newMsgName}
              onChange={e => setNewMsgName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newMsgAddress.startsWith('aleo1') && newMsgAddress.length >= 60) {
                  const name = newMsgName.trim() || `User ${newMsgAddress.slice(0, 6)}...`;
                  if (!contacts.some(c => c.address === newMsgAddress)) {
                    handleAddContact(newMsgAddress, name);
                  }
                  setActiveChatId(newMsgAddress);
                  setActiveRoomId(null);
                  setCurrentView('chats');
                  setNewMsgModal(false);
                  setNewMsgAddress('');
                  setNewMsgName('');
                }
                if (e.key === 'Escape') { setNewMsgModal(false); setNewMsgAddress(''); setNewMsgName(''); }
              }}
              className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:border-[#FF8C00] transition-colors mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (newMsgAddress.startsWith('aleo1') && newMsgAddress.length >= 60) {
                    const name = newMsgName.trim() || `User ${newMsgAddress.slice(0, 6)}...`;
                    if (!contacts.some(c => c.address === newMsgAddress)) {
                      handleAddContact(newMsgAddress, name);
                    }
                    setActiveChatId(newMsgAddress);
                    setActiveRoomId(null);
                    setCurrentView('chats');
                    setNewMsgModal(false);
                    setNewMsgAddress('');
                    setNewMsgName('');
                  } else {
                    toast.error('Enter a valid Aleo address (aleo1...)');
                  }
                }}
                disabled={!newMsgAddress.startsWith('aleo1') || newMsgAddress.length < 60}
                className="flex-1 py-2.5 bg-[#FF8C00] text-black font-bold rounded-xl hover:bg-[#FF9F2A] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Start Chat
              </button>
              <button
                onClick={() => { setNewMsgModal(false); setNewMsgAddress(''); setNewMsgName(''); }}
                className="flex-1 py-2.5 bg-[#2A2A2A] text-[#888] font-bold rounded-xl hover:bg-[#333] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
};

// @ts-ignore - TypeScript has issues with class components due to useDefineForClassFields
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    // @ts-ignore
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    // @ts-ignore
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-red-500 text-3xl">!</span>
            </div>
            <h1 className="text-white text-2xl font-bold mb-3">Something went wrong</h1>
            {/* @ts-ignore */}
            <p className="text-[#999] mb-6">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-[#FF8C00] text-black font-bold rounded-xl hover:bg-[#FF9F2A] transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    // @ts-ignore
    return this.props.children;
  }
}

function App() {
  const wallets = useMemo(
    () => [
      new LeoWalletAdapter({
        appName: "Ghost Messenger",
      }),
    ],
    []
  );

  return (
    <ErrorBoundary>
      <WalletProvider
        wallets={wallets}
        decryptPermission={DecryptPermission.OnChainHistory}
        network={WalletAdapterNetwork.TestnetBeta}
        autoConnect={true}
      >
        <InnerApp />
      </WalletProvider>
    </ErrorBoundary>
  );
}

export default App;
