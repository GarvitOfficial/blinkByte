// BlinkByte Protocol & Frame Serialization Logic
import { compressData, decompressData } from './compress.js';
import { encryptPayload, decryptPayload } from './crypto.js';
import { ReedSolomon } from './rs.js';

// Precompute CRC32 Table
const CRC32_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  CRC32_TABLE[i] = c;
}

/**
 * Calculates CRC32 checksum for a Uint8Array.
 * @param {Uint8Array} bytes - Input bytes.
 * @returns {number} 32-bit unsigned CRC32 value.
 */
export function crc32(bytes) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

// Helpers for reading/writing binary values in Big Endian
function writeU16(arr, offset, val) {
  arr[offset] = (val >>> 8) & 0xFF;
  arr[offset + 1] = val & 0xFF;
}

function readU16(arr, offset) {
  return (arr[offset] << 8) | arr[offset + 1];
}

function writeU32(arr, offset, val) {
  arr[offset] = (val >>> 24) & 0xFF;
  arr[offset + 1] = (val >>> 16) & 0xFF;
  arr[offset + 2] = (val >>> 8) & 0xFF;
  arr[offset + 3] = val & 0xFF;
}

function readU32(arr, offset) {
  return ((arr[offset] << 24) >>> 0) | (arr[offset + 1] << 16) | (arr[offset + 2] << 8) | arr[offset + 3];
}

export class Frame {
  /**
   * @param {number} type - 1 = Metadata, 2 = Data, 3 = Parity
   * @param {number} sessionId - 32-bit Session ID
   * @param {number} seqNum - 16-bit Sequence Number
   * @param {number} totalFrames - 16-bit Total Frame Count
   * @param {Uint8Array} payload - Payload byte array
   */
  constructor(type, sessionId, seqNum, totalFrames, payload) {
    this.type = type;
    this.sessionId = sessionId;
    this.seqNum = seqNum;
    this.totalFrames = totalFrames;
    this.payload = payload;
  }

  /**
   * Serializes the frame to a binary Uint8Array.
   * Format:
   * [0..1]   Magic Bytes (0xBB, 0xFB)
   * [2]      Frame Type (1, 2, 3)
   * [3..6]   Session ID (U32)
   * [7..8]   Sequence Number (U16)
   * [9..10]  Total Frames (U16)
   * [11..12] Payload Length (U16)
   * [13..]   Payload (Variable)
   * [...+4]  CRC32 Checksum (U32)
   * @returns {Uint8Array} Serialized bytes.
   */
  serialize() {
    const headerLen = 13;
    const totalLen = headerLen + this.payload.length + 4;
    const arr = new Uint8Array(totalLen);

    arr[0] = 0xBB;
    arr[1] = 0xFB;
    arr[2] = this.type;
    writeU32(arr, 3, this.sessionId);
    writeU16(arr, 7, this.seqNum);
    writeU16(arr, 9, this.totalFrames);
    writeU16(arr, 11, this.payload.length);
    arr.set(this.payload, headerLen);

    const crc = crc32(arr.subarray(0, headerLen + this.payload.length));
    writeU32(arr, headerLen + this.payload.length, crc);

    return arr;
  }

  /**
   * Deserializes a binary Uint8Array back into a Frame.
   * Performs magic check, length validations, and CRC32 verification.
   * @param {Uint8Array} arr - Serialized bytes.
   * @returns {Frame}
   */
  static deserialize(arr) {
    if (arr.length < 17) {
      throw new Error("Frame too short");
    }
    if (arr[0] !== 0xBB || arr[1] !== 0xFB) {
      throw new Error("Invalid magic bytes");
    }
    const type = arr[2];
    const sessionId = readU32(arr, 3);
    const seqNum = readU16(arr, 7);
    const totalFrames = readU16(arr, 9);
    const payloadLen = readU16(arr, 11);

    if (arr.length !== 13 + payloadLen + 4) {
      throw new Error(`Frame length mismatch: expected ${13 + payloadLen + 4}, got ${arr.length}`);
    }

    const expectedCrc = readU32(arr, 13 + payloadLen);
    const actualCrc = crc32(arr.subarray(0, 13 + payloadLen));
    if (expectedCrc !== actualCrc) {
      throw new Error("CRC32 integrity check failed");
    }

    const payload = arr.subarray(13, 13 + payloadLen);
    return new Frame(type, sessionId, seqNum, totalFrames, payload);
  }
}

