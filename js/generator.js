// High-Performance QR Code Generator for Canvas Rendering
// Interfaces with the local qrcode.min.js library loaded in the page.

/**
 * Renders raw bytes into a QR code on an HTML5 canvas.
 * @param {Uint8Array} bytes - The frame bytes to encode.
 * @param {HTMLCanvasElement} canvas - Target canvas element.
 * @param {object} options - Formatting and encoding parameters.
 */
export function renderQRToCanvas(bytes, canvas, options = {}) {
  const {
    ecc = 'L',        // Error correction level: L (7%), M (15%), Q (25%), H (30%)
    scale = 8,        // Pixel width/height of each QR module
    margin = 4,       // Margin modules around the QR code
    darkColor = '#000000',
    lightColor = '#ffffff'
  } = options;

  if (typeof qrcode === 'undefined') {
    throw new Error("qrcode-generator library is not loaded. Ensure qrcode.min.js is included.");
  }

  // Version 0 auto-detects the smallest QR version that fits the byte payload.
  const qr = qrcode(0, ecc);

  // Custom data wrapper to support raw Uint8Array payload in Byte mode (mode: 4)
  const binaryWrapper = {
    mode: 4, // 8-Bit Byte Mode
    getLength: () => bytes.length,
    write: (buffer) => {
      for (let i = 0; i < bytes.length; i++) {
        buffer.put(bytes[i], 8);
      }
    }
  };

  qr.addData(binaryWrapper);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const size = (moduleCount + margin * 2) * scale;

  // Resize canvas to match the exact dimensions
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false }); // disable alpha for speed boost

  // Render Background
  ctx.fillStyle = lightColor;
  ctx.fillRect(0, 0, size, size);

  // Render Foreground Modules
  ctx.fillStyle = darkColor;
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (qr.isDark(r, c)) {
        const x = (c + margin) * scale;
        const y = (r + margin) * scale;
        ctx.fillRect(x, y, scale, scale);
      }
    }
  }
}
