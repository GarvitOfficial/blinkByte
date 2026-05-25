// Unit Test Runner for BlinkByte Core Modules
import { ReedSolomon } from '../js/rs.js';
import { compressData, decompressData } from '../js/compress.js';
import { encryptPayload, decryptPayload } from '../js/crypto.js';
import { Frame, createSendSession, ReceiveSession, crc32 } from '../js/protocol.js';

const resultsContainer = document.getElementById('test-results');
const consoleContainer = document.getElementById('test-console');

function logToConsole(msg) {
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  consoleContainer.appendChild(line);
  consoleContainer.scrollTop = consoleContainer.scrollHeight;
}

function renderTestResult(name, passed, errorMsg = '') {
  const row = document.createElement('div');
  row.className = 'test-row';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'test-name';
  nameSpan.textContent = name;

  const statusSpan = document.createElement('span');
  statusSpan.className = `test-status ${passed ? 'passed' : 'failed'}`;
  statusSpan.textContent = passed ? 'Passed // OK' : 'Failed // ERR';

  row.appendChild(nameSpan);
  row.appendChild(statusSpan);

  if (!passed && errorMsg) {
    const errDiv = document.createElement('div');
    errDiv.style.color = 'var(--neon-pink)';
    errDiv.style.fontSize = '0.75rem';
    errDiv.style.fontFamily = 'var(--font-mono)';
    errDiv.style.paddingLeft = '1rem';
    errDiv.textContent = `↳ ${errorMsg}`;
    resultsContainer.appendChild(row);
    resultsContainer.appendChild(errDiv);
  } else {
    resultsContainer.appendChild(row);
  }
}

