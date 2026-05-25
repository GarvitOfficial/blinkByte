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
  return (((arr[offset] << 24) | (arr[offset + 1] << 16) | (arr[offset + 2] << 8) | arr[offset + 3]) >>> 0);
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
  const webCrypto = typeof window !== 'undefined' ? window.crypto : globalThis.crypto;
  if (webCrypto && webCrypto.subtle) {
    const hashBuffer = await webCrypto.subtle.digest("SHA-256", fileBytes);
    fileHashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    fileHashHex = "crc32:" + crc32(fileBytes).toString(16).padStart(8, '0');
  }

  // 4. Segment into data shards
  const dataLen = processedData.length;
  const K = Math.ceil(dataLen / chunkSize);
  const paddedData = new Uint8Array(K * chunkSize);
  paddedData.set(processedData);

  const dataShards = [];
  for (let i = 0; i < K; i++) {
    dataShards.push(paddedData.subarray(i * chunkSize, (i + 1) * chunkSize));
  }

  // 5. Partition into blocks (each block has <= 128 data shards to satisfy GF(2^8) Reed-Solomon limit)
  const SHARDS_PER_BLOCK = 128;
  const B = Math.ceil(K / SHARDS_PER_BLOCK);
  const blockConfigs = [];
  const frames = [];

  let totalDataAndParityFrames = 0;
  for (let b = 0; b < B; b++) {
    const startIdx = b * SHARDS_PER_BLOCK;
    const endIdx = Math.min(K, startIdx + SHARDS_PER_BLOCK);
    const Kb = endIdx - startIdx;
    const Mb = Math.max(1, Math.ceil(Kb * redundancyRatio));

    blockConfigs.push({ k: Kb, m: Mb });
    totalDataAndParityFrames += (Kb + Mb);
  }

  const totalFrames = totalDataAndParityFrames + 1; // +1 for Metadata

  // Encode block by block
  for (let b = 0; b < B; b++) {
    const startIdx = b * SHARDS_PER_BLOCK;
    const { k: Kb, m: Mb } = blockConfigs[b];
    const blockShards = dataShards.slice(startIdx, startIdx + Kb);

    // Run Reed-Solomon over this block
    const rs = new ReedSolomon(Kb, Mb);
    const allBlockShards = rs.encode(blockShards); // returns Kb + Mb shards

    // Data frames: seqNum carries block index in upper 8 bits, relative shard index in lower 8 bits
    for (let i = 0; i < Kb; i++) {
      const seqNum = (b << 8) | i;
      const dataFrame = new Frame(2, sessionId, seqNum, totalFrames, allBlockShards[i]);
      frames.push(dataFrame.serialize());
    }

    // Parity frames
    for (let j = 0; j < Mb; j++) {
      const seqNum = (b << 8) | (Kb + j);
      const parityFrame = new Frame(3, sessionId, seqNum, totalFrames, allBlockShards[Kb + j]);
      frames.push(parityFrame.serialize());
    }
  }

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
    m: totalDataAndParityFrames - K,
    chunkSize: chunkSize,
    originalCompressedLen: dataLen,
    shardsPerBlock: SHARDS_PER_BLOCK,
    blockConfigs: blockConfigs
  };

  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const metadataFrame = new Frame(1, sessionId, 0, totalFrames, metadataBytes);

  // Unshift metadata frame to the front
  frames.unshift(metadataFrame.serialize());

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
    this.blockBuffers = {}; // blockIdx -> shardIdx -> Frame
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
    } else if (frame.type === 2 || frame.type === 3) {
      const blockIdx = frame.seqNum >>> 8;
      const shardIdx = frame.seqNum & 0xFF;

      if (!this.blockBuffers[blockIdx]) {
        this.blockBuffers[blockIdx] = {};
      }
      this.blockBuffers[blockIdx][shardIdx] = frame;
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
    const blockConfigs = this.metadata.blockConfigs || [];
    const totalFrames = blockConfigs.reduce((sum, b) => sum + b.k + b.m, 0) + 1;

    let shardsReceived = 0;
    let shardsNeeded = K;

    for (let b = 0; b < blockConfigs.length; b++) {
      const block = this.blockBuffers[b] || {};
      const { k: Kb, m: Mb } = blockConfigs[b];

      for (let i = 0; i < Kb + Mb; i++) {
        if (block[i]) {
          shardsReceived++;
        }
      }
    }

    const percent = Math.min(100, Math.floor((shardsReceived / shardsNeeded) * 100));

    return {
      hasMetadata,
      receivedCount: seqs.length,
      totalCount: totalFrames,
      percent,
      shardsReceived,
      shardsNeeded
    };
  }

  /**
   * Checks if we have enough shards to trigger Reed-Solomon decoding.
   * @returns {boolean}
   */
  canReconstruct() {
    if (!this.metadata) return false;
    if (this.reconstructed) return false;

    const blockConfigs = this.metadata.blockConfigs || [];
    if (blockConfigs.length === 0) return false;

    // Reconstructable only if every block has at least its data shards (K_b)
    for (let b = 0; b < blockConfigs.length; b++) {
      const block = this.blockBuffers[b] || {};
      const { k: Kb, m: Mb } = blockConfigs[b];

      let count = 0;
      for (let i = 0; i < Kb + Mb; i++) {
        if (block[i]) {
          count++;
        }
      }

      if (count < Kb) {
        return false;
      }
    }

    return true;
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
    const chunkSize = this.metadata.chunkSize;
    const originalCompressedLen = this.metadata.originalCompressedLen;
    const blockConfigs = this.metadata.blockConfigs;

    const B = blockConfigs.length;
    const reconstructedBlocks = [];

    // Reconstruct each block independently
    for (let b = 0; b < B; b++) {
      const { k: Kb, m: Mb } = blockConfigs[b];
      const block = this.blockBuffers[b];

      const shards = [];
      const shardPresent = [];

      for (let i = 0; i < Kb + Mb; i++) {
        const frame = block[i];
        if (frame) {
          shards.push(frame.payload);
          shardPresent.push(true);
        } else {
          shards.push(new Uint8Array(chunkSize));
          shardPresent.push(false);
        }
      }

      const rs = new ReedSolomon(Kb, Mb);
      const decodedShards = rs.decode(shards, shardPresent);

      const blockBytes = new Uint8Array(Kb * chunkSize);
      for (let i = 0; i < Kb; i++) {
        blockBytes.set(decodedShards[i], i * chunkSize);
      }

      reconstructedBlocks.push(blockBytes);
    }

    // Recombine blocks
    const totalLen = reconstructedBlocks.reduce((sum, arr) => sum + arr.length, 0);
    const combinedBytes = new Uint8Array(totalLen);
    let offset = 0;
    for (let b = 0; b < B; b++) {
      combinedBytes.set(reconstructedBlocks[b], offset);
      offset += reconstructedBlocks[b].length;
    }

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
    const webCrypto = typeof window !== 'undefined' ? window.crypto : globalThis.crypto;
    if (this.metadata.hash && !this.metadata.hash.startsWith("crc32:") && webCrypto && webCrypto.subtle) {
      const hashBuffer = await webCrypto.subtle.digest("SHA-256", fileBytes);
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
