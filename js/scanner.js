// Webcam Stream Controller and QR Frame Decoder
import { Frame, ReceiveSession } from './protocol.js';

export class BlinkByteScanner {
  constructor(videoElement, canvasElement, callbacks = {}) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d', { willReadFrequently: true });
    
    this.onSessionStart = callbacks.onSessionStart || (() => {});
    this.onFrameReceived = callbacks.onFrameReceived || (() => {});
    this.onProgress = callbacks.onProgress || (() => {});
    this.onComplete = callbacks.onComplete || (() => {});
    this.onError = callbacks.onError || (() => {});

    this.stream = null;
    this.active = false;
    this.activeSession = null;
    this.lastFrameTime = 0;
    this.frameInterval = 1000 / 30; // Max 30 scans per second to save CPU
  }

  /**
   * Starts the webcam stream.
   * @param {string} facingMode - 'environment' (back camera) or 'user' (front camera).
   * @returns {Promise<boolean>} True if successful.
   */
  async start(facingMode = 'environment') {
    if (this.active) return true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Webcam access is blocked or not supported in this browser context. You MUST access this application via HTTPS (secure connection) or localhost.");
    }

    let stream;
    try {
      const constraints = {
        video: { facingMode: facingMode },
        audio: false
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn("Requested facingMode constraints failed, falling back to general camera request...", err);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (fallbackErr) {
        throw new Error("Failed to acquire camera: please ensure you have given camera permissions, and that you are not inside an in-app browser like WhatsApp or Instagram (open in Safari/Chrome instead).");
      }
    }

    try {
      this.stream = stream;
      this.video.srcObject = this.stream;
      this.video.setAttribute("playsinline", true); // required for iOS safari
      this.video.muted = true; // required for reliable autoplay on mobile browsers
      
      // Start video playback asynchronously without awaiting the promise.
      // The scanLoop checks video.readyState before decoding, so this is safe and prevents hangs.
      this.video.play().catch(playError => {
        console.warn("Asynchronous video.play() failed:", playError);
      });

      this.active = true;
      this.activeSession = null;
      this.scanLoop();
      return true;
    } catch (error) {
      console.error("Camera access failed:", error);
      this.onError(error);
      return false;
    }
  }

  /**
   * Stops the webcam and releases all hardware resources.
   */
  stop() {
    this.active = false;
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  /**
   * The continuous scanning recursion using requestAnimationFrame.
   */
  scanLoop() {
    if (!this.active) return;

    requestAnimationFrame((time) => {
      this.scanLoop();

      // Throttle frames to avoid CPU hogging
      if (time - this.lastFrameTime < this.frameInterval) {
        return;
      }
      this.lastFrameTime = time;

      if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
        const width = this.video.videoWidth;
        const height = this.video.videoHeight;
        
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx.drawImage(this.video, 0, 0, width, height);

        const imageData = this.ctx.getImageData(0, 0, width, height);
        
        // Scan with jsQR (loaded locally)
        if (typeof jsQR === 'undefined') {
          console.error("jsQR library is not loaded.");
          return;
        }

        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert" // fast mode (sender has dark-on-light contrast)
        });

        if (code && code.binaryData && code.binaryData.length > 0) {
          this.processDecodedBytes(new Uint8Array(code.binaryData));
        }
      }
    });
  }

  /**
   * Parses, validates, and buffers the scanned packet.
   * @param {Uint8Array} bytes - Raw QR binary content.
   */
  processDecodedBytes(bytes) {
    try {
      // Deserialize the binary frame
      const frame = Frame.deserialize(bytes);

      // Create a session if it's the first time we see this session ID
      if (!this.activeSession || this.activeSession.sessionId !== frame.sessionId) {
        // If we were in the middle of another session, let's discard or prompt
        this.activeSession = new ReceiveSession(frame.sessionId);
        this.onSessionStart(this.activeSession);
      }

      // Add frame to session
      const isNewFrame = this.activeSession.addFrame(frame);
      
      if (isNewFrame) {
        // Trigger frame received event (e.g. play a quiet blip, flash UI)
        this.onFrameReceived(frame);
        
        const progress = this.activeSession.getProgress();
        this.onProgress(progress, this.activeSession);

        // Check if we have gathered K shards and can reconstruct
        if (this.activeSession.canReconstruct()) {
          // If metadata is encrypted, we let the UI handle prompting for the password.
          // Otherwise, we can trigger the complete callback immediately.
          this.onComplete(this.activeSession);
        }
      }
    } catch (err) {
      // Invalid magic, checksum mismatch, or other corruption
      // We ignore transmission errors silently in optical transfers
    }
  }
}
