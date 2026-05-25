// Main coordinator for BlinkByte application
import { createSendSession, Frame } from './protocol.js';
import { renderQRToCanvas } from './generator.js';
import { BlinkByteScanner } from './scanner.js';
import { playBlip, playSuccess, playError, drawProgressGrid, formatBytes } from './ui.js';

// DOM Element Bindings
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const btnPasteClipboard = document.getElementById('btn-paste-clipboard');
const fileHud = document.getElementById('file-hud');
const fileHudName = document.getElementById('file-hud-name');
const fileHudSize = document.getElementById('file-hud-size');
const btnRemoveFile = document.getElementById('btn-remove-file');
const settingsToggle = document.getElementById('settings-toggle');
const settingsContent = document.getElementById('settings-content');

const btnStartSend = document.getElementById('btn-start-send');
const btnStopSend = document.getElementById('btn-stop-send');
const qrStreamContainer = document.getElementById('qr-stream-container');
const sendInitState = document.getElementById('send-init-state');
const qrCanvas = document.getElementById('qr-canvas');

const hudSendSession = document.getElementById('hud-send-session');
const hudSendFrame = document.getElementById('hud-send-frame');
const hudSendSpeed = document.getElementById('hud-send-speed');
const hudSendFec = document.getElementById('hud-send-fec');
const hudSendSecurity = document.getElementById('hud-send-security');

const videoElement = document.getElementById('scanner-video');
const canvasElement = document.getElementById('scanner-hidden-canvas');
const btnStartScan = document.getElementById('btn-start-scan');
const btnStopScan = document.getElementById('btn-stop-scan');
const btnToggleCamera = document.getElementById('btn-toggle-camera');
const scannerStatusPill = document.getElementById('scanner-status-pill');
const scannerStatusText = document.getElementById('scanner-status-text');

const receiveDiagnostics = document.getElementById('receive-diagnostics');
const hudRecvSession = document.getElementById('hud-recv-session');
const hudRecvShards = document.getElementById('hud-recv-shards');
const hudRecvProgress = document.getElementById('hud-recv-progress');
const hudRecvTime = document.getElementById('hud-recv-time');
const hudRecvRatio = document.getElementById('hud-recv-ratio');

const packetGridWrapper = document.getElementById('packet-grid-wrapper');
const packetGrid = document.getElementById('packet-grid');

const receiveScanningState = document.getElementById('receive-scanning-state');
const receiveSuccessState = document.getElementById('receive-success-state');
const successFileName = document.getElementById('success-file-name');
const successFileSize = document.getElementById('success-file-size');
const successFileMime = document.getElementById('success-file-mime');
const btnDownloadFile = document.getElementById('btn-download-file');
const btnResetReceive = document.getElementById('btn-reset-receive');

const passwordModal = document.getElementById('password-modal');
const decryptPassphraseInput = document.getElementById('decrypt-passphrase');
const decryptErrorText = document.getElementById('decrypt-error');
const btnConfirmDecrypt = document.getElementById('btn-confirm-decrypt');
const btnCancelDecrypt = document.getElementById('btn-cancel-decrypt');

// Configuration Form Values
const paramFps = document.getElementById('param-fps');
const paramChunkSize = document.getElementById('param-chunk-size');
const paramRedundancy = document.getElementById('param-redundancy');
const paramPassphrase = document.getElementById('param-passphrase');

// State Variables
let selectedFile = null;
let sendIntervalId = null;
let currentSendIndex = 0;
let generatedFrames = [];
let sendSessionMeta = null;

let scanner = null;
let currentFacingMode = 'environment'; // environment = back camera
let receiveStartTime = 0;
let reconstructedFile = null;
let pendingDecryptionSession = null;

// ==========================================
// 1. TRANSMIT (SENDER) FLOW
// ==========================================

// Drag & Drop Handlers
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    handleFileSelected(e.dataTransfer.files[0]);
  }
});

dropzone.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    handleFileSelected(fileInput.files[0]);
  }
});

// Clipboard Fast Paste Option
btnPasteClipboard.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      alert("Clipboard is empty or does not contain text.");
      return;
    }
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    const file = new File([bytes], "clipboard_text.txt", { type: "text/plain" });
    handleFileSelected(file);
  } catch (err) {
    alert("Failed to read from clipboard. Please grant clipboard permissions.");
  }
});

function handleFileSelected(file) {
  selectedFile = file;
  fileHudName.textContent = file.name;
  fileHudSize.textContent = formatBytes(file.size);
  
  // Show file HUD and enable Send button
  fileHud.style.display = 'flex';
  sendInitState.style.display = 'none';
  btnStartSend.removeAttribute('disabled');
}

btnRemoveFile.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  fileHud.style.display = 'none';
  sendInitState.style.display = 'block';
  btnStartSend.setAttribute('disabled', true);
});

// Settings Accordion
settingsToggle.addEventListener('click', () => {
  settingsToggle.classList.toggle('open');
  settingsContent.classList.toggle('open');
  settingsToggle.querySelector('span').textContent = settingsToggle.classList.contains('open') ? '▼' : '▶';
});

