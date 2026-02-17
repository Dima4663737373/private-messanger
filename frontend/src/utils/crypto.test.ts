import { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  validateKeyPair,
  encryptMessage,
  decryptMessage,
  decryptMessageAsSender,
  generateRoomKey,
  encryptRoomMessage,
  decryptRoomMessage,
  encryptKeysWithPassphrase,
  decryptKeysWithPassphrase,
} from './crypto';

describe('generateKeyPair', () => {
  it('generates valid keypair', () => {
    const keys = generateKeyPair();
    expect(keys.publicKey).toBeTruthy();
    expect(keys.secretKey).toBeTruthy();
    // base64 encoded 32 bytes = 44 chars
    expect(keys.publicKey.length).toBe(44);
    expect(keys.secretKey.length).toBe(44);
  });

  it('generates unique keypairs', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.secretKey).not.toBe(b.secretKey);
  });
});

describe('validateKeyPair', () => {
  it('validates a good keypair', () => {
    const keys = generateKeyPair();
    const result = validateKeyPair(keys);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects missing keys', () => {
    const result = validateKeyPair({ publicKey: '', secretKey: '' });
    expect(result.valid).toBe(false);
  });

  it('rejects mismatched keys', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const result = validateKeyPair({ publicKey: a.publicKey, secretKey: b.secretKey });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('does not match');
  });
});

describe('encryptMessage / decryptMessage', () => {
  it('encrypts and decrypts a message', () => {
    const sender = generateKeyPair();
    const recipient = generateKeyPair();

    const plaintext = 'Hello, Ghost!';
    const encrypted = encryptMessage(plaintext, recipient.publicKey, sender.secretKey);

    // Should be nonce.ciphertext format
    expect(encrypted).toContain('.');
    expect(encrypted).not.toBe(plaintext);

    const decrypted = decryptMessage(encrypted, sender.publicKey, recipient.secretKey);
    expect(decrypted).toBe(plaintext);
  });

  it('fails with wrong key', () => {
    const sender = generateKeyPair();
    const recipient = generateKeyPair();
    const wrong = generateKeyPair();

    const encrypted = encryptMessage('secret', recipient.publicKey, sender.secretKey);
    const decrypted = decryptMessage(encrypted, wrong.publicKey, recipient.secretKey);
    expect(decrypted).toBeNull();
  });
});

describe('decryptMessageAsSender', () => {
  it('sender can decrypt their own message', () => {
    const sender = generateKeyPair();
    const recipient = generateKeyPair();

    const plaintext = 'Self-readable message';
    const encrypted = encryptMessage(plaintext, recipient.publicKey, sender.secretKey);

    const decrypted = decryptMessageAsSender(encrypted, recipient.publicKey, sender.secretKey);
    expect(decrypted).toBe(plaintext);
  });
});

describe('room encryption', () => {
  it('encrypts and decrypts room messages', () => {
    const roomKey = generateRoomKey();
    const plaintext = 'Room message!';

    const encrypted = encryptRoomMessage(plaintext, roomKey);
    expect(encrypted).toContain('.');
    expect(encrypted).not.toBe(plaintext);

    const decrypted = decryptRoomMessage(encrypted, roomKey);
    expect(decrypted).toBe(plaintext);
  });

  it('fails with wrong room key', () => {
    const roomKey1 = generateRoomKey();
    const roomKey2 = generateRoomKey();

    const encrypted = encryptRoomMessage('secret', roomKey1);
    const decrypted = decryptRoomMessage(encrypted, roomKey2);
    expect(decrypted).toBeNull();
  });
});

describe('key backup with passphrase', () => {
  it('encrypts and decrypts keys with correct passphrase', async () => {
    const keys = generateKeyPair();
    const passphrase = 'my-secure-passphrase-123';

    const backup = await encryptKeysWithPassphrase(keys, passphrase);
    expect(backup.encrypted).toBeTruthy();
    expect(backup.nonce).toBeTruthy();
    expect(backup.salt).toBeTruthy();

    const restored = await decryptKeysWithPassphrase(
      backup.encrypted,
      backup.nonce,
      backup.salt,
      passphrase
    );
    expect(restored).not.toBeNull();
    expect(restored!.publicKey).toBe(keys.publicKey);
    expect(restored!.secretKey).toBe(keys.secretKey);
  });

  it('returns null with wrong passphrase', async () => {
    const keys = generateKeyPair();
    const backup = await encryptKeysWithPassphrase(keys, 'correct-pass');

    const restored = await decryptKeysWithPassphrase(
      backup.encrypted,
      backup.nonce,
      backup.salt,
      'wrong-pass'
    );
    expect(restored).toBeNull();
  });
});