/**
 * Packs input data into an array of binary frames.
 * @param {Uint8Array} fileBytes - Input file/text data.
 * @param {string} fileName - File name.
 * @param {string} mimeType - File MIME type.
 * @param {object} options - Configuration options.
 * @returns {Promise<{sessionId: number, metadata: object, frames: Uint8Array[]}>}
 */
export async function createSendSession(fileBytes, fileName, mimeType, options = {}) {
  const {
    chunkSize = 256,
    passphrase = "",
    redundancyRatio = 0.3
  } = options;

  const sessionId = Math.floor(Math.random() * 0x7FFFFFFF); // positive 32-bit int

  // 1. Compress
  let processedData = await compressData(fileBytes, 'gzip');

  // 2. Encrypt (Optional)
  let encrypted = false;
  let saltBase64 = "";
  let ivBase64 = "";
  if (passphrase) {
    const encResult = await encryptPayload(processedData, passphrase);
    processedData = encResult.ciphertext;
    encrypted = true;
    saltBase64 = btoa(String.fromCharCode(...encResult.salt));
    ivBase64 = btoa(String.fromCharCode(...encResult.iv));
  }

  // 3. E2E Integrity Check (SHA-256 fallback to CRC32 in insecure contexts)
  let fileHashHex = "";
  if (window.crypto && window.crypto.subtle) {
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", fileBytes);
    fileHashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    fileHashHex = "crc32:" + crc32(fileBytes).toString(16).padStart(8, '0');
  }

  // 4. Determine Shard counts
  const dataLen = processedData.length;
  const K = Math.ceil(dataLen / chunkSize);
  const M = Math.max(1, Math.ceil(K * redundancyRatio));
  const totalFrames = K + M + 1; // Metadata + Data + Parity

  // Pad data payload to align with K * chunkSize
  const paddedData = new Uint8Array(K * chunkSize);
  paddedData.set(processedData);

  // Segment into shards
  const dataShards = [];
  for (let i = 0; i < K; i++) {
    dataShards.push(paddedData.subarray(i * chunkSize, (i + 1) * chunkSize));
  }

  // 5. Reed-Solomon Erasure Coding
  const rs = new ReedSolomon(K, M);
  const allShards = rs.encode(dataShards);

  // 6. Build Metadata payload (Chunk 0)
  const metadata = {
    name: fileName,
    size: fileBytes.length,
    mime: mimeType || "application/octet-stream",
    hash: fileHashHex,
    crc32: crc32(fileBytes), // Always provide CRC32 for insecure contexts (like HTTP)
    encrypted: encrypted,
    salt: saltBase64,
    iv: ivBase64,
    k: K,
    m: M,
    chunkSize: chunkSize,
    originalCompressedLen: dataLen
  };

  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const metadataFrame = new Frame(1, sessionId, 0, totalFrames, metadataBytes);

  // 7. Serialize all frames
  const frames = [metadataFrame.serialize()];
  for (let i = 0; i < K; i++) {
    const dataFrame = new Frame(2, sessionId, i + 1, totalFrames, allShards[i]);
    frames.push(dataFrame.serialize());
  }
  for (let i = 0; i < M; i++) {
    const parityFrame = new Frame(3, sessionId, K + i + 1, totalFrames, allShards[K + i]);
    frames.push(parityFrame.serialize());
  }

  return {
    sessionId,
    metadata,
    frames
  };
}

