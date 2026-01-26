import React, { useState, useRef, useEffect } from 'react';
import { useWallet } from "@demox-labs/aleo-wallet-adapter-react";
import { WalletAdapterNetwork, Transaction } from "@demox-labs/aleo-wallet-adapter-base";
import { Message, Contact } from '../types';
import { PROGRAM_ID } from '../deployed_program';
import { stringToField, fieldToString } from '../utils/messageUtils';
import { TRANSACTION_FEE } from '../utils/constants';

// Helper function to generate initials from address
const getInitialsFromAddress = (address: string): string => {
  if (!address) return '??';
  const parts = address.replace('aleo1', '').substring(0, 2).toUpperCase();
  return parts || '??';
};

// Helper function to validate Aleo address
const isValidAleoAddress = (address: string): boolean => {
  return address.startsWith('aleo1') && address.length >= 59 && address.length <= 63;
};

const ChatInterface: React.FC = () => {
  const { publicKey, wallet, disconnect } = useWallet();
  const adapter = wallet?.adapter as any;
  const network = WalletAdapterNetwork.TestnetBeta;
  // State for active chat selection
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  
  // Message history per contact - load from localStorage (persistent storage)
  const [histories, setHistories] = useState<Record<string, Message[]>>(() => {
    if (typeof window !== 'undefined' && publicKey) {
      try {
        const saved = localStorage.getItem(`ghost_messages_${publicKey}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          // Convert timestamp strings back to Date objects
          const result: Record<string, Message[]> = {};
          Object.keys(parsed).forEach(contactId => {
            result[contactId] = parsed[contactId].map((m: any) => ({
              ...m,
              timestamp: new Date(m.timestamp)
            }));
          });
          return result;
        }
      } catch (e) {
        console.warn("Failed to load messages from localStorage:", e);
      }
    }
    return {};
  });
  
  // Reload messages when publicKey changes
  useEffect(() => {
    if (publicKey && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`ghost_messages_${publicKey}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          const result: Record<string, Message[]> = {};
          Object.keys(parsed).forEach(contactId => {
            result[contactId] = parsed[contactId].map((m: any) => ({
              ...m,
              timestamp: new Date(m.timestamp)
            }));
          });
          if (Object.keys(result).length > 0) {
            setHistories(result);
          }
        }
      } catch (e) {
        console.warn("Failed to reload messages:", e);
      }
    }
  }, [publicKey]);
  
  // Contacts state - load from localStorage on mount (persistent storage)
  const [contacts, setContacts] = useState<Contact[]>(() => {
    if (typeof window !== 'undefined' && publicKey) {
      try {
        const saved = localStorage.getItem(`ghost_contacts_${publicKey}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          // Convert timestamp strings back to Date objects
          return parsed.map((c: any) => ({
            ...c,
            lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined
          }));
        }
      } catch (e) {
        console.warn("Failed to load contacts from localStorage:", e);
      }
    }
    return [];
  });
  
  // Reload contacts when publicKey changes
  useEffect(() => {
    if (publicKey && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`ghost_contacts_${publicKey}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          const loaded = parsed.map((c: any) => ({
            ...c,
            lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined
          }));
          if (loaded.length > 0) {
            setContacts(loaded);
          }
        }
      } catch (e) {
        console.warn("Failed to reload contacts:", e);
      }
    }
  }, [publicKey]);
  
  // UI states
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatAddress, setNewChatAddress] = useState('');
  const [newChatName, setNewChatName] = useState('');
  const [showAddressDetails, setShowAddressDetails] = useState<string | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [showWalletRequiredModal, setShowWalletRequiredModal] = useState(false);
  const [walletRequiredAction, setWalletRequiredAction] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [txStatus, setTxStatus] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingContactName, setEditingContactName] = useState<string>('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize welcome message for new contacts (only if no messages exist)
  useEffect(() => {
    const initialHistories: Record<string, Message[]> = {};
    contacts.forEach(contact => {
      // Only add welcome message if contact has no existing messages
      if (!histories[contact.id] || histories[contact.id].length === 0) {
        initialHistories[contact.id] = [
          {
            id: `init-${contact.id}`,
            text: `SECURE CONNECTION ESTABLISHED WITH ${contact.name}.`,
            sender: contact.name,
            isUser: false,
            timestamp: new Date()
          }
        ];
      }
    });
    if (Object.keys(initialHistories).length > 0) {
      setHistories(prev => ({ ...prev, ...initialHistories }));
    }
  }, [contacts]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [histories, activeContactId]);

  // Save contacts to localStorage whenever they change (persistent storage)
  useEffect(() => {
    if (publicKey) {
      try {
        if (contacts.length > 0) {
          localStorage.setItem(`ghost_contacts_${publicKey}`, JSON.stringify(contacts));
        } else {
          // Keep empty array to preserve state
          localStorage.setItem(`ghost_contacts_${publicKey}`, JSON.stringify([]));
        }
      } catch (e) {
        console.warn("Failed to save contacts to localStorage:", e);
      }
    }
  }, [contacts, publicKey]);

  // Save messages to localStorage whenever they change (persistent storage)
  useEffect(() => {
    if (publicKey) {
      try {
        if (Object.keys(histories).length > 0) {
          localStorage.setItem(`ghost_messages_${publicKey}`, JSON.stringify(histories));
        } else {
          // Keep empty object to preserve state
          localStorage.setItem(`ghost_messages_${publicKey}`, JSON.stringify({}));
        }
      } catch (e) {
        console.warn("Failed to save messages to localStorage:", e);
      }
    }
  }, [histories, publicKey]);

  // Sync messages from blockchain
  const syncMessages = async () => {
    if (!publicKey || !adapter) return;

    setIsSyncing(true);
    setSyncStatus('Syncing messages...');

    try {
      // Try to get records from wallet
      let records: any[] = [];
      
      // Check if methods exist and are callable
      const hasRequestRecordPlaintexts = adapter.requestRecordPlaintexts && typeof adapter.requestRecordPlaintexts === 'function';
      const hasRequestRecords = adapter.requestRecords && typeof adapter.requestRecords === 'function';
      
      // Note: These methods may require specific parameters that we don't know
      // For now, we'll skip automatic syncing to avoid INVALID_PARAMS errors
      // Users can manually sync messages when they send/receive them
      
      // Try requestRecordPlaintexts first (if available) - but catch all errors silently
      // Note: These methods may require program ID or other parameters that we don't have
      // We'll try but suppress all errors to avoid console spam
      if (hasRequestRecordPlaintexts) {
        try {
          // Try with program ID if method accepts parameters
          let result: any;
          try {
            // Some wallet adapters require program ID as parameter
            result = await adapter.requestRecordPlaintexts(PROGRAM_ID);
          } catch {
            // If that fails, try without parameters
            try {
              result = await adapter.requestRecordPlaintexts();
            } catch {
              // If both fail, skip this method
              result = null;
            }
          }
          
          if (result && Array.isArray(result)) {
            records = result.filter((r: any) => {
              const plaintext = typeof r === 'string' ? r : (r?.plaintext || r?.data || '');
              // Look for message/donation records
              return plaintext && typeof plaintext === 'string' && 
                     plaintext.includes('sender:') && plaintext.includes('recipient:');
            });
          }
        } catch (e: any) {
          // Silently ignore all errors - wallet doesn't support this properly or requires different parameters
          // Errors are already suppressed in index.html
        }
      }

      // Fallback: try requestRecords (encrypted) - only if no plaintexts found
      if ((!records || records.length === 0) && hasRequestRecords) {
        try {
          // Try with program ID if method accepts parameters
          let encryptedRecords: any;
          try {
            encryptedRecords = await adapter.requestRecords(PROGRAM_ID);
          } catch {
            // If that fails, try without parameters
            try {
              encryptedRecords = await adapter.requestRecords();
            } catch {
              // If both fail, skip this method
              encryptedRecords = null;
            }
          }
          
          if (encryptedRecords && Array.isArray(encryptedRecords) && encryptedRecords.length > 0) {
            // Try to decrypt records
            for (const record of encryptedRecords) {
              try {
                const recordStr = typeof record === 'string' ? record : (record?.ciphertext || record?.record || '');
                if (recordStr && typeof recordStr === 'string' && recordStr.startsWith('record1') && adapter.decrypt) {
                  const decrypted = await adapter.decrypt(recordStr);
                  if (decrypted) {
                    const plaintext = typeof decrypted === 'string' ? decrypted : JSON.stringify(decrypted);
                    // Check if it's a message record
                    if (plaintext.includes('sender:') && plaintext.includes('recipient:')) {
                      records.push({ plaintext });
                    }
                  }
                }
              } catch (e) {
                // Silently fail decryption
              }
            }
          }
        } catch (e: any) {
          // Silently ignore all errors - wallet doesn't support this properly or requires different parameters
          // Errors are already suppressed in index.html
        }
      }

      // Parse records and create contacts/messages
      const newContactsMap = new Map<string, Contact>();
      const newMessagesMap = new Map<string, Message[]>();

      for (const record of records) {
        try {
          const plaintext = typeof record === 'string' ? record : record.plaintext || '';
          if (!plaintext) continue;

          // Parse record to extract sender, recipient, message
          // Format based on Donation record: owner: aleo1..., sender: aleo1..., recipient: aleo1..., amount: u64, message: field, timestamp: u64
          const senderMatch = plaintext.match(/sender:\s*(aleo1[a-z0-9]+)/);
          const recipientMatch = plaintext.match(/recipient:\s*(aleo1[a-z0-9]+)/);
          const messageMatch = plaintext.match(/message:\s*(\d+)field/);
          const timestampMatch = plaintext.match(/timestamp:\s*(\d+)u64/);

          if (!senderMatch || !recipientMatch || !messageMatch) continue;

          const sender = senderMatch[1];
          const recipient = recipientMatch[1];
          const messageField = messageMatch[1] + 'field';
          // Timestamp is in seconds (u64), convert to milliseconds for Date object
          const timestampSeconds = timestampMatch ? parseInt(timestampMatch[1]) : Math.floor(Date.now() / 1000);
          const timestamp = timestampSeconds * 1000; // Convert to milliseconds for Date

          // Determine if this is a received or sent message
          const isReceived = recipient.toLowerCase() === publicKey.toLowerCase();
          const otherParty = isReceived ? sender : recipient;

          // Decode message
          const messageText = fieldToString(messageField);

          // Create or update contact
          if (!newContactsMap.has(otherParty)) {
            const existingContact = contacts.find(c => c.address?.toLowerCase() === otherParty.toLowerCase());
            if (existingContact) {
              newContactsMap.set(otherParty, existingContact);
            } else {
              // Create new contact
              const contactId = `contact-${otherParty}`;
              newContactsMap.set(otherParty, {
                id: contactId,
                name: otherParty.slice(0, 10) + '...' + otherParty.slice(-6),
                description: otherParty,
                context: '',
                initials: getInitialsFromAddress(otherParty),
                address: otherParty,
                unreadCount: isReceived ? 1 : 0
              });
            }
          }

          // Add message - use the contact from the map
          const contact = newContactsMap.get(otherParty)!;
          const contactId = contact.id;
          
          if (!newMessagesMap.has(contactId)) {
            newMessagesMap.set(contactId, []);
          }

          const message: Message = {
            id: `msg-${timestamp}-${sender.slice(-8)}`,
            text: messageText || '[Encrypted message]',
            sender: isReceived ? sender : 'YOU',
            isUser: !isReceived,
            timestamp: new Date(timestamp)
          };

          newMessagesMap.get(contactId)!.push(message);
        } catch (e) {
          console.warn("Failed to parse record:", e);
        }
      }

      // Update contacts and messages
      if (newContactsMap.size > 0 || newMessagesMap.size > 0) {
        setContacts(prev => {
          const updated = [...prev];
          newContactsMap.forEach((contact, address) => {
            const existing = updated.find(c => c.address?.toLowerCase() === address.toLowerCase());
            if (!existing) {
              // Add new contact
              updated.push(contact);
            } else {
              // Update unread count if received new message
              const contactIndex = updated.findIndex(c => c.id === existing.id);
              if (contactIndex >= 0) {
                const newMessages = newMessagesMap.get(contact.id) || [];
                const hasNewReceived = newMessages.some(m => !m.isUser);
                if (hasNewReceived) {
                  updated[contactIndex] = { 
                    ...updated[contactIndex], 
                    unreadCount: (updated[contactIndex].unreadCount || 0) + 1,
                    lastMessage: newMessages[newMessages.length - 1]?.text || updated[contactIndex].lastMessage,
                    lastMessageTime: newMessages[newMessages.length - 1]?.timestamp || updated[contactIndex].lastMessageTime
                  };
                }
              }
            }
          });
          return updated;
        });

        // Update messages
        setHistories(prev => {
          const updated = { ...prev };
          newMessagesMap.forEach((messages, contactId) => {
            if (!updated[contactId]) {
              updated[contactId] = [];
            }
            // Add only new messages (check by id)
            const existingIds = new Set(updated[contactId].map(m => m.id));
            const newMsgs = messages.filter(m => !existingIds.has(m.id));
            if (newMsgs.length > 0) {
              updated[contactId] = [...updated[contactId], ...newMsgs].sort((a, b) => 
                a.timestamp.getTime() - b.timestamp.getTime()
              );
            }
          });
          return updated;
        });

        setSyncStatus(`Synced ${newContactsMap.size} contacts, ${Array.from(newMessagesMap.values()).flat().length} messages`);
      } else {
        setSyncStatus('No new messages found');
      }

      setTimeout(() => setSyncStatus(''), 3000);
    } catch (error) {
      console.error("Sync error:", error);
      setSyncStatus('Sync failed');
      setTimeout(() => setSyncStatus(''), 3000);
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto-sync on mount and periodically (with delay to avoid immediate errors)
  useEffect(() => {
    if (publicKey && adapter) {
      // Wait a bit for wallet to be ready
      const timeout = setTimeout(() => {
        syncMessages();
      }, 1000);
      
      const interval = setInterval(syncMessages, 30000); // Sync every 30 seconds
      return () => {
        clearTimeout(timeout);
        clearInterval(interval);
      };
    }
  }, [publicKey, adapter]);

  const handleContactSelect = (id: string) => {
    setActiveContactId(id);
    // Mark as read
    setContacts(prev => prev.map(c => 
      c.id === id ? { ...c, unreadCount: 0 } : c
    ));
  };

  // Update contact name locally (in memory and localStorage)
  const handleUpdateContactName = async (contactId: string, newName: string) => {
    if (!publicKey || !contactId || !newName.trim()) return;

    const contact = contacts.find(c => c.id === contactId);
    if (!contact) {
      return;
    }

    // Update locally only (no blockchain call)
    setContacts(prev => prev.map(c => 
      c.id === contactId ? { ...c, name: newName.trim() } : c
    ));
    
    // Update will be saved to localStorage automatically via useEffect
    setTxStatus('Contact name updated!');
    setTimeout(() => setTxStatus(''), 2000);
  };

  // Delete chat locally (in memory and localStorage)
  const handleDeleteChat = async (contactId: string) => {
    if (!publicKey || !contactId) return;

    // Delete locally only (no blockchain call)
    setContacts(prev => prev.filter(c => c.id !== contactId));
    setHistories(prev => {
      const updated = { ...prev };
      delete updated[contactId];
      return updated;
    });
    
    if (activeContactId === contactId) {
      setActiveContactId(null);
    }
    
    // Changes will be saved to localStorage automatically via useEffect
    setTxStatus('Chat deleted!');
    setTimeout(() => setTxStatus(''), 2000);
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || !activeContactId || !publicKey || !adapter) return;

    const currentChatId = activeContactId;
    const activeContact = contacts.find(c => c.id === currentChatId);
    
    if (!activeContact?.address) {
      alert('Contact address is required to send message');
      return;
    }

    setIsSending(true);
    setTxStatus('Підготовка транзакції...');

    const userMsg: Message = {
      id: Date.now().toString(),
      text: input,
      sender: 'YOU',
      isUser: true,
      timestamp: new Date(),
    };

    // Update UI immediately (optimistic update)
    setHistories(prev => ({
      ...prev,
      [currentChatId]: [...(prev[currentChatId] || []), userMsg]
    }));

    // Update contact last message
    setContacts(prev => prev.map(c => 
      c.id === currentChatId 
        ? { ...c, lastMessage: input, lastMessageTime: new Date() }
        : c
    ));

    const messageText = input;
    setInput('');

    try {
      // Validate inputs before creating transaction
      if (!activeContact.address || !isValidAleoAddress(activeContact.address)) {
        setTxStatus("❌ Помилка: Невалідна адреса отримувача");
        setTimeout(() => setTxStatus(''), 5000);
        setIsSending(false);
        // Remove optimistic message
        setHistories(prev => ({
          ...prev,
          [currentChatId]: (prev[currentChatId] || []).filter(m => m.id !== userMsg.id)
        }));
        return;
      }
      
      if (!messageText || messageText.trim().length === 0) {
        setTxStatus("❌ Помилка: Повідомлення не може бути порожнім");
        setTimeout(() => setTxStatus(''), 5000);
        setIsSending(false);
        // Remove optimistic message
        setHistories(prev => ({
          ...prev,
          [currentChatId]: (prev[currentChatId] || []).filter(m => m.id !== userMsg.id)
        }));
        return;
      }

      // Check balance before sending (if adapter supports it)
      setTxStatus('Перевірка балансу...');
      try {
        if (adapter.requestBalance && typeof adapter.requestBalance === 'function') {
          const balance = await adapter.requestBalance();
          console.log("💰 Current balance:", balance);
          
          // Balance might be in different formats, check if it's sufficient
          // TRANSACTION_FEE = 10,000,000,000 microcredits = 0.01 ALEO
          const minRequired = TRANSACTION_FEE;
          
          if (balance !== undefined && balance !== null) {
            const balanceNum = typeof balance === 'string' 
              ? parseFloat(balance.replace(/[^\d.]/g, '')) 
              : Number(balance);
            
            // If balance is in ALEO (not microcredits), convert
            const balanceMicrocredits = balanceNum < 1 
              ? Math.floor(balanceNum * 1_000_000_000_000) 
              : balanceNum;
            
            if (balanceMicrocredits < minRequired) {
              const requiredAleo = (minRequired / 1_000_000_000_000).toFixed(4);
              const currentAleo = (balanceMicrocredits / 1_000_000_000_000).toFixed(4);
              setTxStatus(`❌ Недостатньо коштів! Потрібно: ${requiredAleo} ALEO, є: ${currentAleo} ALEO`);
              console.error("❌ Insufficient balance:", {
                required: minRequired,
                current: balanceMicrocredits,
                requiredAleo,
                currentAleo
              });
              setIsSending(false);
              // Remove optimistic message
              setHistories(prev => ({
                ...prev,
                [currentChatId]: (prev[currentChatId] || []).filter(m => m.id !== userMsg.id)
              }));
              setTimeout(() => setTxStatus(''), 8000);
              return;
            }
          }
        }
      } catch (balanceError) {
        console.warn("Could not check balance:", balanceError);
        // Continue anyway - balance check is optional
      }
      
      // Convert message to field
      const messageField = stringToField(messageText);
      // Use seconds instead of milliseconds for timestamp (more compatible with u64)
      // IMPORTANT: u64 can handle large numbers, but seconds are more standard
      let timestamp = Math.floor(Date.now() / 1000);
      
      // Validate timestamp is reasonable (not in milliseconds)
      if (timestamp > 10000000000) { // If > year 2286, probably in milliseconds
        console.error("⚠️ Warning: Timestamp seems to be in milliseconds:", timestamp);
        console.error("   Converting to seconds...");
        timestamp = Math.floor(timestamp / 1000);
        console.log("   Corrected timestamp:", timestamp);
      }
      
      // SECURITY: Amount is ALWAYS 0 for messages - no tokens are transferred
      // Only blockchain transaction fee (TRANSACTION_FEE) is charged
      const amount = 0;
      
      console.log("⏰ Timestamp validation:", {
        rawMs: Date.now(),
        seconds: timestamp,
        date: new Date(timestamp * 1000).toISOString(),
        isValid: timestamp < 10000000000,
        timestampParam: `${timestamp}u64`
      });
      
      console.log("📝 Preparing transaction:", {
        program: PROGRAM_ID,
        function: "send_message",
        recipient: activeContact.address,
        messageLength: messageText.length
      });

      // Create transaction for send_message
      // SECURITY: amount is always 0 - no tokens are transferred, only blockchain fee is charged
      // send_message(private recipient: address, private amount: u64, private message: field, private timestamp: u64)
      // All parameters are private for maximum privacy - nothing visible in transaction history
      // TRANSACTION_FEE (0.01 ALEO) is the ONLY fee charged - this is the blockchain transaction fee
      
      // Ensure all parameters are strings with proper type annotations
      // For private parameters in Aleo, we pass them as plain strings
      // The wallet adapter will handle the encryption/private formatting
      const recipientParam = activeContact.address; // address type (private)
      const amountParam = `${amount}u64`; // u64 type (private, always 0)
      const messageParam = messageField; // field type (private, already formatted as "numberfield")
      const timestampParam = `${timestamp}u64`; // u64 type (private)
      
      // Validate all parameters before creating transaction
      if (!recipientParam || !recipientParam.startsWith('aleo1')) {
        throw new Error("Invalid recipient address format");
      }
      if (!messageParam || !messageParam.endsWith('field')) {
        throw new Error("Invalid message field format");
      }
      if (!timestampParam || !timestampParam.endsWith('u64')) {
        throw new Error("Invalid timestamp format");
      }
      
      console.log("📋 Transaction parameters (formatted):", {
        recipient: recipientParam,
        amount: amountParam,
        message: messageParam,
        timestamp: timestampParam,
        messageFieldLength: messageField.length,
        timestampValue: timestamp
      });
      
      const transaction = Transaction.createTransaction(
        publicKey,
        network,
        PROGRAM_ID,
        "send_message",
        [
          recipientParam,    // private recipient: address
          amountParam,       // private amount: u64 (ALWAYS 0 - no token transfer)
          messageParam,      // private message: field
          timestampParam      // private timestamp: u64
        ],
        TRANSACTION_FEE,     // Only blockchain transaction fee (0.01 ALEO = 10,000,000,000 microcredits)
        false                // Use public fee (not private records) - feePrivate: false
      );

      setTxStatus('Очікування підпису...');
      console.log("Creating transaction with params:", {
        recipient: activeContact.address,
        amount: `${amount}u64`,
        message: messageField,
        timestamp: `${timestamp}u64`,
        timestampDate: new Date(timestamp * 1000).toISOString(), // Show human-readable timestamp
        programId: PROGRAM_ID,
        functionName: "send_message",
        fee: TRANSACTION_FEE
      });
      
      console.log("Transaction object:", transaction);
      console.log("Transaction transitions:", transaction.transitions);
      console.log("Transaction fee:", transaction.fee);
      console.log("Transaction feePrivate:", transaction.feePrivate);
      
      // IMPORTANT: Verify program exists before sending transaction
      console.log("🔍 Перевірка програми перед відправкою транзакції...");
      console.log("   Program ID:", PROGRAM_ID);
      console.log("   Network:", network);
      
      // Try to verify program exists (optional check)
      setTxStatus('Перевірка програми в мережі...');
      let programExists = false;
      try {
        const programCheckUrls = [
          `https://api.explorer.aleo.org/v1/testnet3/program/${PROGRAM_ID}`,
          `https://vm.aleo.org/api/testnet3/program/${PROGRAM_ID}`
        ];
        
        for (const url of programCheckUrls) {
          try {
            const response = await fetch(url);
            if (response.ok) {
              programExists = true;
              console.log("✅ Програма знайдена в мережі:", url);
              break;
            }
          } catch (e) {
            // Try next URL
            continue;
          }
        }
        
        if (!programExists) {
          console.error("❌ КРИТИЧНО: Програма не знайдена в мережі!");
          console.error("❌ Транзакція НЕ ПРОЙДЕ, якщо програма не задеплоєна!");
          console.error("💡 Перевірте деплой: node verify_deployment.js");
          console.error("💡 Якщо програма не задеплоєна, задеплойте:");
          console.error("   leo deploy --network testnet --private-key YOUR_KEY --priority-fees 1000000 --broadcast -y");
          setTxStatus('❌ КРИТИЧНО: Програма не знайдена в мережі! Транзакція не пройде!');
          // Block transaction if program doesn't exist
          setIsSending(false);
          // Remove optimistic message
          setHistories(prev => ({
            ...prev,
            [currentChatId]: (prev[currentChatId] || []).filter(m => m.id !== userMsg.id)
          }));
          setTimeout(() => setTxStatus(''), 10000);
          return;
        } else {
          console.log("✅ Програма існує в мережі");
        }
      } catch (e) {
        console.warn("Could not verify program:", e);
        // Continue anyway
      }
      
      // Request transaction - this should prompt user to sign and broadcast
      // IMPORTANT: User must approve the transaction in the wallet popup
      setTxStatus('⏳ Відкриття гаманця... Будь ласка, підтвердіть транзакцію для відправки повідомлення.');
      
      let txId: any;
      try {
        // requestTransaction should open wallet popup and wait for user approval
        // After approval, it should broadcast the transaction and return the transaction ID
        // NOTE: If program doesn't exist, wallet may create transaction but it won't be broadcasted
        console.log("📤 Requesting transaction from wallet...");
        console.log("   Transaction object:", {
          address: transaction.address,
          chainId: transaction.chainId,
          transitions: transaction.transitions?.length || 0,
          fee: transaction.fee,
          feePrivate: transaction.feePrivate
        });
        
        txId = await adapter.requestTransaction(transaction);
        
        console.log("📦 Transaction response received");
        console.log("Response type:", typeof txId);
        console.log("Response value:", txId);
        
        // Handle different response formats
        if (txId === null || txId === undefined) {
          throw new Error("Транзакцію було скасовано або вона не вдалася - не повернено ID транзакції");
        }
        
        // Log full response for debugging
        if (typeof txId === 'object') {
          console.log("📦 Повний об'єкт відповіді транзакції:", JSON.stringify(txId, null, 2));
        } else {
          console.log("📦 ID транзакції (рядок):", txId);
        }
      } catch (txError: any) {
        console.error("❌ Помилка запиту транзакції:", txError);
        // Check if it's a user cancellation
        if (txError?.message?.includes("cancel") || txError?.message?.includes("reject") || 
            txError?.message?.includes("denied") || txError?.message?.includes("скасовано") ||
            txError?.code === 4001) {
          setTxStatus("❌ Транзакцію скасовано користувачем");
          throw new Error("Transaction cancelled");
        }
        throw txError; // Re-throw to be caught by outer catch
      }

      if (txId) {
        // Check if txId is a string (transaction ID) or an object with status
        const actualTxId = typeof txId === 'string' ? txId : (txId?.transactionId || txId?.id || txId);
        
        if (actualTxId && typeof actualTxId === 'string' && actualTxId.length > 0) {
          const shortId = actualTxId.length > 8 ? actualTxId.slice(0, 8) : actualTxId;
          
          // Check if this is a UUID (local wallet ID) or real transaction ID (starts with 'at1')
          const isRealTxId = actualTxId.startsWith('at1');
          
          if (isRealTxId) {
            setTxStatus(`✅ Транзакцію відправлено! ID: ${shortId}...`);
            console.log("✅ Отримано реальний ID транзакції блокчейну:", actualTxId);
            console.log("✅ Транзакцію успішно відправлено в мережу!");
          } else {
            // UUID format means it's a local wallet ID, not a real transaction ID
            setTxStatus(`⚠️ Транзакція може не бути відправлена. Перевірте історію гаманця!`);
            console.log("");
            console.log("⚠️⚠️⚠️ КРИТИЧНО: Отримано UUID (локальний ID), НЕ реальний transaction ID!");
            console.log("⚠️ Формат UUID означає, що транзакція НЕ була відправлена в мережу!");
            console.log("");
            console.log("🔍 ЯК ПЕРЕВІРИТИ:");
            console.log("   1. Відкрийте розширення Leo Wallet");
            console.log("   2. Перейдіть в 'Transactions' або 'History'");
            console.log("   3. Знайдіть транзакцію до програми:", PROGRAM_ID);
            console.log("   4. ⚠️ Якщо транзакції НЕМАЄ в історії - вона НЕ була відправлена!");
            console.log("   5. ✅ Якщо транзакція Є - скопіюйте РЕАЛЬНИЙ ID (починається з 'at1...')");
            console.log("   6. Перевірте в AleoScan:");
            console.log("      https://testnet.aleoscan.io/address?a=" + publicKey + "#transitions");
            console.log("");
            console.log("❓ ЧОМУ ТРАНЗАКЦІЯ НЕ ВІДПРАВЛЯЄТЬСЯ:");
            console.log("   ⚠️ Програма не знайдена в мережі!");
            console.log("   ⚠️ Перевірте деплой: node verify_deployment.js");
            console.log("   ⚠️ Якщо програма не знайдена - задеплойте:");
            console.log("      leo deploy --network testnet --priority-fees 1000000 --broadcast -y");
            console.log("");
            console.log("💡 Інші можливі причини:");
            console.log("   - Функція не знайдена в програмі");
            console.log("   - Неправильні параметри");
            console.log("   - Недостатньо коштів (потрібно мінімум 0.01 ALEO для комісії)");
            console.log("   - Проблеми з мережею");
          }
          
          // Show success message in UI with AleoScan link
          console.log("🔗 View your transactions on AleoScan:");
          console.log("   https://testnet.aleoscan.io/address?a=" + publicKey + "#transitions");
          
          console.log("📋 Transaction details:");
          console.log("   Program:", PROGRAM_ID);
          console.log("   Function: send_message");
          console.log("   Fee:", TRANSACTION_FEE, "microcredits (0.01 ALEO)");
          
          if (!isRealTxId) {
            console.log("");
            console.log("⚠️⚠️⚠️ КРИТИЧНО: Транзакцію НЕ відправлено в мережу!");
            console.log("⚠️ UUID означає, що гаманець створив транзакцію локально, але не відправив її.");
            console.log("⚠️ Це відбувається, коли програма не знайдена в мережі.");
            console.log("");
            console.log("🔧 РІШЕННЯ:");
            console.log("   1. Програма може бути ще не проіндексована (зачекайте 1-2 хвилини)");
            console.log("   2. Перевірте деплой транзакції:");
            console.log("      https://testnet.aleoscan.io/address?a=" + publicKey + "#transitions");
            console.log("   3. Перевірте історію транзакцій в Leo Wallet");
            console.log("   4. Якщо транзакції немає в історії - вона не була відправлена");
            console.log("   5. Спробуйте відправити повідомлення через 1-2 хвилини після деплою");
            console.log("   6. Переконайтеся, що у вас достатньо коштів (мінімум 0.01 ALEO)");
            console.log("   7. Перевірте, що програма задеплоєна: node verify_deployment.js");
          }
          
          
          // Update status after a moment with more helpful message
          setTimeout(() => {
            if (isRealTxId) {
              setTxStatus(`✅ Повідомлення відправлено! Перевірте AleoScan для статусу...`);
            } else {
              setTxStatus(`⚠️ Транзакція може не пройти. Перевірте історію гаманця!`);
            }
          }, 2000);
          
          // Final status update with link
          setTimeout(() => {
            if (isRealTxId) {
              setTxStatus(`✅ Повідомлення відправлено! Переглянути в AleoScan`);
            } else {
              setTxStatus(`⚠️ Перевірте історію транзакцій в Leo Wallet!`);
            }
          }, 5000);
          
          // Verify transaction appears in explorer after a delay
          setTimeout(async () => {
            try {
              const explorerUrl = `https://testnet.aleoscan.io/transaction?id=${actualTxId}`;
              const addressUrl = `https://testnet.aleoscan.io/address?a=${publicKey}#transitions`;
              console.log("⏳ Checking transaction status at:", explorerUrl);
              console.log("   Or check address transitions:", addressUrl);
              
              // Try multiple explorer APIs
              const apis = [
                `https://api.explorer.aleo.org/v1/testnet3/transaction/${actualTxId}`,
                `https://api.explorer.provable.com/v1/testnet3/transaction/${actualTxId}`,
                `https://vm.aleo.org/api/testnet3/transaction/${actualTxId}`
              ];
              
              let found = false;
              for (const apiUrl of apis) {
                try {
                  const response = await fetch(apiUrl);
                  if (response.ok) {
                    const data = await response.json();
                    console.log("✅ Transaction found in explorer!", apiUrl);
                    console.log("Transaction data:", data);
                    found = true;
                    break;
                  }
                } catch (e) {
                  // Try next API
                  continue;
                }
              }
              
              if (!found) {
                console.warn("⚠️ Transaction not yet found in explorer APIs");
                console.warn("💡 This is normal - transactions need 10-30 seconds to be included in a block");
                console.warn("💡 The wallet ID might be different from the blockchain transaction ID");
                console.warn("💡 Check your Leo Wallet transaction history for the actual transaction");
                console.warn("💡 Or check manually:");
                console.warn("   Transaction: " + explorerUrl);
                console.warn("   Address: " + addressUrl);
                
                // Update status to inform user - but don't overwrite success message
                // setTxStatus(`⏳ Transaction submitted. Check wallet for confirmation...`);
              } else {
                console.log("🎉 Transaction confirmed in blockchain!");
                setTxStatus(`✅ Transaction confirmed! View on AleoScan`);
              }
            } catch (e) {
              console.warn("Could not verify transaction status:", e);
              console.warn("💡 You can check the transaction manually at:");
              console.warn("   Transaction: https://testnet.aleoscan.io/transaction?id=" + actualTxId);
              console.warn("   Address: https://testnet.aleoscan.io/address?a=" + publicKey + "#transitions");
            }
          }, 10000); // Wait 10 seconds before checking
        } else {
          console.error("❌ Невалідний формат ID транзакції:", txId);
          console.error("Очікувався рядок, отримано:", typeof actualTxId, actualTxId);
          setTxStatus("⚠️ Транзакція може не бути відправлена. Перевірте гаманець та консоль.");
        }
        
        // Ensure the contact exists in the list (in case it was deleted or not synced)
        const contactExists = contacts.find(c => 
          c.address?.toLowerCase() === activeContact.address?.toLowerCase()
        );
        
        if (!contactExists && activeContact.address) {
          // Add contact if it doesn't exist
          const newContact: Contact = {
            id: `contact-${activeContact.address}`,
            name: activeContact.name || activeContact.address.slice(0, 10) + '...' + activeContact.address.slice(-6),
            description: activeContact.address,
            context: '',
            initials: getInitialsFromAddress(activeContact.address),
            address: activeContact.address,
            unreadCount: 0
          };
          setContacts(prev => {
            const exists = prev.find(c => c.address?.toLowerCase() === activeContact.address?.toLowerCase());
            return exists ? prev : [...prev, newContact];
          });
        }
        
        // Don't sync immediately after sending - automatic syncing may cause INVALID_PARAMS errors
        // Users can manually sync using the SYNC button if needed
        // setTimeout(() => syncMessages(), 2000); // Disabled to avoid wallet errors
        
        setTimeout(() => setTxStatus(''), 5000);
      } else {
        setTxStatus('❌ Транзакція не вдалася - не повернено ID транзакції');
        setTimeout(() => setTxStatus(''), 5000);
      }
    } catch (error: any) {
      console.error("Send message error:", error);
      const errorMsg = error?.message || String(error);
      const errorStr = String(error);
      
      // Check if this is a real transaction error or just wallet extension noise
      if ((errorStr.includes("addToWindow.js") || errorStr.includes("evmAsk.js") || 
          errorStr.includes("contentScript.ts") || errorStr.includes("inject.ts")) &&
          !errorStr.includes("Permission Not Granted") && !errorStr.includes("NOT_GRANTED")) {
        // Ignore errors from other wallet extensions (but not permission errors)
        console.warn("Ignoring wallet extension error:", errorStr);
        return;
      }
      
      if (errorMsg.includes("Permission") || errorMsg.includes("NOT_GRANTED") || errorMsg.includes("rejected") || 
          errorStr.includes("Permission Not Granted") || errorStr.includes("NOT_GRANTED") ||
          errorMsg.includes("скасовано") || errorMsg.includes("відхилено")) {
        setTxStatus("❌ Транзакцію відхилено. Будь ласка, підтвердіть її в гаманці для відправки повідомлення.");
        console.warn("⚠️ Користувач відхилив транзакцію в гаманці");
        console.warn("💡 Щоб відправити повідомлення, потрібно:");
        console.warn("   1. Натиснути кнопку 'Відправити повідомлення'");
        console.warn("   2. Підтвердити транзакцію у спливаючому вікні Leo Wallet");
        console.warn("   3. Дочекатися підтвердження транзакції");
        
        // Remove optimistic message since transaction was rejected
        setHistories(prev => ({
          ...prev,
          [currentChatId]: (prev[currentChatId] || []).filter(m => m.id !== userMsg.id)
        }));
        
        setTimeout(() => setTxStatus(''), 8000);
        return;
      } else if (errorMsg.includes("INVALID_PARAMS") && !errorStr.includes("addToWindow")) {
        // Only show INVALID_PARAMS if it's not from wallet extensions
        setTxStatus(`❌ Помилка: Невалідні параметри транзакції. Програма ${PROGRAM_ID} може не існувати або сигнатура функції неправильна.`);
        console.error("❌ Транзакція не вдалася з INVALID_PARAMS");
        console.error("Параметри транзакції:", {
          program: PROGRAM_ID,
          function: "send_message",
          recipient: activeContact.address,
          amount: "0u64",
          message: messageField,
          timestamp: `${Math.floor(Date.now() / 1000)}u64`
        });
        console.error("💡 Можливі причини:");
        console.error("  1. Програма не задеплоєна або неправильний ID програми");
        console.error("  2. Неправильна сигнатура функції");
        console.error("  3. Неправильна мережа (перевірте, чи використовується testnet)");
        console.error("  4. Перевірте деплой: node verify_deployment.js");
      } else if (errorMsg.includes("does not exist") || errorStr.includes("does not exist") ||
                 errorMsg.includes("не існує")) {
        setTxStatus(`❌ Помилка: функція send_message не знайдена в ${PROGRAM_ID}. Будь ласка, перезадеплойте програму.`);
        console.error(`❌ Програма ${PROGRAM_ID} не має функції send_message.`);
        console.error("💡 Рішення: Перезадеплойте програму: leo deploy --network testnet");
      } else if (errorMsg.includes("insufficient") || errorMsg.includes("balance") || 
                 errorMsg.includes("недостатньо") || errorMsg.includes("баланс")) {
        setTxStatus(`❌ Помилка: Недостатньо коштів. Потрібно мінімум 0.01 ALEO для комісії.`);
        console.error("❌ Недостатньо коштів для транзакції");
        console.error("💡 Потрібно мінімум 0.01 ALEO для комісії блокчейну");
      } else {
        const shortError = errorMsg.slice(0, 80);
        setTxStatus(`❌ Помилка: ${shortError}${errorMsg.length > 80 ? '...' : ''}`);
        console.error("❌ Помилка транзакції:", error);
      }
      
      // Remove optimistic message on error
      setHistories(prev => ({
        ...prev,
        [currentChatId]: (prev[currentChatId] || []).filter(m => m.id !== userMsg.id)
      }));
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    if (!newChatAddress.trim()) return;
    
    if (!isValidAleoAddress(newChatAddress)) {
      alert('Invalid Aleo address. Must start with "aleo1" and be 59-63 characters long.');
      return;
    }

    // Check if contact already exists
    const existingContact = contacts.find(c => c.address?.toLowerCase() === newChatAddress.toLowerCase());
    if (existingContact) {
      setActiveContactId(existingContact.id);
      setShowNewChatModal(false);
      setNewChatAddress('');
      setNewChatName('');
      return;
    }

    const newContact: Contact = {
      id: `contact-${Date.now()}`,
      name: newChatName.trim() || `Contact ${contacts.length + 1}`,
      description: newChatAddress.slice(0, 10) + '...' + newChatAddress.slice(-6),
      context: '',
      initials: getInitialsFromAddress(newChatAddress),
      address: newChatAddress,
      unreadCount: 0
    };

    setContacts(prev => [...prev, newContact]);
    setHistories(prev => ({
      ...prev,
      [newContact.id]: [{
        id: `init-${newContact.id}`,
        text: `SECURE CONNECTION ESTABLISHED WITH ${newContact.name}.`,
        sender: newContact.name,
        isUser: false,
        timestamp: new Date()
      }]
    }));
    setActiveContactId(newContact.id);
    setShowNewChatModal(false);
    setNewChatAddress('');
    setNewChatName('');
  };

  // Filter contacts based on search
  const filteredContacts = contacts.filter(contact => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      contact.name.toLowerCase().includes(query) ||
      contact.description.toLowerCase().includes(query) ||
      contact.address?.toLowerCase().includes(query)
    );
  });

  const activeContact = contacts.find(c => c.id === activeContactId);
  const currentMessages = activeContactId ? histories[activeContactId] || [] : [];
  const totalUnread = contacts.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  return (
    <div className="h-screen flex bg-brutal-white max-w-7xl mx-auto border-x-4 border-brutal-black overflow-hidden">
      
      {/* SIDEBAR - Contact List */}
      <div className={`
        flex-col border-r-4 border-brutal-black bg-brutal-white w-full md:w-80 flex-shrink-0 transition-all
        ${activeContactId ? 'hidden md:flex' : 'flex'}
      `}>
        {/* Header with wallet info */}
        <div className="bg-brutal-yellow p-4 border-b-4 border-brutal-black">
          <div className="text-xs font-bold uppercase mb-2">Connected Wallet</div>
          {publicKey ? (
            <div 
              className="font-black text-xs bg-brutal-black text-brutal-yellow p-2 font-mono break-all cursor-pointer hover:bg-gray-900 transition-colors"
              onClick={() => navigator.clipboard.writeText(publicKey)}
              title="Click to copy"
            >
              {publicKey}
            </div>
          ) : (
            <div 
              className="font-black text-xs bg-gray-300 text-gray-600 p-2 font-mono text-center cursor-pointer hover:bg-gray-400 transition-colors"
              onClick={() => {
                setWalletRequiredAction('view wallet information');
                setShowWalletRequiredModal(true);
              }}
              title="Click to see wallet connection requirements"
            >
              NOT CONNECTED
            </div>
          )}
          <div className="flex gap-2 mt-2">
            <button 
              onClick={() => {
                if (!publicKey) {
                  setWalletRequiredAction('create a new chat');
                  setShowWalletRequiredModal(true);
                } else {
                  setShowNewChatModal(true);
                }
              }}
              className="flex-1 text-xs font-bold border-2 border-black p-2 hover:bg-black hover:text-white transition-colors uppercase bg-white"
            >
              + NEW CHAT
            </button>
            <button 
              onClick={() => {
                if (!publicKey) {
                  setWalletRequiredAction('view or create your profile');
                  setShowWalletRequiredModal(true);
                } else {
                  setShowProfileModal(true);
                }
              }}
              className="text-xs font-bold border-2 border-black p-2 hover:bg-black hover:text-white transition-colors uppercase bg-white"
            >
              PROFILE
            </button>
            <button 
              onClick={() => disconnect()} 
              className="text-xs font-bold border-2 border-black p-2 hover:bg-black hover:text-white transition-colors uppercase bg-white"
            >
              DISCONNECT
            </button>
          </div>
        </div>

        {/* Search Bar with Sync */}
        <div className="p-2 border-b-4 border-brutal-black bg-white">
          <div className="relative mb-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="SEARCH CONTACTS..."
              className="w-full p-2 border-2 border-brutal-black bg-white font-mono text-sm focus:outline-none focus:bg-brutal-yellow placeholder-gray-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-xs font-bold border border-black px-2 py-1 hover:bg-black hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
          <button
            onClick={() => {
              if (!publicKey) {
                setWalletRequiredAction('sync messages from the blockchain');
                setShowWalletRequiredModal(true);
              } else {
                syncMessages();
              }
            }}
            disabled={isSyncing || !publicKey}
            className="w-full p-2 border-2 border-brutal-black bg-brutal-yellow hover:bg-yellow-300 font-bold uppercase text-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSyncing ? 'SYNCING...' : 'SYNC MESSAGES'}
          </button>
          {syncStatus && (
            <div className="mt-1 text-[10px] font-bold text-gray-600 text-center">
              {syncStatus}
            </div>
          )}
        </div>
        
        {/* Contacts List */}
        <div className="overflow-y-auto flex-1">
          {filteredContacts.length === 0 ? (
            <div className="p-4 text-center text-xs font-bold text-gray-500">
              {searchQuery ? 'NO MATCHES FOUND' : 'NO CONTACTS'}
            </div>
          ) : (
            <>
              <div className="p-2 text-xs font-bold text-gray-500 uppercase border-b-2 border-gray-300">
                ENCRYPTED CONTACTS ({filteredContacts.length})
                {totalUnread > 0 && (
                  <span className="ml-2 bg-brutal-black text-brutal-yellow px-2 py-0.5">
                    {totalUnread}
                  </span>
                )}
              </div>
              {filteredContacts.map(contact => (
                <div 
                  key={contact.id}
                  className={`
                    p-3 border-b-2 border-brutal-black transition-all
                    ${activeContactId === contact.id 
                      ? 'bg-brutal-black text-brutal-yellow' 
                      : 'bg-white text-black hover:bg-brutal-yellow'}
                  `}
                >
                  <div 
                    className="flex items-center gap-3 cursor-pointer"
                    onClick={() => handleContactSelect(contact.id)}
                  >
                    <div className={`
                      w-10 h-10 border-2 flex items-center justify-center font-bold flex-shrink-0 text-sm
                      ${activeContactId === contact.id ? 'border-brutal-yellow' : 'border-brutal-black'}
                    `}>
                      {contact.initials}
                    </div>
                    <div className="overflow-hidden flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        {editingContactId === contact.id ? (
                          <input
                            type="text"
                            value={editingContactName}
                            onChange={(e) => setEditingContactName(e.target.value)}
                            onBlur={async () => {
                              if (editingContactName.trim() && editingContactName !== contact.name) {
                                await handleUpdateContactName(contact.id, editingContactName.trim());
                              }
                              setEditingContactId(null);
                              setEditingContactName('');
                            }}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                if (editingContactName.trim() && editingContactName !== contact.name) {
                                  await handleUpdateContactName(contact.id, editingContactName.trim());
                                }
                                setEditingContactId(null);
                                setEditingContactName('');
                              } else if (e.key === 'Escape') {
                                setEditingContactId(null);
                                setEditingContactName('');
                              }
                            }}
                            className="bg-brutal-yellow border-2 border-brutal-black px-2 py-1 font-black text-sm focus:outline-none"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <div className="font-black text-sm leading-none truncate">{contact.name}</div>
                        )}
                        {contact.unreadCount && contact.unreadCount > 0 && (
                          <span className="bg-brutal-yellow text-black text-xs font-bold px-1.5 py-0.5 min-w-[20px] text-center">
                            {contact.unreadCount}
                          </span>
                        )}
                      </div>
                      <div className={`text-xs truncate mt-1 ${activeContactId === contact.id ? 'text-gray-400' : 'text-gray-600'}`}>
                        {contact.lastMessage || contact.description}
                      </div>
                      {contact.lastMessageTime && (
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {contact.lastMessageTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        setEditingContactId(contact.id);
                        setEditingContactName(contact.name);
                      }}
                      className={`
                        text-xs font-black border-4 border-brutal-black px-3 py-1.5 uppercase shadow-hard transition-all
                        ${activeContactId === contact.id 
                          ? 'bg-brutal-yellow text-black hover:bg-yellow-300' 
                          : 'bg-brutal-yellow text-black hover:bg-yellow-300'}
                      `}
                    >
                      EDIT
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDeleteConfirm(contact.id);
                      }}
                      className={`
                        text-xs font-black border-4 border-brutal-black px-3 py-1.5 uppercase shadow-hard transition-all
                        ${activeContactId === contact.id 
                          ? 'bg-white text-black hover:bg-red-500 hover:text-white' 
                          : 'bg-white text-black hover:bg-red-500 hover:text-white'}
                      `}
                    >
                      DELETE
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        
        <div className="p-3 border-t-4 border-brutal-black text-center text-xs font-bold bg-gray-50">
          GHOST v0.9.1 (ALEO)
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div className={`
        flex-1 flex-col relative bg-[url('https://www.transparenttextures.com/patterns/graphy.png')]
        ${activeContactId ? 'flex' : 'hidden md:flex'}
      `}>
        {activeContactId ? (
          <>
            {/* Chat Header */}
            <header className="bg-white border-b-4 border-brutal-black p-4 z-10 sticky top-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setActiveContactId(null)}
                    className="md:hidden border-2 border-black w-10 h-10 flex items-center justify-center font-bold hover:bg-brutal-black hover:text-white"
                  >
                    {'<'}
                  </button>
                  <div className="w-12 h-12 bg-brutal-yellow border-2 border-black flex items-center justify-center font-bold text-lg shadow-hard-sm">
                    {activeContact?.initials}
                  </div>
                  <div>
                    <h2 className="text-xl font-black uppercase leading-none">{activeContact?.name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-bold text-green-600">● SECURE ON-CHAIN</span>
                      {activeContact?.address && (
                        <button
                          onClick={() => {
                            if (!publicKey) {
                              setWalletRequiredAction('view contact address details');
                              setShowWalletRequiredModal(true);
                            } else {
                              setShowAddressDetails(showAddressDetails === activeContact.id ? null : activeContact.id);
                            }
                          }}
                          className="text-xs font-bold text-gray-600 hover:text-black underline"
                        >
                          {showAddressDetails === activeContact.id ? 'HIDE' : 'SHOW'} ADDRESS
                        </button>
                      )}
                    </div>
                    {showAddressDetails === activeContact.id && activeContact?.address && (
                      <div 
                        className="mt-2 p-2 bg-gray-100 border-2 border-black font-mono text-xs break-all cursor-pointer hover:bg-brutal-yellow transition-colors"
                        onClick={() => navigator.clipboard.writeText(activeContact.address!)}
                        title="Click to copy"
                      >
                        {activeContact.address}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-xs font-bold text-gray-500">
                  {currentMessages.length} MESSAGES
                </div>
              </div>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
              {currentMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] md:max-w-[70%] relative ${msg.isUser ? 'mr-2' : 'ml-2'}`}>
                    <div className={`absolute -top-3 ${msg.isUser ? 'right-0' : 'left-0'} bg-brutal-black text-white text-xs px-2 py-0.5 font-bold uppercase`}>
                      {msg.sender}
                    </div>
                    <div className={`
                      p-4 border-4 border-brutal-black shadow-hard text-lg font-bold break-words whitespace-pre-wrap
                      ${msg.isUser ? 'bg-brutal-yellow text-black' : 'bg-white text-black'}
                    `}>
                      {msg.text}
                    </div>
                    <div className={`text-xs mt-1 font-bold text-gray-500 ${msg.isUser ? 'text-right' : 'text-left'}`}>
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {msg.timestamp.toLocaleDateString()}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <footer className="bg-white border-t-4 border-brutal-black p-4 sticky bottom-0 z-20">
              {txStatus && (
                <div className="mb-2 text-xs font-bold uppercase bg-brutal-yellow border-2 border-black p-2">
                  {txStatus}
                </div>
              )}
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!publicKey) {
                  setWalletRequiredAction('send a message');
                  setShowWalletRequiredModal(true);
                } else {
                  handleSend(e);
                }
              }} className="flex gap-2 md:gap-4">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSending || !publicKey}
                  className="flex-1 bg-gray-50 border-4 border-brutal-black p-3 md:p-4 font-bold text-lg focus:outline-none focus:bg-white placeholder-gray-400 shadow-hard-sm focus:shadow-none transition-all disabled:opacity-50"
                  placeholder={publicKey ? "Type encrypted message..." : "Connect wallet to send messages..."}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isSending || !publicKey}
                  onClick={(e) => {
                    if (!publicKey) {
                      e.preventDefault();
                      setWalletRequiredAction('send a message');
                      setShowWalletRequiredModal(true);
                    }
                  }}
                  className="bg-brutal-yellow border-4 border-brutal-black px-6 md:px-8 font-black uppercase text-lg md:text-xl hover:translate-x-1 hover:translate-y-1 hover:shadow-none shadow-hard transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="hidden md:inline">{isSending ? 'SENDING...' : 'SEND'}</span>
                  <span className="md:hidden">{isSending ? '...' : '>'}</span>
                </button>
              </form>
            </footer>
          </>
        ) : (
          /* Placeholder State (Desktop only) */
          <div className="hidden md:flex flex-col items-center justify-center h-full text-center p-8 bg-brutal-white">
            <div className="w-32 h-32 bg-brutal-yellow border-8 border-brutal-black mb-6 shadow-hard-lg flex items-center justify-center">
              <span className="text-6xl font-black">👻</span>
            </div>
            <h2 className="text-5xl font-black uppercase mb-4 text-brutal-black">AWAITING<br/>SIGNAL</h2>
            <p className="font-bold max-w-md mb-6 text-brutal-black text-lg">Select a secure channel from the left to begin ZK-encrypted transmission.</p>
            <button
              onClick={() => setShowNewChatModal(true)}
              className="bg-brutal-yellow border-4 border-brutal-black px-8 py-4 font-black uppercase text-xl hover:translate-x-1 hover:translate-y-1 hover:shadow-none shadow-hard transition-all"
            >
              CREATE NEW CHAT
            </button>
          </div>
        )}
      </div>

      {/* Profile Modal */}
      {showProfileModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowProfileModal(false)}
        >
          <div 
            className="bg-white border-4 border-brutal-black p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-black uppercase mb-4">CREATE PROFILE</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase mb-2">NAME *</label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Your name..."
                  className="w-full p-3 border-4 border-brutal-black bg-white font-bold text-sm focus:outline-none focus:bg-brutal-yellow"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase mb-2">BIO *</label>
                <textarea
                  value={profileBio}
                  onChange={(e) => setProfileBio(e.target.value)}
                  placeholder="Your bio..."
                  rows={4}
                  className="w-full p-3 border-4 border-brutal-black bg-white font-bold text-sm focus:outline-none focus:bg-brutal-yellow resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!profileName.trim() || !profileBio.trim() || !publicKey || !adapter) {
                      alert('Please fill all fields');
                      return;
                    }

                    setIsSending(true);
                    setTxStatus('Creating profile...');

                    try {
                      const nameField = stringToField(profileName);
                      const bioField = stringToField(profileBio);

                      const transaction = Transaction.createTransaction(
                        publicKey,
                        network,
                        PROGRAM_ID,
                        "create_profile",
                        [nameField, bioField],
                        TRANSACTION_FEE,
                        false
                      );

                      setTxStatus('Очікування підпису...');
                      const txId = await adapter.requestTransaction(transaction);

                      if (txId) {
                        setTxStatus(`Profile created! TX: ${txId.slice(0, 8)}...`);
                        setTimeout(() => {
                          setShowProfileModal(false);
                          setProfileName('');
                          setProfileBio('');
                          setTxStatus('');
                        }, 2000);
                      }
                    } catch (error: any) {
                      console.error("Profile creation error:", error);
                      const errorMsg = error?.message || String(error);
                      if (errorMsg.includes("Permission") || errorMsg.includes("NOT_GRANTED")) {
                        setTxStatus("Transaction rejected");
                      } else {
                        setTxStatus("Error: " + errorMsg.slice(0, 30));
                      }
                    } finally {
                      setIsSending(false);
                    }
                  }}
                  disabled={!profileName.trim() || !profileBio.trim() || isSending || !publicKey}
                  className="flex-1 bg-brutal-yellow border-4 border-brutal-black px-4 py-3 font-black uppercase hover:translate-x-1 hover:translate-y-1 hover:shadow-none shadow-hard transition-all disabled:opacity-50"
                >
                  {isSending ? 'CREATING...' : 'CREATE'}
                </button>
                <button
                  onClick={() => {
                    setShowProfileModal(false);
                    setProfileName('');
                    setProfileBio('');
                    setTxStatus('');
                  }}
                  className="bg-white border-4 border-brutal-black px-4 py-3 font-black uppercase hover:bg-gray-100"
                >
                  CANCEL
                </button>
              </div>
              {txStatus && (
                <div className="text-xs font-bold uppercase bg-brutal-yellow border-2 border-black p-2">
                  {txStatus}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowDeleteConfirm(null)}
        >
          <div 
            className="bg-white border-4 border-brutal-black p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-black uppercase mb-4">DELETE CHAT</h2>
            <p className="font-bold mb-6">Are you sure you want to delete this chat? All messages will be permanently removed.</p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const contactId = showDeleteConfirm;
                  setShowDeleteConfirm(null);
                  await handleDeleteChat(contactId);
                }}
                className="flex-1 bg-red-600 border-4 border-brutal-black px-4 py-3 font-black uppercase hover:bg-red-700 text-white transition-colors"
              >
                DELETE
              </button>
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="bg-white border-4 border-brutal-black px-4 py-3 font-black uppercase hover:bg-gray-100"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowNewChatModal(false)}
        >
          <div 
            className="bg-white border-4 border-brutal-black p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-black uppercase mb-4">NEW CHAT</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase mb-2">ALEO ADDRESS *</label>
                <input
                  type="text"
                  value={newChatAddress}
                  onChange={(e) => setNewChatAddress(e.target.value)}
                  placeholder="aleo1..."
                  className="w-full p-3 border-4 border-brutal-black bg-white font-mono text-sm focus:outline-none focus:bg-brutal-yellow"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase mb-2">CONTACT NAME (OPTIONAL)</label>
                <input
                  type="text"
                  value={newChatName}
                  onChange={(e) => setNewChatName(e.target.value)}
                  placeholder="Enter name..."
                  className="w-full p-3 border-4 border-brutal-black bg-white font-bold text-sm focus:outline-none focus:bg-brutal-yellow"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleNewChat}
                  disabled={!newChatAddress.trim()}
                  className="flex-1 bg-brutal-yellow border-4 border-brutal-black px-4 py-3 font-black uppercase hover:translate-x-1 hover:translate-y-1 hover:shadow-none shadow-hard transition-all disabled:opacity-50"
                >
                  CREATE
                </button>
                <button
                  onClick={() => {
                    setShowNewChatModal(false);
                    setNewChatAddress('');
                    setNewChatName('');
                  }}
                  className="bg-white border-4 border-brutal-black px-4 py-3 font-black uppercase hover:bg-gray-100"
                >
                  CANCEL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Required Modal */}
      {showWalletRequiredModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowWalletRequiredModal(false)}
        >
          <div 
            className="bg-white border-4 border-brutal-black p-6 max-w-md w-full mx-4 shadow-hard-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-6">
              <div className="w-20 h-20 bg-brutal-yellow border-4 border-brutal-black mx-auto mb-4 flex items-center justify-center">
                <span className="text-4xl font-black">🔒</span>
              </div>
              <h2 className="text-2xl font-black uppercase mb-2">WALLET REQUIRED</h2>
              <p className="font-bold text-sm text-gray-700">
                You need to connect your wallet to {walletRequiredAction}.
              </p>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-bold text-gray-600 text-center">
                Connect your Aleo wallet (Leo Wallet) to access all features including:
              </p>
              <ul className="text-xs font-bold space-y-1 text-left bg-gray-50 p-3 border-2 border-brutal-black">
                <li>• Send and receive encrypted messages</li>
                <li>• View transaction history</li>
                <li>• Manage your profile</li>
                <li>• Sync messages from blockchain</li>
              </ul>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setShowWalletRequiredModal(false)}
                className="flex-1 bg-brutal-yellow border-4 border-brutal-black px-4 py-3 font-black uppercase hover:translate-x-1 hover:translate-y-1 hover:shadow-none shadow-hard transition-all"
              >
                GOT IT
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatInterface;
