import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { FC } from "react";
import { Header } from "./Header";
import { WalletProvider } from "@demox-labs/aleo-wallet-adapter-react";
import { LeoWalletAdapter } from "@demox-labs/aleo-wallet-adapter-leo";
import { PuzzleWalletAdapter } from "aleo-adapters";
import {
    DecryptPermission,
    WalletAdapterNetwork,
    Transaction,
} from "@demox-labs/aleo-wallet-adapter-base";
import { useWallet } from "@demox-labs/aleo-wallet-adapter-react";
import { PROGRAM_ID } from "./deployed_program";
import { useWalletRecords } from "./hooks/useWalletRecords";
import { TxCache } from "./utils/txCache";
import { PermissionAlert } from "./components/PermissionAlert";
import "./App.css";

// Program ID - v5 with message indexing
// const PROGRAM_ID = "priv_mess_v5.aleo";




type SentHistoryStatus = "Pending" | "Submitted" | "Success" | "Failed" | "Unknown";

type SentHistoryItem = {
    txId: string;
    type: string;
    timestamp: number;
    status: SentHistoryStatus;
    recipient?: string;
};

type InboxMessage = {
    id?: string;
    type: string;
    content: string;
    isDecrypted?: boolean;
    decryptedContent?: string;
    originalContent?: string;
    sender?: string;
    timestamp?: number;
    status?: string;
    cipherText?: string;
    txId?: string;
    transitionId?: string;
    tpk?: string;
    outputIndex?: number;
};

type WalletAdapterExtras = {
    transactionStatus?: (txId: string) => Promise<string>;
    requestTransaction?: (tx: Transaction) => Promise<string>;
    requestRecordPlaintexts?: (programId: string) => Promise<Array<{ id?: string; plaintext: string }>>;
    requestRecords?: (programId: string) => Promise<unknown[]>;
    requestTransactionHistory?: (programId: string) => Promise<unknown[]>;
    decrypt?: (cipherText: string, tpk?: string, programId?: string, functionName?: string, index?: number) => Promise<unknown>;
};

type Profile = {
    name: string;
    bio: string;
};

const getErrorMessage = (e: unknown) => {
    if (e instanceof Error) return e.message;
    if (typeof e === "string") return e;
    try {
        return JSON.stringify(e);
    } catch {
        return "Unknown error";
    }
};

interface NetworkProps {
    network: WalletAdapterNetwork;
}