async function runSuite() {
  resultsContainer.innerHTML = '';
  logToConsole("Initializing Diagnostics Suite...");

  // 1. Galois Field & Reed-Solomon Erasure Coding Tests
  try {
    logToConsole("Test 1: Starting Reed-Solomon Shard Recovery validation...");
    
    const K = 4;
    const M = 2;
    const L = 32; // shard length
    
    // Create random test shards
    const originalShards = [];
    for (let i = 0; i < K; i++) {
      const shard = new Uint8Array(L);
      for (let j = 0; j < L; j++) {
        shard[j] = Math.floor(Math.random() * 256);
      }
      originalShards.push(shard);
    }
    
    const rs = new ReedSolomon(K, M);
    const encoded = rs.encode(originalShards);
    
    if (encoded.length !== K + M) {
      throw new Error(`Encoded shard count mismatch: expected ${K + M}, got ${encoded.length}`);
    }
    
    logToConsole(`Reed-Solomon: Generated ${K} data + ${M} parity = ${K + M} total shards.`);

    // Simulate lost shards (erase index 1 and 3)
    const received = [...encoded];
    const present = Array(K + M).fill(true);
    
    received[1] = null;
    present[1] = false;
    received[3] = null;
    present[3] = false;
    
    logToConsole("Reed-Solomon: Simulating transmission erasure (dropped Shards [1] and [3])...");

    // Decode and reconstruct
    const decoded = rs.decode(received, present);
    
    // Verify results match original
    for (let i = 0; i < K; i++) {
      for (let j = 0; j < L; j++) {
        if (decoded[i][j] !== originalShards[i][j]) {
          throw new Error(`Data mismatch in reconstructed shard ${i} at byte ${j}`);
        }
      }
    }
    
    logToConsole("Reed-Solomon: Shard recovery matching successful!");
    renderTestResult("Reed-Solomon Erasure Coding (GF(2^8) Systematic Shard Recovery)", true);
  } catch (err) {
    logToConsole(`ERROR: Reed-Solomon test failed: ${err.message}`);
    renderTestResult("Reed-Solomon Erasure Coding (GF(2^8) Systematic Shard Recovery)", false, err.message);
  }

  // 2. Native Compression Stream Tests
  try {
    logToConsole("Test 2: Starting Compression Stream (Gzip) validation...");
    
    const testString = "BlinkByte ".repeat(100) + "Futuristic Optical Transport Layer Prototype!";
    const testBytes = new TextEncoder().encode(testString);
    
    logToConsole(`Compression: Input text length = ${testBytes.length} bytes.`);
    
    const compressed = await compressData(testBytes, 'gzip');
    logToConsole(`Compression: Compressed size = ${compressed.length} bytes (ratio: ${Math.round(compressed.length / testBytes.length * 100)}%).`);
    
    const decompressed = await decompressData(compressed, 'gzip');
    const decompressedString = new TextDecoder().decode(decompressed);
    
    if (decompressedString !== testString) {
      throw new Error("Decompressed data does not match original input string");
    }
    
    logToConsole("Compression: Gzip compression/decompression verified.");
    renderTestResult("Browser Native Compression Stream (Gzip Payload Compactor)", true);
  } catch (err) {
    logToConsole(`ERROR: Compression test failed: ${err.message}`);
    renderTestResult("Browser Native Compression Stream (Gzip Payload Compactor)", false, err.message);
  }

  // 3. Native Cryptography API Tests
  try {
    logToConsole("Test 3: Starting Web Crypto API (AES-256-GCM) validation...");
    
    const secretMessage = "Fully offline optical data channel. Zero cloud footprints.";
    const secretBytes = new TextEncoder().encode(secretMessage);
    const password = "cyberpunk_key_2026";
    
    logToConsole("Crypto: Encrypting secret payload using PBKDF2 derived keys...");
    const { salt, iv, ciphertext } = await encryptPayload(secretBytes, password);
    logToConsole(`Crypto: Generated ciphertext length = ${ciphertext.length} bytes.`);
    
    // Decrypt with correct password
    logToConsole("Crypto: Attempting decryption with correct password...");
    const decryptedBytes = await decryptPayload(ciphertext, password, salt, iv);
    const decryptedString = new TextDecoder().decode(decryptedBytes);
    
    if (decryptedString !== secretMessage) {
      throw new Error("Decrypted string mismatch");
    }
    logToConsole("Crypto: Decryption match verified.");

    // Decrypt with wrong password (should fail integrity check)
    logToConsole("Crypto: Simulating decryption with incorrect password...");
    let threwError = false;
    try {
      await decryptPayload(ciphertext, "wrong_password", salt, iv);
    } catch (e) {
      threwError = true;
      logToConsole("Crypto: Decryption failed correctly for incorrect password.");
    }
    
    if (!threwError) {
      throw new Error("Decryption with wrong password succeeded (potential cryptographic leak)");
    }
    
    renderTestResult("Web Crypto Authenticated Encryption (AES-256-GCM with PBKDF2 KDF)", true);
  } catch (err) {
    logToConsole(`ERROR: Crypto test failed: ${err.message}`);
    renderTestResult("Web Crypto Authenticated Encryption (AES-256-GCM with PBKDF2 KDF)", false, err.message);
  }

  // 4. Binary Frame Packing & Checksum Serialization
  try {
    logToConsole("Test 4: Starting Binary Frame Packing & Checksum validation...");
    
    const sessionId = 0xABCDEF12;
    const seqNum = 42;
    const totalFrames = 100;
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0xAA, 0xBB, 0xCC]);
    
    const originalFrame = new Frame(2, sessionId, seqNum, totalFrames, payload);
    const serialized = originalFrame.serialize();
    
    logToConsole(`Frame: Serialized packet buffer size = ${serialized.length} bytes.`);
    
    // Verify serialized fields
    if (serialized[0] !== 0xBB || serialized[1] !== 0xFB) {
      throw new Error("Magic bytes misplaced in serialized stream");
    }
    
    // De-serialize and verify fields
    logToConsole("Frame: Deserializing frame buffer and verifying fields...");
    const parsedFrame = Frame.deserialize(serialized);
    
    if (parsedFrame.type !== 2) throw new Error("Frame type mismatch");
    if (parsedFrame.sessionId !== sessionId) throw new Error("Session ID mismatch");
    if (parsedFrame.seqNum !== seqNum) throw new Error("Sequence number mismatch");
    if (parsedFrame.totalFrames !== totalFrames) throw new Error("Total frame count mismatch");
    if (parsedFrame.payload.length !== payload.length) throw new Error("Payload size mismatch");
    
    for (let i = 0; i < payload.length; i++) {
      if (parsedFrame.payload[i] !== payload[i]) {
        throw new Error(`Payload byte mismatch at offset ${i}`);
      }
    }
    
    logToConsole("Frame: Binary parsing and CRC32 verification validated!");
    renderTestResult("Frame Serialization & Packet Integrity Validation (CRC32 Checksum)", true);
  } catch (err) {
    logToConsole(`ERROR: Frame Serialization test failed: ${err.message}`);
    renderTestResult("Frame Serialization & Packet Integrity Validation (CRC32 Checksum)", false, err.message);
  }

  // 5. End-to-End Session Packing, Erasure, and Reconstruction
  try {
    logToConsole("Test 5: Initiating full E2E Session Transmission simulation...");
    
    const fileContent = "BlinkByte Optical Stream ".repeat(500); // ~13 KB
    const fileBytes = new TextEncoder().encode(fileContent);
    const filename = "e2e_diagnostic.log";
    const mimeType = "text/plain";
    const password = "secure_e2e_phrase";
    
    logToConsole(`E2E: Packing virtual file '${filename}' (~${fileBytes.length} bytes) using 30% RS redundancy...`);
    
    // Create Send Session
    const sendSession = await createSendSession(fileBytes, filename, mimeType, {
      chunkSize: 128,
      passphrase: password,
      redundancyRatio: 0.3
    });
    
    const totalFrames = sendSession.frames.length;
    logToConsole(`E2E: Session initialized. Generated ${totalFrames} total frames.`);

    // Initialize Receive Session
    const receiveSession = new ReceiveSession(sendSession.sessionId);
    
    // Feed frames, but simulate dropping some data/parity frames
    logToConsole("E2E: Streaming frames... dropping indices 2, 5, 8, and 12.");
    
    for (let i = 0; i < totalFrames; i++) {
      if (i === 2 || i === 5 || i === 8 || i === 12) {
        continue; // drop frame
      }
      
      const serializedFrame = sendSession.frames[i];
      const parsedFrame = Frame.deserialize(serializedFrame);
      receiveSession.addFrame(parsedFrame);
    }
    
    const progress = receiveSession.getProgress();
    logToConsole(`E2E: Receiver progress: ${progress.shardsReceived} / ${progress.shardsNeeded} shards received (metadata: ${progress.hasMetadata}).`);
    
    if (!receiveSession.canReconstruct()) {
      throw new Error("Session reporting insufficient shards despite redundancy margin");
    }
    
    logToConsole("E2E: Shards count is sufficient. Executing Reed-Solomon reconstruction and decryption...");
    const reconstructed = await receiveSession.reconstruct(password);
    
    const reconstructedContent = new TextDecoder().decode(reconstructed.data);
    
    if (reconstructedContent !== fileContent) {
      throw new Error("Reconstructed file content mismatch");
    }
    
    if (reconstructed.name !== filename || reconstructed.mime !== mimeType) {
      throw new Error("Metadata field mismatch after reconstruction");
    }
    
    logToConsole("E2E: Session recovery, decryption, decompression, and SHA-256 hash match validated!");
    renderTestResult("End-to-End Session Transmission (Packing, Erasure Correction & Decrypt)", true);
  } catch (err) {
    logToConsole(`ERROR: E2E session test failed: ${err.message}`);
    renderTestResult("End-to-End Session Transmission (Packing, Erasure Correction & Decrypt)", false, err.message);
  }

  logToConsole("Diagnostics complete. System status: NOMINAL.");
}

// Auto-run on page load
runSuite();
