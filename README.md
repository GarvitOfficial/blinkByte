# BlinkByte // Futuristic Offline Optical Data Transfer

BlinkByte is a futuristic, offline optical data transfer system that transmits files, text, images, and clipboard content between devices using animated QR code sequences and real-time camera scanning.

*“AirDrop for fully offline, air-gapped devices.”*

---

## ⚡ Core Concept

One device segments and encodes data into rapidly changing visual QR frames containing Reed-Solomon parity packets. Another device captures the stream continuously using its camera, reconstructing the file locally in real time. Because the frames contain error-correction data, the receiver can rebuild the file from *any* sufficient subset of frames, meaning it handles camera lag, motion blur, and dropped frames automatically.

---

## 🚀 Key Features

*   **100% Offline (Air-Gap Compatible):** Requires no internet, Bluetooth, Wi-Fi, NFC, or physical cables.
*   **Fully Self-Contained & Portable:** Built as a client-side WebApp using ES modules and local static libraries. It can be run locally via `file://` or hosted on static servers (like GitHub Pages). Once downloaded, it operates fully offline with no internet access.
*   **Reed-Solomon Error Correction:** Implemented at the packet level. If a frame is dropped due to camera defocus or motion blur, the receiver recovers it automatically without asking the sender for a retransmission.
*   **Authenticated Encryption:** Optional AES-256-GCM encryption with PBKDF2 key derivation protects files in transit.
*   **Browser-Native Performance:** Uses browser-native `CompressionStream` (Gzip) and `Web Crypto API` for cryptography, running at hardware speeds with zero external JS size overhead.
*   **Futuristic Cyberpunk UI:** Custom glassmorphism overlays, animated neon indicators, diagnostic grids showing packet reception, and synthetic beep feedback generated programmatically via the `Web Audio API`.

---

## 🛠️ Technology Stack

*   **Structure:** HTML5 Semantic Markup
*   **Styling:** Custom Vanilla CSS3 (Neon Cyberpunk Design System)
*   **Logic:** Modern Vanilla JavaScript (ES6 Modules)
*   **QR Encoding:** Kazuhiko Arase's `qrcode-generator` (configured for raw binary Byte mode)
*   **QR Decoding:** Cosmopico's `jsQR` (extracting raw `binaryData` buffers)
*   **Cryptography:** W3C Web Cryptography API (AES-256-GCM, PBKDF2, SHA-256)
*   **Compression:** Browser-Native Compression Streams API (Gzip)
*   **Audio Synthesis:** Web Audio API (Synthesized blips, clicks, alarms)

---

## 📥 Quick Start Guide

### 1. Clone the Repository
```bash
git clone https://github.com/GarvitOfficial/blinkByte.git
cd blinkByte
```

### 2. Run Locally (Bypassing Browser CORS)
Because the app uses ES Modules, modern browsers block loading local scripts via the `file://` protocol. You must serve the folder using a local static server. We have provided a utility script to handle this automatically:

```bash
./start.sh
```
This script will start a local server on `http://localhost:8080` using Python 3 or Node's `npx serve`. Open that address in your web browser.

### 3. Deploy to GitHub Pages
To publish this prototype for mobile access, push the code to your GitHub repository. The included GitHub Actions workflow will automatically deploy the site:

```bash
git add .
git commit -m "feat: initial prototype release"
git push origin main
```
Your app will be live at `https://<your-username>.github.io/blinkByte/`.

---

## 🧪 Running Diagnostics & Tests

We have included a dedicated diagnostic suite that validates all cryptographic, compression, and algebraic math modules. To run the tests, open the application, click **Advanced Configurations**, and select **Rerun Diagnostics** or navigate directly to:

`http://localhost:8080/test/test.html`

The suite runs:
1.  **Galois Field Arithmetic Check:** Validates log/exp tables and $GF(2^8)$ multiplication/inversion.
2.  **Reed-Solomon Shard Recovery:** Splits data into 4 shards, generates 2 parity shards, erases 2 shards at random, and successfully restores the original array.
3.  **Gzip Stream Compactor:** Compresses and decompresses test strings.
4.  **Web Crypto Envelope:** Checks key derivation, AES-256-GCM ciphertext output, and validates that decryption errors throw correctly on invalid keys.
5.  **End-to-End File Simulation:** Packs a file, drops packets, and validates reconstructed SHA-256 integrity.

---

## 📖 Protocol Reference

For details about the frame packet structure, CRC32 checksums, Cauchy matrix equations, and session management, see [protocol/README.md](protocol/README.md).

---

## 📄 License

This project is licensed under the MIT License. Feel free to copy, modify, and distribute it.
