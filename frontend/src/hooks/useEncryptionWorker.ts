import { useRef, useEffect, useCallback } from 'react';

type WorkerMessage =
  | { type: 'ENCRYPT_SUCCESS'; id: string; result: string }
  | { type: 'DECRYPT_SUCCESS'; id: string; result: string }
  | { type: 'ERROR'; id: string; error: string };

export function useEncryptionWorker() {
  const workerRef = useRef<Worker | null>(null);
  const resolversRef = useRef<Map<string, (value: string) => void>>(new Map());
  const rejectorsRef = useRef<Map<string, (reason: unknown) => void>>(new Map());
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const worker = new Worker(new URL('../workers/encryption.worker.ts', import.meta.url), {
      type: 'module'
    });

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const { type, id } = e.data;

      // Clear timeout for this id
      const timer = timeoutsRef.current.get(id);
      if (timer) { clearTimeout(timer); timeoutsRef.current.delete(id); }

      if (type === 'ENCRYPT_SUCCESS' || type === 'DECRYPT_SUCCESS') {
        const resolve = resolversRef.current.get(id);
        if (resolve) {
          resolve(e.data.result);
          resolversRef.current.delete(id);
          rejectorsRef.current.delete(id);
        }
      } else if (type === 'ERROR') {
        const reject = rejectorsRef.current.get(id);
        if (reject) {
          reject(new Error(e.data.error));
          resolversRef.current.delete(id);
          rejectorsRef.current.delete(id);
        }
      }
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      // Clear all pending timeouts on unmount
      timeoutsRef.current.forEach(t => clearTimeout(t));
      timeoutsRef.current.clear();
      resolversRef.current.clear();
      rejectorsRef.current.clear();
    };
  }, []);

  const WORKER_TIMEOUT = 10_000; // 10s

  const sendToWorker = useCallback((msg: Record<string, unknown>): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) return reject(new Error("Worker not ready"));
      const id = Math.random().toString(36).substring(7);
      resolversRef.current.set(id, resolve);
      rejectorsRef.current.set(id, reject);
      workerRef.current.postMessage({ ...msg, id });
      const timer = setTimeout(() => {
        if (resolversRef.current.has(id)) {
          resolversRef.current.delete(id);
          rejectorsRef.current.delete(id);
          timeoutsRef.current.delete(id);
          reject(new Error("Worker timeout"));
        }
      }, WORKER_TIMEOUT);
      timeoutsRef.current.set(id, timer);
    });
  }, []);

  const encrypt = useCallback((text: string, recipientPublicKey: string, senderSecretKey: string): Promise<string> => {
    return sendToWorker({ type: 'ENCRYPT', text, recipientPublicKey, senderSecretKey });
  }, [sendToWorker]);

  const decrypt = useCallback((payload: string, senderPublicKey: string, recipientSecretKey: string): Promise<string> => {
    return sendToWorker({ type: 'DECRYPT', payload, senderPublicKey, recipientSecretKey });
  }, [sendToWorker]);

  const decryptAsSender = useCallback((payload: string, recipientPublicKey: string, senderSecretKey: string): Promise<string> => {
    return sendToWorker({ type: 'DECRYPT_AS_SENDER', payload, recipientPublicKey, senderSecretKey });
  }, [sendToWorker]);

  return { encrypt, decrypt, decryptAsSender };
}
