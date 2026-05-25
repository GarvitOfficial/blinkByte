# BlinkByte Protocol Specification (v1.0)

BlinkByte is a simplex-first, optical data transfer protocol designed to transmit files and arbitrary payloads over visual channels (such as animated QR codes or high-frequency LED pulses) without requiring active feedback or backchannels.

---

## 1. Frame Byte Layout

Every BlinkByte frame is encoded as a binary buffer containing a **13-byte header**, followed by a **variable-length payload**, and finalized with a **4-byte integrity checksum**.

### Byte Map

| Offset (Bytes) | Field Name | Data Type | Description |
| :--- | :--- | :--- | :--- |
| `0 .. 1` | Magic Bytes | `uint8[2]` | Always `[0xBB, 0xFB]` |
| `2` | Frame Type | `uint8` | `0x01` = Metadata, `0x02` = Data, `0x03` = Parity |
| `3 .. 6` | Session ID | `uint32` | 32-bit big-endian transaction identifier |
| `7 .. 8` | Sequence Number | `uint16` | 16-bit sequence index (`0` for metadata) |
| `9 .. 10` | Total Frames | `uint16` | Total packets in this session ($K + M + 1$) |
| `11 .. 12` | Payload Length | `uint16` | Length of payload section $L$ (0 to 65,535) |
| `13 .. 13+L-1` | Payload | `uint8[L]` | The packet data (sharded content or metadata) |
| `13+L .. 13+L+3`| CRC32 Checksum | `uint32` | CRC32 of bytes `0` to `13+L-1` |

### Field Details

1. **Magic Bytes (`0xBB 0xFB`)**: Protects the scanner pipeline from processing irrelevant barcodes or raw noise.
2. **Frame Type**:
   - `0x01` (Metadata): Contains the JSON envelope describing the file name, size, SHA-256 hash, and encryption salts. Always sequence `0`.
   - `0x02` (Data): Shards of the original compressed/encrypted file payload.
   - `0x03` (Parity): Shards generated via Reed-Solomon Erasure Coding to correct erasures.
3. **Session ID**: Generated randomly by the transmitter. Allows the receiver to distinguish between consecutive file transmissions and clear stale buffers.
4. **Sequence Number**: Identifies the position of the shard. Used to rebuild the matrix for Reed-Solomon reconstruction.
5. **CRC32 Checksum**: Appended at the end of the byte stream. Verified immediately after QR decoding to guarantee absolute channel integrity.

---

## 2. Session Initialization Envelope (Metadata)

The metadata frame (Sequence `0`) contains a JSON string detailing the properties of the incoming payload.

```json
{
  "name": "avatar.jpg",
  "size": 1048576,
  "mime": "image/jpeg",
  "hash": "8f43c3937d1d2ff2ff841d9165b4c10a174fcfd9b9d36bb9cf7208e3d0628285",
  "encrypted": true,
  "salt": "YnBfc2FsdF85OTk5",
  "iv": "YmJfYXV0aF9pdl8xMjM0",
  "k": 32,
  "m": 10,
  "chunkSize": 256,
  "originalCompressedLen": 8192
}
```

---

## 3. Error Correction Strategy (Reed-Solomon FEC)

Visual data transmission over camera scanner screens is inherently lossy due to motion blur, frame rate mismatches, and autofocus drift. 

BlinkByte resolves this using a systematic **Reed-Solomon Erasure Code** over Galois Field $GF(2^8)$.

### Cauchy Generator Matrix

The encoder splits the compressed and encrypted file data into $K$ data shards. It constructs a Cauchy systematic generator matrix of size $(K + M) \times K$:

$$G = \begin{bmatrix} I_K \\ C_{M \times K} \end{bmatrix}$$

Where $I_K$ is the $K \times K$ identity matrix (so the first $K$ encoded packets are identical to the input shards), and $C_{M \times K}$ is a Cauchy matrix defined as:

$$C_{i,j} = \frac{1}{x_i \oplus y_j} \pmod{256}$$

The set of points $x_i$ and $y_j$ are chosen as:
- $y_j = j$ for $j \in [0, K-1]$
- $x_i = 255 - i$ for $i \in [0, M-1]$

This ensures $x$ and $y$ are disjoint, meaning any $K \times K$ submatrix of $G$ is invertible. 

### Erasure Recovery

1. The receiver buffers any incoming frame containing sequence index $s \in [1, K+M]$.
2. Once the receiver has collected **at least $K$ distinct shards**, it selects the first $K$ present shards.
3. It constructs a $K \times K$ recovery matrix $E$ by extracting the rows of $G$ corresponding to the received shard indices.
4. Using Gaussian Elimination in $GF(2^8)$, it computes the inverse matrix $E^{-1}$.
5. The original data vector $X$ is recovered by multiplying the inverse matrix by the received shard vector $Y$:

$$X = E^{-1} \cdot Y$$

This guarantees 100% data recovery from any combination of $K$ shards, making the simplex loop resilient to dropped frames.

---

## 4. Encryption & Compression Pipeline

To maximize throughput and ensure confidentiality, data passes through a deterministic sequence before sharding:

```
[ Raw Payload ]
       │
       ▼
 [ Gzip Compression ]
       │
       ▼
 [ AES-256-GCM Encryption ] (Optional)
       │
       ▼
 [ Reed-Solomon Splitting ] ──► [ Chunk Framing ]
```

### Key Derivation
The key is derived from the user passphrase using **PBKDF2-HMAC-SHA256** with **100,000 iterations** and a random 16-byte salt (transmitted in the metadata header).

### Authenticated Encryption
- **Cipher**: AES-256-GCM (Galois/Counter Mode).
- **IV**: 12-byte cryptographically secure random value generated per session.
- **Tag**: 16-byte authentication tag appended by the Web Crypto API, verified during decryption.