export const WalletConnectButton: FC<NetworkProps> = ({ network }) => {
    const { publicKey, disconnect, connecting, select, wallets } = useWallet();
    const [showModal, setShowModal] = useState(false);

    if (publicKey) {
        return (
            <button onClick={disconnect}>
                Disconnect {publicKey.slice(0, 6)}...{publicKey.slice(-4)}
            </button>
        );
    }

    return (
        <>
            <button
                disabled={connecting}
                onClick={() => setShowModal(true)}
            >
                {connecting ? "Connecting..." : "Select Wallet"}
            </button>

            {showModal && (
                <div style={{
                    position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
                    background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000
                }}>
                    <div style={{ background: "white", padding: "20px", borderRadius: "8px", width: "300px", color: "black" }}>
                        <h3>Select Wallet</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            {wallets.map((w) => (
                                <button
                                    key={w.adapter.name}
                                    onClick={async () => {
                                        try {
                                            // Fix: Connect directly via adapter to avoid WalletNotSelectedError
                                            // The 'connect' from useWallet relies on 'selected' state which updates async
                                            try {
                                                await w.adapter.connect(DecryptPermission.OnChainHistory, network, [PROGRAM_ID]);
                                                select(w.adapter.name);
                                                setShowModal(false);
                                            } catch (e: unknown) {
                                                console.error("Connection failed:", e);
                                                const msg = getErrorMessage(e);
                                                if (msg.includes("NETWORK_NOT_GRANTED")) {
                                                    alert(`Connection failed: Incorrect Network.\nPlease switch your Leo Wallet to '${network}' and try again.`);
                                                } else {
                                                    alert("Connection failed: " + msg);
                                                }
                                            }
                                        } catch (e: unknown) {
                                            // Redundant catch but safe
                                            console.error("Connection failed:", e);
                                            alert("Connection failed: " + getErrorMessage(e));
                                        }
                                    }}
                                    style={{ padding: "10px", cursor: "pointer", border: "1px solid #ddd", background: "#fff" }}
                                >
                                    {w.adapter.name}
                                </button>
                            ))}
                            <button onClick={() => setShowModal(false)} style={{ marginTop: "10px", background: "#eee" }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

const MessengerUI: FC<NetworkProps> = ({ network }) => {
    const { wallet, publicKey, transactionStatus, requestRecords, connect, disconnect } = useWallet();
    const adapter = wallet?.adapter as unknown as WalletAdapterExtras | undefined;
    const { fetchRecords, hasPermission } = useWalletRecords();
    const [status, setStatus] = useState("Idle");
    const [recipient, setRecipient] = useState("");
    const [message, setMessage] = useState("");
    const [profileName, setProfileName] = useState("");
    const [profileBio, setProfileBio] = useState("");
    const [fetchedProfile, setFetchedProfile] = useState<Profile | null>(null);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [sentHistory, setSentHistory] = useState<SentHistoryItem[]>([]);
    // const [profiles] = useState<Map<string, Profile>>(() => new Map()); // Unused for now
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
    const [importTxId, setImportTxId] = useState("");
    const [scanProgress, setScanProgress] = useState(0);
    const retryMap = useRef<{ [key: string]: number }>({});
    const isSyncingRef = useRef(false);



    const fetchProfiles = async () => {
        try {
            // In a real app, we would fetch all profiles from the contract mapping
            // For now, we'll just try to fetch the current user's profile if they have one
            if (publicKey) {
                // This is a placeholder. To fully implement, we need a way to query 
                // the 'profiles' mapping from the contract for specific addresses.
                // Since we don't have a list of all users, we can't easily pre-fetch everyone.
                // However, we can implement a lazy lookup in the future.

                // For this demo, we'll just ensure the state is initialized
                console.log("Profiles state initialized");
            }
        } catch (e) {
            console.warn("Failed to fetch profiles:", e);
        }
    };

    // Check Pending Transactions
    useEffect(() => {
        const checkPending = async () => {
            if (!publicKey) return;

            let updated = false;
            const newHistory = await Promise.all(sentHistory.map(async (item) => {
                if (item.status === "Pending" || item.status === "Submitted") {
                    let statusChanged = false;
                    const newItem = { ...item };

                    // Increment retry count for this tx
                    retryMap.current[item.txId] = (retryMap.current[item.txId] || 0) + 1;
                    const failCount = retryMap.current[item.txId] || 0;
                    if (failCount > 20) { // Stop after ~100 seconds of failures
                        newItem.status = "Unknown";
                        statusChanged = true;
                    }

                    // Check wallet status first
                    if (adapter && adapter.transactionStatus) {
                        try {
                            const s = await adapter.transactionStatus(item.txId);
                            if (s === "Completed" || s === "Finalized") {
                                newItem.status = "Success";
                                statusChanged = true;
                                console.log("Transaction mined.");
                            } else if (s === "Failed" || s === "Rejected") {
                                newItem.status = "Failed";
                                statusChanged = true;
                            }
                        } catch {
                            void 0;
                        }
                    }

                    if (statusChanged) {
                        updated = true;
                        return newItem;
                    }
                }
                return item;
            }));

            if (updated) {
                setSentHistory(newHistory);
            }
        };

        // Run immediately and then every 5 seconds
        if (sentHistory.some(i => i.status === "Pending" || i.status === "Submitted")) {
            checkPending();
            const interval = setInterval(checkPending, 5000);
            return () => clearInterval(interval);
        }
    }, [sentHistory, transactionStatus, publicKey, adapter]);

    const addToHistory = (txId: string, type: string, recipient?: string) => {
        const newItem: SentHistoryItem = { txId, type, timestamp: Date.now(), status: "Pending", recipient };
        setSentHistory(prev => [newItem, ...prev]);
    };

    // Inbox State
    const [messages, setMessages] = useState<InboxMessage[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);

    // Load/Save Sent History and Inbox Messages based on PublicKey
    useEffect(() => {
        if (!publicKey) {
            setSentHistory([]);
            setMessages([]);
            return;
        }

        // Load Sent History
        const savedHistory = localStorage.getItem(`sentHistory_${publicKey}`);
        if (savedHistory) {
            try {
                setSentHistory(JSON.parse(savedHistory) as SentHistoryItem[]);
            } catch {
                console.warn("Failed to parse saved history");
            }
        }

        // Load Inbox Messages from localStorage ONLY as initial cache
        // Real data comes from blockchain via sync
        // Note: localStorage is just a cache - blockchain is the source of truth
        const savedMessages = localStorage.getItem(`inboxMessages_${publicKey}`);
        if (savedMessages) {
            try {
                const parsed = JSON.parse(savedMessages);
                console.log(`📂 Loaded ${parsed.length} cached messages from localStorage`);
                console.log(`ℹ️  Note: These are cached. Click SYNC to get fresh data from blockchain.`);
                // Only set if messages state is empty (initial load only)
                setMessages(prev => {
                    if (prev.length === 0) {
                        console.log(`📂 Setting initial messages from cache: ${parsed.length}`);
                        return parsed;
                    } else {
                        console.log(`📂 Skipping cache load - messages already in state: ${prev.length}`);
                        return prev;
                    }
                });
            } catch {
                console.warn("Failed to parse saved messages");
            }
        } else {
            console.log(`📂 No cached messages in localStorage`);
            console.log(`ℹ️  Click SYNC to load messages from blockchain.`);
        }

        fetchProfiles();
    }, [publicKey]);

    // Save Sent History whenever it changes
    useEffect(() => {
        if (publicKey && sentHistory.length > 0) {
            localStorage.setItem(`sentHistory_${publicKey}`, JSON.stringify(sentHistory));
        }
    }, [sentHistory, publicKey]);

    // Save Inbox Messages to localStorage ONLY as cache after successful sync
    // This is just for performance - blockchain is the source of truth
    // IMPORTANT: Only save AFTER sync completes, not during sync
    useEffect(() => {
        if (publicKey && messages.length > 0 && !isSyncing) {
            // Only save if we have messages AND sync is not in progress
            // This prevents overwriting new messages with old cached data
            console.log(`💾 Caching ${messages.length} messages to localStorage (blockchain is source of truth)`);
            localStorage.setItem(`inboxMessages_${publicKey}`, JSON.stringify(messages));
        }
    }, [messages, publicKey, isSyncing]);


    useEffect(() => {
        if (publicKey) {
            const savedProfile = localStorage.getItem(`profile_${publicKey}`);
            if (savedProfile) {
                try {
                    setFetchedProfile(JSON.parse(savedProfile) as Profile);
                } catch {
                    void 0;
                }
            }
        }
    }, [publicKey]);

    // --- Helper Functions ---

    // New robust parser for Aleo records
    const parseMessageContent = (raw: string): string => {
        if (!raw) return "";

        // 1. If it doesn't look like a record, assume it might be a direct field or plain text
        if (!raw.includes("owner:") && !raw.includes("content:")) {
            // Check if it's a field value directly (e.g. "56field")
            if (raw.match(/^\d+field(?:\.(?:private|public))?$/)) {
                return fieldToString(raw);
            }
            // Return as is (could be already decoded)
            return raw;
        }

        // 2. Extract content value
        if (!raw) return ""; // Guard against null/undefined
        const cleanStr = String(raw).replace(/\s+/g, " ");
        // Match "content:" followed by value, ending at comma or closing brace
        // We capture everything until the next separator
        const match = cleanStr.match(/content:\s*([^,}\s]+)/);

        if (match && match[1]) {
            // 3. Decode the extracted field
            return fieldToString(match[1]);
        }

        return raw; // Fallback
    };

    const stringToField = (str: string) => {
        try {
            if (!str) return "0field";
            const encoder = new TextEncoder();
            const encoded = encoder.encode(str);
            let val = BigInt(0);
            for (let i = 0; i < Math.min(encoded.length, 31); i++) {
                val = (val << BigInt(8)) | BigInt(encoded[i]);
            }
            return val.toString() + "field";
        } catch (e) {
            console.error("Error encoding string to field:", e);
            return "0field";
        }
    };

    const fieldToString = (fieldStr: string) => {
        try {
            // Remove known suffixes first (global replace)
            let valStr = fieldStr.replace(/field/g, "")
                .replace(/u64/g, "")
                .replace(/\.private/g, "")
                .replace(/\.public/g, "");

            // Remove any non-digit characters to be safe (e.g. spaces, commas, quotes)
            valStr = valStr.replace(/\D/g, "");

            if (!valStr) return fieldStr;

            let val = BigInt(valStr);
            const originalValStr = valStr;

            const bytes = [];
            while (val > 0n) {
                bytes.unshift(Number(val & 0xffn));
                val >>= 8n;
            }

            if (bytes.length === 0) return "";

            const decoder = new TextDecoder();
            const decoded = decoder.decode(new Uint8Array(bytes));

            if (decoded.length === 0) return originalValStr;

            // Printable check
            let isPrintable = true;
            for (let i = 0; i < decoded.length; i++) {
                if (decoded.charCodeAt(i) < 32) {
                    isPrintable = false;
                    break;
                }
            }

            if (!isPrintable) {
                return originalValStr;
            }

            return decoded;
        } catch {
            return fieldStr;
        }
    };



    // --- Actions ---

    const handleCreateProfile = async () => {
        if (!publicKey) return alert("Connect wallet first");
        if (!adapter?.requestTransaction) return alert("Please connect your wallet first.");

        const encoder = new TextEncoder();
        if (encoder.encode(profileName).length > 31) {
            return alert(`Name too long! Max 31 bytes (current: ${encoder.encode(profileName).length})`);
        }

        localStorage.setItem(`profile_${publicKey}`, JSON.stringify({ name: profileName, bio: profileBio }));
        setFetchedProfile({ name: profileName, bio: profileBio });

        setStatus("Creating Profile... Signing Transaction...");
        try {
            const nameField = stringToField(profileName);
            const bioField = stringToField(profileBio);

            const transaction = Transaction.createTransaction(
                publicKey,
                network,
                PROGRAM_ID,
                "update_profile",
                [nameField, bioField],
                4000000,
                false // public fee
            );

            const txId = await adapter.requestTransaction(transaction);

            if (txId) {
                addToHistory(txId, "Update Profile");
                setStatus("Profile update transaction sent! ID: " + txId);
            }
        } catch (e: unknown) {
            console.error("Profile update error", e);
            setStatus("Error: " + getErrorMessage(e));
        }
    };

    const sendMessage = async () => {
        if (!recipient || !message) return alert("Fill fields");
        if (!publicKey) return alert("Connect wallet");
        if (!adapter?.requestTransaction) return alert("Please connect your wallet first.");

        try {
            setStatus("Sending message...");
            const contentField = stringToField(message);

            const transaction = Transaction.createTransaction(
                publicKey,
                network,
                PROGRAM_ID,
                "send_message",
                [recipient, contentField],
                4000000,
                false
            );

            const txId = await adapter.requestTransaction(transaction);

            if (txId) {
                addToHistory(txId, "Send Message", recipient);
                setStatus("Message sent! ID: " + txId);
                setMessage("");
            }
        } catch (e: unknown) {
            const msg = getErrorMessage(e);
            if (msg.includes("Permission") || msg.includes("NOT_GRANTED")) {
                setStatus("Transaction rejected by user.");
            } else {
                console.error("Send message error:", e);
                setStatus("Error sending: " + msg);
            }
        }
    };

    // Helper to sanitize record string
    const sanitizeRecordString = (str: string) => {
        if (!str) return "";
        // 1. Remove ALL whitespace (including internal spaces, newlines)
        let cleaned = str.replace(/\s/g, "");
        
        // 2. Remove invisible control characters
        cleaned = cleaned.replace(/[\x00-\x1F\x7F-\x9F]/g, "");
        
        // 3. Remove surrounding quotes (recursively)
        while (cleaned.startsWith('"') && cleaned.endsWith('"')) {
            cleaned = cleaned.slice(1, -1);
        }

        // 4. Unescape escaped quotes (though strictly Bech32 shouldn't have them)
        cleaned = cleaned.replace(/\\"/g, '"');
        
        // 5. Final check: if it still contains quotes, remove them? 
        // Bech32 charset is alphanumeric. Quotes are invalid.
        cleaned = cleaned.replace(/["']/g, "");

        return cleaned;
    };

    type DecryptedRecord = {
        content: string;
        sender?: string;
        recipient?: string;
        fullPlaintext?: string;
    };

    const decryptRecord = async (
        ciphertext: string,
        ctx: { tpk?: string; programId: string; functionName: string; indexes: number[] }
    ): Promise<DecryptedRecord | null> => {
        if (!ciphertext) return null;
        const cleanCiphertext = sanitizeRecordString(ciphertext);
        
        let fullPlaintext = "";
        let content = "";
        let sender: string | undefined;
        let recipient: string | undefined;

        // Try Wallet Adapter
        if (!fullPlaintext && adapter?.decrypt) {
             const normalizeTpk = (tpk: string | undefined) => {
                if (!tpk) return [];
                const trimmed = tpk.trim();
                const withoutSuffix = trimmed.endsWith("group") ? trimmed.slice(0, -5) : trimmed;
                return Array.from(new Set([trimmed, withoutSuffix].filter(Boolean)));
            };

            const tryDecryptFn = async (args: any[]) => {
                try {
                     // @ts-ignore
                     return await adapter.decrypt(...args);
                } catch (e) { return null; }
            };

            const indexes = Array.from(new Set(ctx.indexes)).filter((n) => Number.isInteger(n) && n >= 0);
            const tpks = normalizeTpk(ctx.tpk);

            const attempts: any[][] = [
                [cleanCiphertext, undefined, undefined, undefined, undefined],
                [cleanCiphertext, undefined, ctx.programId, ctx.functionName, undefined],
                [cleanCiphertext, undefined, ctx.programId, ctx.functionName, 0],
                [cleanCiphertext, undefined, ctx.programId, ctx.functionName, 1],
            ];

            for (const tpk of tpks) {
                attempts.push([cleanCiphertext, tpk, undefined, undefined, undefined]);
                attempts.push([cleanCiphertext, tpk, ctx.programId, ctx.functionName, undefined]);
            }

            for (const tpk of tpks) {
                for (const index of indexes.length > 0 ? indexes : [0, 1]) {
                    attempts.push([cleanCiphertext, tpk, ctx.programId, ctx.functionName, index]);
                }
            }

            for (let i = 0; i < Math.min(attempts.length, 20); i++) {
                const res = await tryDecryptFn(attempts[i]);
                if (res) {
                    if (typeof res === 'string') {
                        fullPlaintext = res;
                    } else if (typeof res === 'object') {
                        // Handle object result
                        const obj = res as any;
                        if (obj.plaintext) fullPlaintext = obj.plaintext;
                        else if (obj.text) fullPlaintext = obj.text;
                        else if (obj.content) fullPlaintext = obj.content; // fallback
                        
                        // Extract fields directly from object if available
                        if (obj.sender) sender = obj.sender;
                        if (obj.recipient) recipient = obj.recipient;
                        if (obj.content) content = fieldToString(obj.content);
                    }
                    break;
                }
            }
        }

        if (fullPlaintext) {
             // Parse fields from string if not already found
             if (!content) {
                 const match = fullPlaintext.match(/content:\s*([^\s,.}]+)/);
                 if (match && match[1]) content = fieldToString(match[1]);
                 else content = fullPlaintext; // fallback
             }
             if (!sender) {
                 const match = fullPlaintext.match(/sender:\s*([^\s,.}]+)/);
                 if (match && match[1]) sender = match[1];
             }
             if (!recipient) {
                 const match = fullPlaintext.match(/recipient:\s*([^\s,.}]+)/);
                 if (match && match[1]) recipient = match[1];
             }
             
             return { content, sender, recipient, fullPlaintext };
        }
        
        return null;
    };


    const getProvableApiBase = (net: WalletAdapterNetwork) => {
        const origin =
            (import.meta.env.VITE_PROVABLE_API_ORIGIN as string | undefined) ||
            (import.meta.env.DEV ? "/provable" : "https://api.explorer.provable.com");
        const networkPath = net === WalletAdapterNetwork.MainnetBeta ? "mainnet" : "testnet";
        return `${origin.replace(/\/$/, "")}/v1/${networkPath}`;
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const fetchRecordsFromWalletAPI = async (_forceRefresh: boolean = false) => {
        try {
            console.log(`Fetching records from wallet API (force=${forceRefresh})...`);
            
            // Try requestRecords first (more reliable than requestRecordPlaintexts)
            const rr = requestRecords || adapter?.requestRecords;
            if (rr) {
                try {
                    const records = await rr(PROGRAM_ID);
                    console.log(`✅ Fetched ${records?.length || 0} records from wallet via requestRecords`);

                    if (records && records.length > 0 && adapter?.decrypt) {
                        const decryptedRecords: Array<{ id?: string; plaintext: string }> = [];
                        for (const record of records) {
                            try {
                                if (typeof record === "string") {
                                    if (record.startsWith("record1")) {
                                        const decrypted = await adapter.decrypt(record);
                                        if (typeof decrypted === "string") {
                                            decryptedRecords.push({ plaintext: decrypted });
                                        } else {
                                            decryptedRecords.push({ plaintext: JSON.stringify(decrypted) });
                                        }
                                    } else {
                                        decryptedRecords.push({ plaintext: record });
                                    }
                                } else if (record && typeof record === "object") {
                                    const obj = record as Record<string, unknown>;
                                    const ciphertext =
                                        (typeof obj.ciphertext === "string" && obj.ciphertext) ||
                                        (typeof obj.record === "string" && obj.record) ||
                                        "";
                                    if (ciphertext && ciphertext.startsWith("record1")) {
                                        const decrypted = await adapter.decrypt(ciphertext);
                                        decryptedRecords.push({
                                            id: typeof obj.id === "string" ? obj.id : undefined,
                                            plaintext: typeof decrypted === "string" ? decrypted : JSON.stringify(decrypted),
                                        });
                                    }
                                }
                            } catch (decryptErr) {
                                console.warn("Failed to decrypt record:", decryptErr);
                            }
                        }
                        return decryptedRecords;
                    }

                    return records || [];
                } catch (e: any) {
                    console.warn("requestRecords failed:", e);
                }
            }

            // Fallback: Try requestRecordPlaintexts (may fail with INVALID_PARAMS)
            // This is less reliable but sometimes works when requestRecords doesn't
            if (adapter?.requestRecordPlaintexts) {
                try {
                    const records = await adapter.requestRecordPlaintexts(PROGRAM_ID);
                    console.log(`✅ Fetched ${records?.length || 0} records from wallet via requestRecordPlaintexts`);
                    return records || [];
                } catch (e: any) {
                    // INVALID_PARAMS is expected in some cases - just log and continue
                    if (e?.message?.includes("INVALID_PARAMS")) {
                        console.log("⚠️  requestRecordPlaintexts returned INVALID_PARAMS (this is normal if OnChainHistory is not enabled)");
                    } else {
                        console.warn("requestRecordPlaintexts failed:", e);
                    }
                }
            }

            console.log("📭 No records available from wallet (this is normal if no messages received yet)");
            return [];
        } catch (e: unknown) {
            console.error("Wallet API fetch failed:", e);
            return [];
        }
    };


    const fetchProvableTransaction = async (txId: string): Promise<unknown | null> => {
        const base = getProvableApiBase(network);
        
        // Support both transaction ID (at1...) and transition ID (au1...)
        const isTransition = txId.startsWith("au1");
        const endpoint = isTransition ? "transition" : "transaction";
        const url = `${base}/${endpoint}/${txId}`;

        console.log(`🔍 Fetching ${isTransition ? "transition" : "transaction"} from ${url}`);

        const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 6; attempt++) {
            try {
                const res = await fetch(url);
                if (res.status === 429 || res.status >= 500) {
                    await delay(800 + attempt * 1000);
                    continue;
                }
                if (!res.ok) {
                    console.warn(`❌ Failed to fetch ${isTransition ? "transition" : "transaction"}: ${res.status} ${res.statusText}`);
                    return null;
                }
                const data = await res.json() as unknown;
                
                console.log(`✅ Fetched ${isTransition ? "transition" : "transaction"} data:`, data);
                
                // If it's a transition, wrap it in a transaction-like structure
                if (isTransition && data && typeof data === "object") {
                    const transitionData = data as Record<string, unknown>;
                    console.log(`📦 Transition data structure:`, {
                        program: transitionData.program,
                        function: transitionData.function,
                        id: transitionData.id,
                        inputs: transitionData.inputs,
                        outputs: transitionData.outputs
                    });
                    
                    // Return transition wrapped in execution.transitions format
                    const wrapped = {
                        execution: {
                            transitions: [transitionData]
                        },
                        id: transitionData.transactionId || transitionData.id || txId
                    };
                    console.log(`📦 Wrapped transition structure:`, wrapped);
                    return wrapped;
                }
                
                return data;
            } catch (error) {
                console.error(`❌ Error fetching ${isTransition ? "transition" : "transaction"}:`, error);
                await delay(800 + attempt * 1000);
            }
        }
        return null;
    };

    const addMessagesFromTxId = async (txId: string, target: Map<string, InboxMessage>): Promise<"added" | "not_found" | "no_access"> => {
        if (!publicKey) return "no_access";

        console.log(`🔍 Processing ${txId.startsWith("au1") ? "transition" : "transaction"} ${txId}...`);
        
        const tx = await fetchProvableTransaction(txId);
        if (!tx || typeof tx !== "object") {
            console.warn(`❌ Failed to fetch ${txId.startsWith("au1") ? "transition" : "transaction"} or invalid format`);
            return "not_found";
        }

        const txObj = tx as Record<string, unknown>;
        const execution = txObj.execution;
        
        // Handle both transaction format (with execution.transitions) and direct transition format
        let transitionsRaw: unknown[] = [];
        
        if (execution && typeof execution === "object") {
            const execObj = execution as Record<string, unknown>;
            const transitions = execObj.transitions;
            if (Array.isArray(transitions)) {
                transitionsRaw = transitions;
            }
        } else if (txId.startsWith("au1")) {
            // If it's a transition ID and data is already a transition object, use it directly
            transitionsRaw = [txObj];
        }
        
        if (!Array.isArray(transitionsRaw) || transitionsRaw.length === 0) {
            console.warn(`❌ No transitions found in ${txId}`);
            return "not_found";
        }

        console.log(`📦 Found ${transitionsRaw.length} transition(s) in ${txId}`);

        let addedAny = false;

        for (const transition of transitionsRaw) {
            if (!transition || typeof transition !== "object") continue;
            const transitionObj = transition as Record<string, unknown>;
            
            console.log(`🔍 Checking transition:`, {
                program: transitionObj.program,
                function: transitionObj.function,
                id: transitionObj.id
            });
            
            if (transitionObj.program !== PROGRAM_ID) {
                console.log(`⏭️  Skipping transition - wrong program: ${transitionObj.program}`);
                continue;
            }
            if (transitionObj.function !== "send_message") {
                console.log(`⏭️  Skipping transition - wrong function: ${transitionObj.function}`);
                continue;
            }
            
            const tpk = typeof transitionObj.tpk === "string" ? transitionObj.tpk : undefined;
            const transitionId = typeof transitionObj.id === "string" ? transitionObj.id : undefined;

            const inputsRaw = transitionObj.inputs;
            const inputs = Array.isArray(inputsRaw) ? inputsRaw : [];
            
            console.log(`📥 Transition inputs:`, inputs);
            
            const recipientAddr =
                (inputs[0] && typeof inputs[0] === "object" && (inputs[0] as Record<string, unknown>).type === "public")
                    ? String((inputs[0] as Record<string, unknown>).value || "")
                    : "";

            console.log(`👤 Recipient address: ${recipientAddr}, Current user: ${publicKey}`);
            
            if (!recipientAddr || recipientAddr !== publicKey) {
                console.log(`⏭️  Skipping transition - recipient mismatch`);
                continue;
            }

            const outputsRaw = transitionObj.outputs;
            const outputs = Array.isArray(outputsRaw) ? outputsRaw : [];

            console.log(`📤 Transition outputs: ${outputs.length} output(s)`);

            for (let idx = 0; idx < outputs.length; idx++) {
                const output = outputs[idx];
                if (!output || typeof output !== "object") {
                    console.log(`⏭️  Skipping output ${idx} - not an object`);
                    continue;
                }
                const outputObj = output as Record<string, unknown>;
                
                console.log(`📦 Output ${idx}:`, {
                    type: outputObj.type,
                    id: outputObj.id,
                    hasValue: !!outputObj.value
                });
                
                if (outputObj.type !== "record") {
                    console.log(`⏭️  Skipping output ${idx} - not a record (type: ${outputObj.type})`);
                    continue;
                }

                const recordId = typeof outputObj.id === "string" ? outputObj.id : undefined;
                const ciphertext = typeof outputObj.value === "string" ? outputObj.value : "";
                
                console.log(`🔐 Ciphertext for output ${idx}:`, ciphertext ? `${ciphertext.substring(0, 50)}...` : "empty");
                
                if (!ciphertext.startsWith("record1")) {
                    console.log(`⏭️  Skipping output ${idx} - not a record ciphertext`);
                    continue;
                }

                console.log(`🔓 Attempting to decrypt output ${idx}...`);
                let decrypted: DecryptedRecord | null = null;
                try {
                     decrypted = await decryptRecord(ciphertext, {
                        tpk,
                        programId: PROGRAM_ID,
                        functionName: "send_message",
                        indexes: [idx]
                     });
                     console.log(`✅ Decryption result for output ${idx}:`, decrypted ? {
                         hasContent: !!decrypted.content,
                         sender: decrypted.sender,
                         recipient: decrypted.recipient
                     } : "null");
                } catch (e) { 
                    console.warn(`❌ Decrypt in addMessagesFromTxId failed for output ${idx}:`, e); 
                }

                const id = recordId || `${txId}:${transitionId || "transition"}:${idx}`;
                
                // CRITICAL: Only add messages where current user is the RECIPIENT
                // This is the main function - check for new received SMS
                if (!decrypted) {
                    console.log(`⏭️  Skipping output ${idx} - decryption failed`);
                    // Can't verify recipient without decryption, skip
                    continue;
                }

                // Verify this is a received message (recipient === publicKey)
                console.log(`🔍 Verifying recipient: decrypted.recipient=${decrypted.recipient}, publicKey=${publicKey}`);
                if (decrypted.recipient !== publicKey) {
                    console.log(`⏭️  Skipping output ${idx} - recipient mismatch in decrypted data`);
                    // Not a received message, skip
                    continue;
                }

                // This is a received message
                console.log(`✅ Found received message in output ${idx}! Adding to inbox...`);
                const messageType = "received";
                const sender = decrypted.sender || "Unknown";
                const content = decrypted.content || "";

                // Ensure all required fields are set
                const message: InboxMessage = {
                    id: id,
                    type: messageType,
                    content: content,
                    decryptedContent: content,
                    originalContent: decrypted.fullPlaintext || "",
                    sender: sender,
                    timestamp: Date.now(),
                    status: "Decrypted",
                    txId,
                    transitionId,
                    tpk,
                    outputIndex: idx,
                };

                // Validate message before adding
                if (!message.id || !message.content || !message.sender) {
                    console.warn(`⚠️  Skipping invalid message: id="${message.id}", content="${message.content}", sender="${message.sender}"`);
                    continue;
                }

                target.set(id, message);
                addedAny = true;
                console.log(`✅ Message added to inbox with ID: ${id}, type: ${messageType}, sender: ${sender}, content length: ${content.length}`);
                console.log(`📊 Target Map size after adding: ${target.size}`);
                console.log(`📊 Target Map keys:`, Array.from(target.keys()));

                break;
            }
            
            if (!addedAny) {
                console.log(`⚠️  No messages added from transition ${transitionId || "unknown"}`);
            }
        }

        return addedAny ? "added" : "not_found";
    };

    // ========== getInboxMessages ==========
    // Optimized sync function: Try wallet records first, then cache, then minimal block scan
    const getInboxMessages = useCallback(async () => {
        if (!publicKey) {
            alert("Please connect your wallet.");
            return;
        }

        if (isSyncingRef.current) {
            console.log("⏭️  Sync already in progress, skipping...");
            return;
        }

        // const startTime = Date.now(); // Unused
        setIsSyncing(true);
        isSyncingRef.current = true;
        setScanProgress(0);

        try {
            console.log(`🔄 Starting optimized inbox sync for ${publicKey}...`);
            setStatus("Syncing inbox...");

            const allMessagesMap = new Map<string, InboxMessage>();
            const base = getProvableApiBase(network);
            
            // ✅ STEP 1: Try wallet records first (fastest, ~1-2 seconds)
            console.log(`🔄 Step 1: Fetching records from Leo Wallet...`);
            setStatus("Fetching records from wallet...");
            const walletRecords = await fetchRecords(PROGRAM_ID);
            
            if (walletRecords.length > 0) {
                console.log(`✅ Found ${walletRecords.length} records from wallet`);
                
                walletRecords.forEach(record => {
                    // Only process received messages
                    if (record.recipient !== publicKey) return;
                    
                    const id = record.nonce || `wallet-${record.sender}-${record.timestamp}`;
                    const parsedContent = parseMessageContent(record.content);
                    
                    allMessagesMap.set(id, {
                        id: id,
                        type: "received",
                        content: parsedContent,
                        decryptedContent: parsedContent,
                        originalContent: record.content,
                        sender: record.sender,
                        timestamp: record.timestamp * 1000 || Date.now(),
                        status: "Decrypted"
                    });
                });
                
                // Save to cache
                const cachedTxs = Array.from(allMessagesMap.values()).map(msg => ({
                    txId: msg.id || "",
                    height: 0,
                    sender: msg.sender || "",
                    recipient: publicKey,
                    content: msg.content || "",
                    timestamp: (msg.timestamp || Date.now()) / 1000,
                    cachedAt: Date.now(),
                }));
                TxCache.save(publicKey, cachedTxs);
                
                console.log(`✅ Loaded ${allMessagesMap.size} messages from wallet records`);
            } else {
                // ✅ STEP 2: Check cache if no wallet records
                console.log(`⚠️ No records from wallet, checking cache...`);
                setStatus("Checking cache...");
                const cachedMessages = TxCache.get(publicKey);
                
                if (cachedMessages.length > 0) {
                    console.log(`📦 Loaded ${cachedMessages.length} messages from cache`);
                    
                    cachedMessages.forEach(tx => {
                        if (tx.recipient !== publicKey) return;
                        
                        const parsedContent = parseMessageContent(tx.content);
                        allMessagesMap.set(tx.txId, {
                            id: tx.txId,
                            type: "received",
                            content: parsedContent,
                            decryptedContent: parsedContent,
                            sender: tx.sender,
                            timestamp: tx.timestamp * 1000,
                            status: "Cached"
                        });
                    });
                }
                
                // ✅ STEP 3: Minimal block scan (only if needed, last 200 blocks)
                // Only scan if we have very few messages or cache is empty
                if (allMessagesMap.size === 0 || (allMessagesMap.size < 5 && walletRecords.length === 0)) {
                console.log(`🔍 Step 3: Performing minimal block scan (last 200 blocks)...`);
                setStatus("Scanning recent blocks...");
                
                // Get current block height
                let currentHeight = 0;
                let lastSyncedHeight = 0;
                
                try {
                    const heightUrl = `${base}/latest/height`;
                    const heightResponse = await fetch(heightUrl);
                    if (heightResponse.ok) {
                        const heightText = await heightResponse.text();
                        currentHeight = parseInt(heightText, 10);
                        console.log(`📊 Current block height: ${currentHeight}`);
                    }
                    
                    const lastSyncedHeightKey = `last_synced_height_${publicKey}_${PROGRAM_ID}`;
                    const lastSyncedHeightRaw = localStorage.getItem(lastSyncedHeightKey);
                    lastSyncedHeight = lastSyncedHeightRaw ? parseInt(lastSyncedHeightRaw, 10) : 0;
                } catch (error) {
                    console.warn("Failed to get block height:", error);
                }

                // Optimized: Scan only last 200 blocks (instead of 1000)
                const OPTIMIZED_SCAN_DEPTH = 200;
                const checkedTxsKey = `checked_txs_${publicKey}_${PROGRAM_ID}`;
                const checkedTxsRaw = localStorage.getItem(checkedTxsKey);
                const checkedTxs = new Set<string>(checkedTxsRaw ? JSON.parse(checkedTxsRaw) : []);
                let processedTxs = 0;
                const BATCH_SIZE = 10;
                const MAX_TXS_TO_PROCESS = 50; // Reduced for faster scan
                
                const startHeight = Math.max(1, currentHeight - OPTIMIZED_SCAN_DEPTH);
                const endHeight = currentHeight;
                const totalBlocks = endHeight - startHeight + 1;
                
                console.log(`🔍 Scanning last ${OPTIMIZED_SCAN_DEPTH} blocks (${startHeight} to ${endHeight})...`);
                setStatus(`Scanning ${totalBlocks} blocks...`);
                
                // Scan from NEWEST to OLDEST
                for (let h = endHeight; h >= startHeight && processedTxs < MAX_TXS_TO_PROCESS; h -= BATCH_SIZE) {
                    if (!isSyncingRef.current) break;
                    
                    // Update progress
                    const progress = Math.round(((endHeight - h) / totalBlocks) * 100);
                    setScanProgress(progress);
                    
                    const batchStart = Math.max(startHeight, h - BATCH_SIZE + 1);
                    setStatus(`Scanning blocks ${h} - ${batchStart}... (${progress}%)`);
                    
                    const batchPromises = [];
                    for (let i = 0; i < BATCH_SIZE && (h - i) >= startHeight; i++) {
                        batchPromises.push(
                            fetch(`${base}/block/${h - i}`)
                                .then(r => r.ok ? r.json() : null)
                                .catch(() => null)
                        );
                    }
                    
                    try {
                        const blocks = await Promise.all(batchPromises);
                        
                        for (const block of blocks) {
                            if (!block || processedTxs >= MAX_TXS_TO_PROCESS) break;
                            
                            const txs = block.transactions || [];
                            
                            for (const txWrapper of txs) {
                                if (processedTxs >= MAX_TXS_TO_PROCESS) break;
                                
                                const tx = txWrapper.transaction || txWrapper;
                                const txId = tx.id || tx.transaction_id || txWrapper.id;
                                
                                if (!txId || !txId.startsWith("at") || checkedTxs.has(txId)) continue;
                                
                                const execution = tx.execution;
                                if (execution?.transitions) {
                                    const hasOurProgram = execution.transitions.some(
                                        (t: any) => t.program === PROGRAM_ID && t.function === "send_message"
                                    );
                                    if (hasOurProgram) {
                                        processedTxs++;
                                        const result = await addMessagesFromTxId(txId, allMessagesMap);
                                        checkedTxs.add(txId);
                                        if (result === "added") {
                                            console.log(`✅ Found new message in ${txId}`);
                                        }
                                    }
                                }
                            }
                        }
                    } catch (batchError) {
                        console.warn("Batch scan error:", batchError);
                    }
                    
                    await new Promise<void>((resolve) => setTimeout(resolve, 50));
                }
                
                    // Save to cache
                    const existingCached = TxCache.get(publicKey);
                    const newCachedTxs = Array.from(allMessagesMap.values())
                        .filter(m => !existingCached.some(c => c.txId === m.id))
                        .map(msg => ({
                            txId: msg.id || "",
                            height: 0,
                            sender: msg.sender || "",
                            recipient: publicKey,
                            content: msg.content || "",
                            timestamp: (msg.timestamp || Date.now()) / 1000,
                            cachedAt: Date.now(),
                        }));
                    if (newCachedTxs.length > 0) {
                        TxCache.append(publicKey, newCachedTxs);
                    }
                    
                    // Save checked transactions
                    const allCheckedTxs = Array.from(checkedTxs).slice(-500);
                    localStorage.setItem(checkedTxsKey, JSON.stringify(allCheckedTxs));
                    
                    // Save last synced height
                    if (currentHeight > 0) {
                        const lastSyncedHeightKey = `last_synced_height_${publicKey}_${PROGRAM_ID}`;
                        localStorage.setItem(lastSyncedHeightKey, String(currentHeight));
                    }
                    
                    console.log(`📊 Block scan complete: processed ${processedTxs} transactions, found ${allMessagesMap.size} message(s)`);
                }
            }
            
            // ✅ STEP 4: Merge with existing messages

            // Step 5: Merge with existing messages
            console.log(`📊 Step 5: Merging messages - allMessagesMap has ${allMessagesMap.size} new message(s)`);
            if (allMessagesMap.size > 0) {
                console.log(`📨 New messages to merge:`);
                allMessagesMap.forEach((m, key) => {
                    console.log(`  - Key: "${key}", ID: "${m.id}", Type: "${m.type}", Sender: "${m.sender}", Content: "${m.content?.substring(0, 30)}..."`);
                });
            }
            
            // CRITICAL: Use functional update and ensure we merge correctly
            setMessages(prev => {
                console.log(`📊 Step 5a: Current messages in state: ${prev.length}`);
                console.log(`📊 Step 5b: allMessagesMap size: ${allMessagesMap.size}`);
                if (allMessagesMap.size > 0) {
                    console.log(`📊 Step 5c: allMessagesMap keys:`, Array.from(allMessagesMap.keys()));
                }
                
                const merged = new Map<string, InboxMessage>();
                
                // Add existing messages first - use ID as primary key (must match allMessagesMap key format)
                prev.forEach(m => {
                    // Use ID directly, same as allMessagesMap uses
                    const key = m.id;
                    if (key) {
                        // Fix: Ensure type is set for existing messages
                        if (!m.type && (m.content || m.decryptedContent || m.sender)) {
                            m.type = "received";
                        }
                        merged.set(key, m);
                    } else {
                        console.warn(`⚠️  Existing message without ID, skipping:`, m);
                    }
                });

                // Add/update with new messages - use ID from allMessagesMap key
                let addedCount = 0;
                let updatedCount = 0;
                allMessagesMap.forEach((m, mapKey) => {
                    // The mapKey IS the ID from addMessagesFromTxId - use it directly
                    // m.id should also be set to mapKey, but use mapKey as source of truth
                    const messageKey = mapKey; // Use mapKey directly - it's the ID
                    
                    if (!messageKey) {
                        console.warn(`⚠️  Skipping message without ID:`, m);
                        return;
                    }
                    
                    // Ensure m.id matches mapKey
                    if (m.id !== messageKey) {
                        console.warn(`⚠️  Message ID mismatch: m.id="${m.id}", mapKey="${messageKey}", fixing...`);
                        m.id = messageKey;
                    }
                    
                    // CRITICAL: Ensure type is set before adding
                    if (!m.type) {
                        m.type = "received";
                    }
                    
                    const existing = merged.get(messageKey);
                    if (!existing) {
                        merged.set(messageKey, m);
                        addedCount++;
                        console.log(`✅ Added NEW message: key="${messageKey}", id="${m.id}", type="${m.type}", sender="${m.sender}", content="${m.content?.substring(0, 20)}..."`);
                    } else {
                        // Update existing with new data (prefer new data)
                        const updated = { ...existing, ...m, id: messageKey };
                        if (!updated.type) {
                            updated.type = "received";
                        }
                        merged.set(messageKey, updated);
                        updatedCount++;
                        console.log(`🔄 Updated existing message: key="${messageKey}"`);
                    }
                });
                
                const finalMessages = Array.from(merged.values());
                console.log(`✅ Merge complete: ${finalMessages.length} total messages (${addedCount} new, ${updatedCount} updated)`);
                console.log(`📋 Final message IDs (first 10):`, finalMessages.slice(0, 10).map(m => ({ 
                    id: m.id?.substring(0, 30), 
                    type: m.type,
                    sender: m.sender?.substring(0, 20),
                    hasContent: !!(m.content || m.decryptedContent)
                })));
                
                // Verify new messages are in final array
                const newMessageIds = Array.from(allMessagesMap.keys());
                const foundInFinal = newMessageIds.filter(id => finalMessages.some(m => m.id === id));
                console.log(`🔍 Verification: ${foundInFinal.length}/${newMessageIds.length} new messages in final array`);
                if (foundInFinal.length < newMessageIds.length) {
                    console.error(`❌ CRITICAL: Some new messages missing from final array!`);
                    const missing = newMessageIds.filter(id => !finalMessages.some(m => m.id === id));
                    console.error(`Missing IDs:`, missing);
                }
                
                // CRITICAL: Ensure all messages have type="received" before returning
                finalMessages.forEach(m => {
                    if (!m.type && (m.content || m.decryptedContent || m.sender)) {
                        m.type = "received";
                    }
                });
                
                // Force a new array reference to ensure React detects the change
                const result = [...finalMessages];
                
                // Log new messages specifically
                if (allMessagesMap.size > 0) {
                    const newMessageIds = Array.from(allMessagesMap.keys());
                    const newMessagesInResult = result.filter(m => {
                        if (!m.id) return false;
                        return newMessageIds.includes(m.id);
                    });
                    console.log(`📊 Returning ${result.length} messages to state (${newMessagesInResult.length} new messages included)`);
                    if (newMessagesInResult.length > 0) {
                        console.log(`✅ New messages in result:`, newMessagesInResult.map(m => ({
                            id: m.id?.substring(0, 30),
                            type: m.type,
                            sender: m.sender?.substring(0, 20),
                            hasContent: !!(m.content || m.decryptedContent)
                        })));
                    }
                } else {
                    console.log(`📊 Returning ${result.length} messages to state`);
                }
                
                return result;
            });
            
            // Wait a bit to ensure state update is processed
            await new Promise(resolve => setTimeout(resolve, 100));
            
            console.log(`📊 Step 6: Updating status...`);
            const newCount = allMessagesMap.size;
            if (newCount > 0) {
                setStatus(`Sync Complete! Found ${newCount} new message(s) from blockchain.`);
            } else {
                setStatus("Sync Complete. No new messages found on blockchain.");
            }

            setLastSyncTime(new Date());
            console.log(`✅ Sync function completed successfully`);
            
            // Final verification - check if messages are in state
            setTimeout(() => {
                setMessages(current => {
                    console.log(`🔍 FINAL CHECK: ${current.length} messages in state after sync`);
                    const newMessageIds = Array.from(allMessagesMap.keys());
                    const foundNew = newMessageIds.filter(id => current.some(m => m.id === id));
                    console.log(`🔍 Found ${foundNew.length}/${newMessageIds.length} new messages in state`);
                    if (foundNew.length < newMessageIds.length) {
                        console.error(`❌ PROBLEM: Some new messages are missing from state!`);
                        console.error(`Missing IDs:`, newMessageIds.filter(id => !current.some(m => m.id === id)));
                    } else if (foundNew.length > 0) {
                        console.log(`✅ SUCCESS: All ${foundNew.length} new messages are in state!`);
                        // Log first few new messages to verify they're correct
                        const newMessages = current.filter(m => {
                            if (!m.id) return false;
                            return newMessageIds.includes(m.id);
                        });
                        console.log(`📋 New messages in state:`, newMessages.slice(0, 3).map(m => ({
                            id: m.id?.substring(0, 20),
                            type: m.type,
                            sender: m.sender?.substring(0, 20),
                            hasContent: !!m.content
                        })));
                    }
                    return current;
                });
            }, 1000);

        } catch (error) {
            console.error("❌ Sync failed:", error);
            setStatus("Sync failed. See console.");
        } finally {
            console.log(`🔄 Sync finished - cleaning up...`);
            setIsSyncing(false);
            isSyncingRef.current = false;
            console.log(`✅ Sync cleanup complete`);
        }
    }, [publicKey, network, adapter, fetchRecords]);
    
    // Auto-sync removed per user request

    const forceRefresh = useCallback(async () => {
        if (!publicKey) return;
        console.log("🔄 Force refresh - clearing cache...");
        TxCache.clear(publicKey);
        setScanProgress(0);
        await getInboxMessages();
    }, [publicKey, getInboxMessages]);

    const handleImportTx = async () => {
        const txId = importTxId.trim();
        if (!publicKey) return alert("Connect wallet first");
        
        // Support both transaction ID (at1...) and transition ID (au1...)
        if (!/^(at|au)[0-9a-z]+$/i.test(txId)) {
            return alert("Invalid transaction/transition ID (expected at... or au...)");
        }

        setStatus("Importing transaction/transition...");
        const map = new Map<string, InboxMessage>();
        const result = await addMessagesFromTxId(txId, map);

        if (result === "no_access") {
            setStatus("Wallet decrypt is not available.");
            return;
        }

        if (result !== "added" || map.size === 0) {
            setStatus("No messages found for this account in this transaction/transition.");
            return;
        }

        setMessages((prev) => {
            const merged = new Map<string, InboxMessage>();
            prev.forEach((m) => merged.set(m.id || m.content + (m.sender || ""), m));
            map.forEach((m, key) => merged.set(key, m));
            return Array.from(merged.values());
        });
        setImportTxId("");
        setStatus(`Imported ${map.size} message(s).`);
    };




    const renderStatusLinks = () => {
        return null;
    };

    return (
        <div style={{ padding: "20px" }}>

            <div className="section-block">
                <h3>Your Profile</h3>
                {fetchedProfile ? (
                    <div style={{ marginBottom: "15px" }}>
                        <p style={{ margin: "5px 0" }}><strong>Name:</strong> {fetchedProfile.name}</p>
                        <p style={{ margin: "5px 0" }}><strong>Bio:</strong> {fetchedProfile.bio}</p>
                    </div>
                ) : (
                    <p>No profile found locally.</p>
                )}

                {!isEditingProfile ? (
                    <button onClick={() => setIsEditingProfile(true)}>
                        Create/Update Profile
                    </button>
                ) : (
                    <div style={{ marginTop: "15px", borderTop: "2px dashed #ccc", paddingTop: "15px" }}>
                        <label>Enter New Details:</label>
                        <input
                            placeholder="Name"
                            value={profileName}
                            onChange={e => setProfileName(e.target.value)}
                        />
                        <input
                            placeholder="Bio"
                            value={profileBio}
                            onChange={e => setProfileBio(e.target.value)}
                        />
                        <div style={{ display: "flex", gap: "10px" }}>
                            <button onClick={async () => { await handleCreateProfile(); setIsEditingProfile(false); }}>
                                Save Profile
                            </button>
                            <button onClick={() => setIsEditingProfile(false)} style={{ background: "#eee" }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="section-block">
                <h3>Send Message</h3>
                <label>Recipient:</label>
                <input
                    placeholder="Recipient Address (aleo1...)"
                    value={recipient}
                    onChange={e => setRecipient(e.target.value)}
                />
                <label>Message:</label>
                <textarea
                    placeholder="Type your message..."
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    style={{
                        width: "100%",
                        height: "100px",
                        display: "block",
                        marginBottom: "15px",
                        padding: "12px",
                        background: "#fff",
                        color: "#000",
                        border: "2px solid #000",
                        fontFamily: "Space Mono, monospace",
                        fontSize: "1rem",
                        boxSizing: "border-box"
                    }}
                />
                <button onClick={sendMessage}>Send Message</button>
            </div>



            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "20px" }}>
                <div className="section-block">
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "15px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h2 className="section-title" style={{ margin: 0 }}>INBOX</h2>
                            <div style={{ fontSize: "0.8em", color: "#666" }}>
                                {lastSyncTime ? lastSyncTime.toLocaleTimeString() : "Never"}
                            </div>
                        </div>

                        <PermissionAlert 
                            hasPermission={hasPermission} 
                            onReconnect={() => {
                                disconnect();
                                // autoConnect will handle reconnection
                                setTimeout(() => {
                                    if (wallet?.adapter) {
                                        wallet.adapter.connect(DecryptPermission.OnChainHistory, network, [PROGRAM_ID]).catch(console.error);
                                    }
                                }, 100);
                            }} 
                        />

                        {isSyncing && scanProgress > 0 && (
                            <div style={{ 
                                padding: "8px", 
                                backgroundColor: "#e3f2fd", 
                                borderRadius: "4px",
                                fontSize: "0.9em"
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                                    <span>Scanning blocks...</span>
                                    <span>{scanProgress}%</span>
                                </div>
                                <div style={{ 
                                    width: "100%", 
                                    height: "6px", 
                                    backgroundColor: "#ddd", 
                                    borderRadius: "3px",
                                    overflow: "hidden"
                                }}>
                                    <div style={{ 
                                        width: `${scanProgress}%`, 
                                        height: "100%", 
                                        backgroundColor: "#2196f3",
                                        transition: "width 0.3s ease"
                                    }}></div>
                                </div>
                            </div>
                        )}

                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <input
                                placeholder="Paste txId (at...) or transition (au...)"
                                value={importTxId}
                                onChange={(e) => setImportTxId(e.target.value)}
                                style={{
                                    flex: 1,
                                    padding: "8px",
                                    fontSize: "12px",
                                    border: "2px solid #000",
                                    background: "#fff",
                                    minWidth: 0
                                }}
                            />
                            <button
                                onClick={handleImportTx}
                                disabled={!importTxId || isSyncing}
                                style={{
                                    whiteSpace: "nowrap",
                                    padding: "8px 12px",
                                    background: !importTxId || isSyncing ? "#ccc" : "#fff",
                                    color: "#000",
                                    border: "2px solid #000",
                                    cursor: !importTxId || isSyncing ? "not-allowed" : "pointer",
                                    fontSize: "11px",
                                }}
                            >
                                IMPORT
                            </button>
                            <button
                                onClick={async () => {
                                    console.log("🔄 User clicked SYNC button - fetching from wallet...");
                                    await getInboxMessages();
                                }}
                                disabled={isSyncing}
                                style={{
                                    whiteSpace: "nowrap",
                                    padding: "8px 16px",
                                    background: isSyncing ? "#ccc" : "#000",
                                    color: "#fff",
                                    border: "2px solid #000",
                                    cursor: isSyncing ? "not-allowed" : "pointer"
                                }}
                                title="Sync messages from wallet"
                            >
                                {isSyncing ? "SYNCING..." : "SYNC"}
                            </button>
                            <button
                                onClick={forceRefresh}
                                disabled={isSyncing}
                                style={{
                                    whiteSpace: "nowrap",
                                    padding: "8px 12px",
                                    background: isSyncing ? "#ccc" : "#fff",
                                    color: "#000",
                                    border: "2px solid #000",
                                    cursor: isSyncing ? "not-allowed" : "pointer",
                                    fontSize: "11px"
                                }}
                                title="Force refresh (clear cache and rescan)"
                            >
                                🔄 Force
                            </button>
                        </div>
                    </div>

                    {messages.length > 0 ? (
                        <ul className="inbox-list fade-in">
                            {[...messages]
                                .filter(m => {
                                    // Fix: Ensure type is set for old messages from localStorage
                                    if (!m.type && (m.content || m.decryptedContent || m.sender)) {
                                        m.type = "received";
                                    }
                                    
                                    // Only show received messages in inbox
                                    if (m.type === "sent") return false;
                                    
                                    // Ensure message has content
                                    if (!m.content && !m.decryptedContent) return false;
                                    
                                    // Ensure message has type
                                    if (!m.type || m.type !== "received") return false;
                                    
                                    return true;
                                })
                                .reverse()
                                .map((m, idx) => {
                                    return (
                                        <li key={m.id || idx} className="list-item">
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8em", color: "#666", marginBottom: "5px" }}>
                                                <span><strong>{m.type === "sent" ? "To:" : "From:"}</strong> {m.sender ? (m.sender.length > 20 ? m.sender.slice(0, 6) + "..." + m.sender.slice(-6) : m.sender.replace(/\.private$/, "")) : "Unknown"}</span>
                                                {m.id && (
                                                    <span style={{ fontSize: "0.8em", color: "#999" }}>{m.id.slice(0, 6) + "..."}</span>
                                                )}
                                            </div>

                                            <div style={{ marginTop: "5px", padding: "10px", background: "#f1f8e9", borderLeft: "4px solid #4caf50", borderRadius: "4px" }}>
                                                <strong>Message:</strong><br />
                                                <span style={{ fontSize: "1.1em" }}>{parseMessageContent(m.content || m.decryptedContent || "")}</span>
                                            </div>
                                        </li>
                                    );
                                })}
                        </ul>
                    ) : (
                        <p>No messages found or not synced.</p>
                    )}
                </div>

                <div className="section-block">
                    <h3>📤 Sent History</h3>
                    {sentHistory.length > 0 ? (
                        <ul className="history-list fade-in">
                            {sentHistory.map((item, idx) => (
                                <li key={idx} className="list-item">
                                    <strong>{item.type}</strong> <br />
                                    <span style={{ fontSize: "0.8em", color: "#666" }}>
                                        {new Date(item.timestamp).toLocaleTimeString()}
                                    </span><br />
                                    To: {item.recipient ? item.recipient.slice(0, 6) + "..." : "System"} <br />

                                    {(item.txId.startsWith("at1") || item.txId.startsWith("au1")) ? (
                                        <>
                                            TxID: {item.txId.startsWith("at1") ? item.txId.slice(0, 10) + "..." : item.txId} <br />
                                            <div style={{ marginTop: "5px" }}>
                                                <a href={`https://testnet.aleoscan.io/${item.txId.startsWith("au1") ? "transition" : "transaction"}?id=${item.txId}`} target="_blank" rel="noreferrer" style={{ fontSize: "0.8em", marginRight: "10px" }}>
                                                    [AleoScan]
                                                </a>
                                                <a href={`https://testnet.explorer.provable.com/transaction/${item.txId}`} target="_blank" rel="noreferrer" style={{ fontSize: "0.8em" }}>
                                                    [Provable]
                                                </a>
                                            </div>
                                        </>
                                    ) : (
                                        (item.status === "Success") ? (
                                            <div style={{ fontSize: "0.8em", color: "green", marginTop: "5px" }}>
                                                ✅ Mined (Task ID: {item.txId.slice(0, 8)}...)<br />
                                                <span style={{ fontSize: "0.7em", color: "#666" }}>ID not returned by wallet yet.</span><br />
                                                <div style={{ marginTop: "5px" }}>
                                                    <span style={{ fontSize: "0.8em", color: "#555" }}>Find in Activity:</span><br />
                                                    <a href={`https://testnet.aleoscan.io/address?a=${publicKey}`} target="_blank" rel="noreferrer" style={{ fontSize: "0.8em", marginRight: "10px", textDecoration: "underline" }}>
                                                        [AleoScan]
                                                    </a>
                                                    <a href={`https://testnet.explorer.provable.com/address/${publicKey}`} target="_blank" rel="noreferrer" style={{ fontSize: "0.8em", textDecoration: "underline" }}>
                                                        [Provable]
                                                    </a>
                                                </div>
                                            </div>
                                        ) : (item.status === "Unknown") ? (
                                            <div style={{ fontSize: "0.8em", color: "#666", marginTop: "5px" }}>
                                                ❓ Status Unknown<br />
                                                <span style={{ fontSize: "0.7em", color: "#999" }}>Wallet stopped tracking this task.</span><br />
                                                <div style={{ marginTop: "5px" }}>
                                                    <a href={`https://testnet.aleoscan.io/address?a=${publicKey}`} target="_blank" rel="noreferrer" style={{ fontSize: "0.8em", marginRight: "10px", textDecoration: "underline" }}>
                                                        [Check AleoScan]
                                                    </a>
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ fontSize: "0.8em", color: "#d32f2f" }}>
                                                ⏳ Request Pending (Task ID)<br />
                                                <span style={{ color: "#999", fontSize: "0.8em" }}>ID: {item.txId.slice(0, 8)}...</span><br />
                                                <span className="loader" style={{ width: "10px", height: "10px", borderTopColor: "#d32f2f", margin: "5px 0" }}></span>
                                                Waiting for blockchain... <br />

                                                {/* Manual Recovery Option */}
                                                <a href={`https://testnet.aleoscan.io/address?a=${publicKey}`} target="_blank" rel="noreferrer" style={{ color: "#555", textDecoration: "underline", fontSize: "0.9em", marginTop: "5px", display: "inline-block" }}>
                                                    Check Explorer for Updates
                                                </a>
                                            </div>
                                        )
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p>No sent messages yet.</p>
                    )}
                </div>
            </div >

            <div className="status-box">
                <p style={{ fontWeight: "bold", background: "#000", color: "#fff", display: "inline-block", padding: "2px 5px" }}>
                    Status: {status}
                    {(status.includes("Signing") || status.includes("Initiated") || status.includes("Processing")) && <span className="loader" style={{ marginLeft: "10px", borderTopColor: "#fff", width: "12px", height: "12px" }}></span>}
                </p>
                {renderStatusLinks()}
            </div>


        </div >
    );
};

function App() {
    const network = WalletAdapterNetwork.TestnetBeta;

    const wallets = useMemo(
        () => [
            new LeoWalletAdapter({
                appName: "Ghost",
            }),
            new PuzzleWalletAdapter({
                appName: "Ghost",
                programIdPermissions: {
                    [WalletAdapterNetwork.TestnetBeta]: [PROGRAM_ID],
                    [WalletAdapterNetwork.MainnetBeta]: [PROGRAM_ID]
                }
            }),
        ],
        []
    );

    return (
        <WalletProvider
            wallets={wallets}
            decryptPermission={DecryptPermission.OnChainHistory}
            network={network}
            programs={[PROGRAM_ID]}
            autoConnect
        >
            <div className="App">
                <Header programId={PROGRAM_ID} />

                <MessengerUI network={network} />
            </div>
        </WalletProvider>
    );
}

export default App;
