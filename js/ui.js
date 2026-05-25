// UI feedback, audio synthesis, and progress grid drawing
let audioCtx = null;

/**
 * Initializes and resumes the Web Audio API context.
 */
function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Synthesizes a short futuristic laser scan blip (frame captured).
 */
export function playBlip() {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(900, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1300, ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  } catch (e) {
    // browser permissions might block until user gesture
  }
}

/**
 * Synthesizes a futuristic ascending arpeggio sound (success).
 */
export function playSuccess() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const playNote = (freq, time, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0.08, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + dur);
    };

    playNote(523.25, now, 0.12);       // C5
    playNote(659.25, now + 0.08, 0.12);  // E5
    playNote(783.99, now + 0.16, 0.12);  // G5
    playNote(1046.50, now + 0.24, 0.25); // C6
  } catch (e) {}
}

/**
 * Synthesizes a descending synth buzz (error).
 */
export function playError() {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(70, ctx.currentTime + 0.25);

    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {}
}

/**
 * Renders a visual mapping of the packet nodes (grid display).
 * @param {HTMLDivElement} container - Grid container.
 * @param {number} totalCount - Total packets in session (K + M + 1).
 * @param {object} receivedFrames - Map of received sequence numbers.
 */
export function drawProgressGrid(container, totalCount, receivedFrames) {
  // Clear container
  container.innerHTML = '';

  for (let i = 0; i < totalCount; i++) {
    const node = document.createElement('div');
    node.className = 'packet-node';
    node.title = `Chunk Index: ${i}`;

    if (receivedFrames[i]) {
      if (i === 0) {
        node.classList.add('metadata'); // Cyan highlighting for metadata
      } else {
        node.classList.add('received'); // Green highlighting for data/parity
      }
    }

    container.appendChild(node);
  }
}

/**
 * Helper to convert bytes to human-readable size.
 * @param {number} bytes 
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
