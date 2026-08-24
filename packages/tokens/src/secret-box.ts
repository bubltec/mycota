import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SecretBox } from './ports.js';

/**
 * AES-256-GCM. Ciphertext is iv (12) + tag (16) + ciphertext. The consuming
 * app supplies the 32-byte key from SSM — this package does not read env.
 */
export class AesGcmSecretBox implements SecretBox {
  constructor(private readonly key: Uint8Array) {
    if (key.byteLength !== 32) throw new Error('AES-256-GCM key must be 32 bytes');
  }

  async seal(plaintext: Uint8Array): Promise<Uint8Array> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
  }

  async open(ciphertext: Uint8Array): Promise<Uint8Array> {
    const buf = Buffer.from(ciphertext);
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}

/** Identity box for tests. Not for production. */
export class PlainSecretBox implements SecretBox {
  async seal(plaintext: Uint8Array): Promise<Uint8Array> {
    return plaintext;
  }

  async open(ciphertext: Uint8Array): Promise<Uint8Array> {
    return ciphertext;
  }
}