// Start Transmission
btnStartSend.addEventListener('click', async () => {
  if (!selectedFile) return;

  try {
    btnStartSend.setAttribute('disabled', true);
    btnStartSend.textContent = "Deriving Cryptographic Shards...";

    const fileReader = new FileReader();
    const fileDataPromise = new Promise((resolve, reject) => {
      fileReader.onload = () => resolve(new Uint8Array(fileReader.result));
      fileReader.onerror = () => reject(fileReader.error);
    });
    fileReader.readAsArrayBuffer(selectedFile);
    const fileBytes = await fileDataPromise;

    const fps = parseInt(paramFps.value) || 10;
    const chunkSize = parseInt(paramChunkSize.value) || 256;
    const redundancyRatio = parseFloat(paramRedundancy.value) || 0.3;
    const passphrase = paramPassphrase.value;

    // Create session
    const session = await createSendSession(fileBytes, selectedFile.name, selectedFile.type, {
      chunkSize,
      passphrase,
      redundancyRatio
    });

    generatedFrames = session.frames;
    sendSessionMeta = session.metadata;
    currentSendIndex = 0;

    // Adjust Canvas Scaling to matches density
    let qrScale = 8;
    if (chunkSize >= 512) qrScale = 5;
    else if (chunkSize >= 384) qrScale = 6;

    // Hide configurations, show canvas
    qrStreamContainer.style.display = 'flex';
    fileHud.style.display = 'none';
    settingsToggle.style.display = 'none';
    settingsContent.classList.remove('open');
    btnStartSend.style.display = 'none';

    // Populate Transmit Diagnostics
    hudSendSession.textContent = `0x${session.sessionId.toString(16).toUpperCase()}`;
    hudSendFec.textContent = `${Math.round(redundancyRatio * 100)}% RS (k:${sendSessionMeta.k}, m:${sendSessionMeta.m})`;
    hudSendSecurity.textContent = sendSessionMeta.encrypted ? "AES-256-GCM" : "PLAIN/UNSECURE";
    hudSendSecurity.className = sendSessionMeta.encrypted ? "hud-value green" : "hud-value pink";

    // Transmission Loop
    const intervalMs = 1000 / fps;
    hudSendSpeed.textContent = `${fps} FPS`;

    const renderNextFrame = () => {
      const frameBytes = generatedFrames[currentSendIndex];
      renderQRToCanvas(frameBytes, qrCanvas, {
        ecc: 'L',
        scale: qrScale,
        margin: 4
      });

      // Update frame counter
      hudSendFrame.textContent = `${currentSendIndex} / ${generatedFrames.length - 1}`;
      currentSendIndex = (currentSendIndex + 1) % generatedFrames.length;
    };

    renderNextFrame(); // initial draw
    sendIntervalId = setInterval(renderNextFrame, intervalMs);

  } catch (err) {
    alert("Failed to initialize stream: " + err.message);
    btnStartSend.removeAttribute('disabled');
    btnStartSend.textContent = "Initialize Transmission";
  }
});

// Stop Transmission
btnStopSend.addEventListener('click', () => {
  if (sendIntervalId) {
    clearInterval(sendIntervalId);
    sendIntervalId = null;
  }
  
  qrStreamContainer.style.display = 'none';
  fileHud.style.display = 'flex';
  settingsToggle.style.display = 'block';
  btnStartSend.style.display = 'block';
  btnStartSend.removeAttribute('disabled');
  btnStartSend.textContent = "Initialize Transmission";
});

// ==========================================
// 2. RECEIVER (SCANNERS) FLOW
// ==========================================

btnStartScan.addEventListener('click', async () => {
  btnStartScan.setAttribute('disabled', true);
  btnStartScan.textContent = "Binding Hardware Stream...";

  if (!scanner) {
    scanner = new BlinkByteScanner(videoElement, canvasElement, {
      onSessionStart: (session) => {
        hudRecvSession.textContent = `0x${session.sessionId.toString(16).toUpperCase()}`;
        receiveDiagnostics.style.display = 'block';
        packetGridWrapper.style.display = 'block';
        receiveStartTime = Date.now();
      },
      onFrameReceived: () => {
        playBlip();
      },
      onProgress: (progress, session) => {
        hudRecvRatio.textContent = `${progress.shardsReceived} / ${progress.shardsNeeded + session.metadata.m}`;
        hudRecvShards.textContent = `${progress.shardsReceived} / ${progress.shardsNeeded} needed`;
        hudRecvProgress.textContent = `${progress.percent}%`;
        
        // Render sector block grid
        drawProgressGrid(packetGrid, progress.totalCount, session.frames);

        // Estimate Transfer Diagnostics
        const elapsed = (Date.now() - receiveStartTime) / 1000;
        if (elapsed > 0.5 && progress.receivedCount > 0) {
          const totalTransferredBytes = progress.receivedCount * session.metadata.chunkSize;
          const speedKB = (totalTransferredBytes / 1024) / elapsed;
          
          let estSeconds = 0;
          if (progress.shardsReceived < progress.shardsNeeded) {
            const missingShards = progress.shardsNeeded - progress.shardsReceived;
            const remainingBytes = missingShards * session.metadata.chunkSize;
            estSeconds = (remainingBytes / 1024) / speedKB;
          }
          
          hudRecvTime.textContent = `${speedKB.toFixed(1)} KB/s (ETA: ${Math.ceil(estSeconds)}s)`;
        } else {
          hudRecvTime.textContent = "Calculating...";
        }
      },
      onComplete: async (session) => {
        // Complete triggered
        scanner.stop();
        updateScannerUIState(false);

        if (session.metadata.encrypted) {
          pendingDecryptionSession = session;
          decryptPassphraseInput.value = '';
          decryptErrorText.style.display = 'none';
          passwordModal.classList.add('active');
        } else {
          try {
            const file = await session.reconstruct();
            handleReconstructionSuccess(file);
          } catch (err) {
            playError();
            alert("Reconstruction failed: " + err.message);
            resetReceivePipeline();
          }
        }
      },
      onError: (err) => {
        playError();
        alert("Camera scanner error: " + err.message);
        updateScannerUIState(false);
      }
    });
  }

  const success = await scanner.start(currentFacingMode);
  updateScannerUIState(success);
});

