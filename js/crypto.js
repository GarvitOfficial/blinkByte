// Browser-native Cryptography utilizing Web Crypto API

/**
 * Derives an AES-GCM key from a passphrase and a salt using PBKDF2.
 * @param {string} passphrase - The user password.
 * @param {Uint8Array} salt - The salt bytes.
 * @returns {Promise<CryptoKey>} The derived AES key.
 */
async function deriveKey(passphrase, salt) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error("Cryptographic operations (encryption/decryption) are only supported in secure contexts (HTTPS or localhost).");
  }
  const encoder = new TextEncoder();
  const rawKey = encoder.encode(passphrase);

  // Import the raw passphrase as a key base
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  // Derive the 256-bit AES-GCM key
  return await window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a payload using AES-256-GCM and a passphrase.
 * @param {Uint8Array} data - Plain text data to encrypt.
 * @param {string} passphrase - Password for encryption.
 * @returns {Promise<{salt: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array}>}
 */
export async function encryptPayload(data, passphrase) {
  try {
    // Generate secure random salt (16 bytes) and IV (12 bytes)
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const key = await deriveKey(passphrase, salt);

    const encryptedBuffer = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
        tagLength: 128
      },
      key,
      data
    );

    return {
      salt,
      iv,
      ciphertext: new Uint8Array(encryptedBuffer)
    };
  } catch (error) {
    console.error("Encryption failed:", error);
    throw error;
  }
}

/**
 * Decrypts an AES-256-GCM ciphertext using the given passphrase, salt, and IV.
 * @param {Uint8Array} ciphertext - Encrypted bytes.
 * @param {string} passphrase - Decryption passphrase.
 * @param {Uint8Array} salt - Key derivation salt.
 * @param {Uint8Array} iv - AES initialization vector.
 * @returns {Promise<Uint8Array>} Decrypted plain bytes.
 */
export async function decryptPayload(ciphertext, passphrase, salt, iv) {
  try {
    const key = await deriveKey(passphrase, salt);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
        tagLength: 128
      },
      key,
      ciphertext
    );

    return new Uint8Array(decryptedBuffer);
  } catch (error) {
    console.error("Decryption failed:", error);
    throw error;
  }
}
