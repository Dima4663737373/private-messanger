/* eslint-disable no-restricted-globals */
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';

// Worker Message Types
type WorkerMessage = 
  | { type: 'ENCRYPT'; id: string; text: string; recipientPublicKey: string; senderSecretKey: string }
  | { type: 'DECRYPT'; id: string; payload: string; senderPublicKey: string; recipientSecretKey: string }
  | { type: 'DECRYPT_AS_SENDER'; id: string; payload: string; recipientPublicKey: string; senderSecretKey: string };

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, id } = e.data;

  try {
    if (type === 'ENCRYPT') {
      const { text, recipientPublicKey, senderSecretKey } = e.data;
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      // @ts-ignore - tweetnacl-util type definitions are incorrect
      const msgBytes = encodeUTF8(text) as unknown as Uint8Array;
      const pk = decodeBase64(recipientPublicKey);
      const sk = decodeBase64(senderSecretKey);

      const encrypted = nacl.box(msgBytes as Uint8Array, nonce, pk, sk);
      const result = `${encodeBase64(nonce)}.${encodeBase64(encrypted)}`;
      
      self.postMessage({ type: 'ENCRYPT_SUCCESS', id, result });
    }
    else if (type === 'DECRYPT') {
      const { payload, senderPublicKey, recipientSecretKey } = e.data;
      const [nonceB64, ciphertextB64] = payload.split('.');
      
      if (!nonceB64 || !ciphertextB64) throw new Error("Invalid payload format");

      const nonce = decodeBase64(nonceB64);
      const ciphertext = decodeBase64(ciphertextB64);
      const pk = decodeBase64(senderPublicKey);
      const sk = decodeBase64(recipientSecretKey);

      const decrypted = nacl.box.open(ciphertext, nonce, pk, sk);
      if (!decrypted) throw new Error("Decryption returned null");

      const text = decodeUTF8(decrypted as unknown as string) as unknown as string;
      self.postMessage({ type: 'DECRYPT_SUCCESS', id, result: text });
    }
    else if (type === 'DECRYPT_AS_SENDER') {
      const { payload, recipientPublicKey, senderSecretKey } = e.data;
      const [nonceB64, ciphertextB64] = payload.split('.');
      
      if (!nonceB64 || !ciphertextB64) throw new Error("Invalid payload format");

      const nonce = decodeBase64(nonceB64);
      const ciphertext = decodeBase64(ciphertextB64);
      const pk = decodeBase64(recipientPublicKey);
      const sk = decodeBase64(senderSecretKey);

      const sharedKey = nacl.box.before(pk, sk);
      const decrypted = nacl.box.open.after(ciphertext, nonce, sharedKey);

      if (!decrypted) throw new Error("Decryption returned null");

      const text = decodeUTF8(decrypted as unknown as string) as unknown as string;
      self.postMessage({ type: 'DECRYPT_SUCCESS', id, result: text });
    }
  } catch (error: any) {
    self.postMessage({ type: 'ERROR', id, error: error.message });
  }
};