btnStopScan.addEventListener('click', () => {
  if (scanner) {
    scanner.stop();
  }
  updateScannerUIState(false);
});

btnToggleCamera.addEventListener('click', async () => {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  if (scanner && scanner.active) {
    scanner.stop();
    const success = await scanner.start(currentFacingMode);
    updateScannerUIState(success);
  } else {
    alert(`Camera toggle initialized. Face mode set to: ${currentFacingMode}`);
  }
});

function updateScannerUIState(isRunning) {
  if (isRunning) {
    btnStartScan.style.display = 'none';
    btnStopScan.style.display = 'block';
    btnStopScan.removeAttribute('disabled');
    scannerStatusPill.className = 'status-pill active';
    scannerStatusText.textContent = 'SCANNING STREAM';
  } else {
    btnStartScan.style.display = 'block';
    btnStartScan.removeAttribute('disabled');
    btnStartScan.textContent = "Activate Camera Scanner";
    btnStopScan.style.display = 'none';
    scannerStatusPill.className = 'status-pill idle';
    scannerStatusText.textContent = 'OFFLINE';
  }
}

// Decryption Modal Action Handlers
btnConfirmDecrypt.addEventListener('click', async () => {
  if (!pendingDecryptionSession) return;
  const passphrase = decryptPassphraseInput.value;
  if (!passphrase) {
    decryptErrorText.textContent = "Please enter a passphrase.";
    decryptErrorText.style.display = 'block';
    return;
  }

  try {
    btnConfirmDecrypt.setAttribute('disabled', true);
    btnConfirmDecrypt.textContent = "Decrypting...";
    decryptErrorText.style.display = 'none';

    const file = await pendingDecryptionSession.reconstruct(passphrase);
    passwordModal.classList.remove('active');
    pendingDecryptionSession = null;
    handleReconstructionSuccess(file);
  } catch (err) {
    playError();
    decryptErrorText.textContent = "Decryption failed: Check passphrase or data integrity.";
    decryptErrorText.style.display = 'block';
  } finally {
    btnConfirmDecrypt.removeAttribute('disabled');
    btnConfirmDecrypt.textContent = "Decrypt Payload";
  }
});

btnCancelDecrypt.addEventListener('click', () => {
  passwordModal.classList.remove('active');
  pendingDecryptionSession = null;
  resetReceivePipeline();
});

// Handle Successful Data Extraction
function handleReconstructionSuccess(file) {
  reconstructedFile = file;
  playSuccess();

  successFileName.textContent = file.name;
  successFileSize.textContent = formatBytes(file.size);
  successFileMime.textContent = file.mime || 'application/octet-stream';

  receiveScanningState.style.display = 'none';
  receiveSuccessState.style.display = 'flex';
}

// Download Button Trigger
btnDownloadFile.addEventListener('click', () => {
  if (!reconstructedFile) return;
  
  const blob = new Blob([reconstructedFile.data], { type: reconstructedFile.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = reconstructedFile.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Reset scanner pipeline
btnResetReceive.addEventListener('click', () => {
  resetReceivePipeline();
});

function resetReceivePipeline() {
  reconstructedFile = null;
  receiveSuccessState.style.display = 'none';
  receiveScanningState.style.display = 'flex';
  receiveDiagnostics.style.display = 'none';
  packetGridWrapper.style.display = 'none';
  packetGrid.innerHTML = '';
  
  hudRecvSession.textContent = '0x00000000';
  hudRecvShards.textContent = '0 / 0';
  hudRecvProgress.textContent = '0%';
  hudRecvTime.textContent = 'N/A';
  hudRecvRatio.textContent = '0 / 0';

  updateScannerUIState(false);
}