export class ReceiveSession {
  /**
   * @param {number} sessionId - Session ID being received.
   */
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.metadata = null;
    this.frames = {}; // seqNum -> Frame
    this.reconstructed = false;
  }

  /**
   * Feeds a frame into the session buffer.
   * @param {Frame} frame - Deserialized Frame.
   * @returns {boolean} True if frame was successfully buffered, false if duplicate.
   */
  addFrame(frame) {
    if (frame.sessionId !== this.sessionId) return false;
    if (this.frames[frame.seqNum]) return false;

    this.frames[frame.seqNum] = frame;

    if (frame.type === 1 && !this.metadata) {
      try {
        this.metadata = JSON.parse(new TextDecoder().decode(frame.payload));
      } catch (err) {
        console.error("Failed to parse metadata", err);
      }
    }
    return true;
  }

  /**
   * Retrieves current stats and percentage completion.
   * @returns {object}
   */
  getProgress() {
    const seqs = Object.keys(this.frames).map(Number);
    const hasMetadata = this.frames[0] !== undefined;

    if (!this.metadata) {
      const maxSeq = seqs.length > 0 ? Math.max(...seqs) : 0;
      return {
        hasMetadata: false,
        receivedCount: seqs.length,
        totalCount: maxSeq || 1,
        percent: 0,
        shardsReceived: seqs.filter(s => s > 0).length,
        shardsNeeded: 0
      };
    }

    const K = this.metadata.k;
    const M = this.metadata.m;
    const totalFrames = K + M + 1;

    let shardsReceived = 0;
    for (let i = 1; i <= K + M; i++) {
      if (this.frames[i]) {
        shardsReceived++;
      }
    }

    const percent = Math.min(100, Math.floor((shardsReceived / K) * 100));

    return {
      hasMetadata,
      receivedCount: seqs.length,
      totalCount: totalFrames,
      percent,
      shardsReceived,
      shardsNeeded: K
    };
  }

  /**
   * Checks if we have enough shards to trigger Reed-Solomon decoding.
   * @returns {boolean}
   */
  canReconstruct() {
    if (!this.metadata) return false;
    if (this.reconstructed) return false;

    const K = this.metadata.k;
    const M = this.metadata.m;

    let shardCount = 0;
    for (let i = 1; i <= K + M; i++) {
      if (this.frames[i]) {
        shardCount++;
      }
    }

    return shardCount >= K;
  }

  /**
   * Reconstructs, decrypts, and decompresses the final file.
   * @param {string} passphrase - Password for decryption (if required).
   * @returns {Promise<{name: string, size: number, mime: string, data: Uint8Array}>}
   */
  async reconstruct(passphrase = "") {
    if (!this.canReconstruct()) {
      throw new Error("Insufficient shards for reconstruction");
    }

    const K = this.metadata.k;
    const M = this.metadata.m;
    const chunkSize = this.metadata.chunkSize;
    const originalCompressedLen = this.metadata.originalCompressedLen;

    // Build the inputs for Reed-Solomon
    const shards = [];
    const shardPresent = [];

    for (let i = 1; i <= K + M; i++) {
      const frame = this.frames[i];
      if (frame) {
        shards.push(frame.payload);
        shardPresent.push(true);
      } else {
        shards.push(new Uint8Array(chunkSize));
        shardPresent.push(false);
      }
    }

    // Decode shards
    const rs = new ReedSolomon(K, M);
    const decodedShards = rs.decode(shards, shardPresent);

    // Concatenate K decoded shards
    const combinedBytes = new Uint8Array(K * chunkSize);
    for (let i = 0; i < K; i++) {
      combinedBytes.set(decodedShards[i], i * chunkSize);
    }

    // Slice to exact compressed length (discard padding)
    let processedData = combinedBytes.subarray(0, originalCompressedLen);

    // Decrypt (Optional)
    if (this.metadata.encrypted) {
      if (!passphrase) {
        throw new Error("This transfer is encrypted. Please supply the passphrase.");
      }
      const salt = new Uint8Array(atob(this.metadata.salt).split('').map(c => c.charCodeAt(0)));
      const iv = new Uint8Array(atob(this.metadata.iv).split('').map(c => c.charCodeAt(0)));
      processedData = await decryptPayload(processedData, passphrase, salt, iv);
    }

    // Decompress
    const fileBytes = await decompressData(processedData, 'gzip');

    // 6. E2E Integrity Check
    // Verify CRC32 Checksum first (always supported)
    const reconstructedCrc = crc32(fileBytes);
    if (this.metadata.crc32 !== undefined && reconstructedCrc !== this.metadata.crc32) {
      throw new Error("Integrity check failed: CRC32 checksum mismatch.");
    }

    // Verify SHA-256 if available and metadata hash is not a CRC32 descriptor
    if (this.metadata.hash && !this.metadata.hash.startsWith("crc32:") && window.crypto && window.crypto.subtle) {
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", fileBytes);
      const fileHashHex = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      if (fileHashHex !== this.metadata.hash) {
        throw new Error("SHA-256 verification failed. Decrypted data is corrupted.");
      }
    }

    this.reconstructed = true;
    return {
      name: this.metadata.name,
      size: this.metadata.size,
      mime: this.metadata.mime,
      data: fileBytes
    };
  }
}
