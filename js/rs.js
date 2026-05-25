// Galois Field GF(2^8) Reed-Solomon Erasure Coder
// Uses generator polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D)

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

// Initialize Galois Field tables
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11D;
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
  GF_LOG[0] = 0; // standard convention
})();

// Multiplication in GF(2^8)
function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// Division in GF(2^8)
function gfDiv(a, b) {
  if (a === 0) return 0;
  if (b === 0) throw new Error("Division by zero in GF(2^8)");
  let diff = GF_LOG[a] - GF_LOG[b];
  if (diff < 0) diff += 255;
  return GF_EXP[diff];
}

// Multiplicative inverse in GF(2^8)
function gfInv(a) {
  if (a === 0) throw new Error("Zero has no multiplicative inverse in GF(2^8)");
  return GF_EXP[255 - GF_LOG[a]];
}

// Gaussian elimination to invert an n x n matrix in GF(2^8)
function invertMatrix(mat, n) {
  const inv = Array.from({ length: n }, (_, i) => {
    const row = new Uint8Array(n);
    row[i] = 1;
    return row;
  });

  const a = mat.map(row => new Uint8Array(row));

  for (let i = 0; i < n; i++) {
    if (a[i][i] === 0) {
      let pivotRow = -1;
      for (let j = i + 1; j < n; j++) {
        if (a[j][i] !== 0) {
          pivotRow = j;
          break;
        }
      }
      if (pivotRow === -1) {
        throw new Error("Matrix is singular and cannot be inverted");
      }
      // Swap rows
      const tempA = a[i]; a[i] = a[pivotRow]; a[pivotRow] = tempA;
      const tempInv = inv[i]; inv[i] = inv[pivotRow]; inv[pivotRow] = tempInv;
    }

    const factor = gfInv(a[i][i]);
    for (let j = 0; j < n; j++) {
      a[i][j] = gfMul(a[i][j], factor);
      inv[i][j] = gfMul(inv[i][j], factor);
    }

    for (let j = 0; j < n; j++) {
      if (j !== i) {
        const mul = a[j][i];
        if (mul !== 0) {
          for (let k = 0; k < n; k++) {
            a[j][k] ^= gfMul(a[i][k], mul);
            inv[j][k] ^= gfMul(inv[i][k], mul);
          }
        }
      }
    }
  }

  return inv;
}

export class ReedSolomon {
  /**
   * @param {number} dataShards - Number of data shards (K)
   * @param {number} parityShards - Number of parity shards (M)
   */
  constructor(dataShards, parityShards) {
    if (dataShards <= 0 || parityShards < 0) {
      throw new Error("Invalid shard count");
    }
    if (dataShards + parityShards > 256) {
      throw new Error("Total shards (K + M) cannot exceed 256");
    }

    this.dataShards = dataShards;
    this.parityShards = parityShards;

    // Precompute Cauchy Generator matrix (M x K)
    // We choose disjoint sets: y_j = j, x_i = 255 - i
    this.cauchyMatrix = [];
    for (let i = 0; i < parityShards; i++) {
      const row = new Uint8Array(dataShards);
      const x = 255 - i;
      for (let j = 0; j < dataShards; j++) {
        const y = j;
        row[j] = gfInv(x ^ y); // Cauchy matrix entry: 1 / (x + y)
      }
      this.cauchyMatrix.push(row);
    }
  }

  /**
   * Encodes K data shards into K + M total shards.
   * @param {Uint8Array[]} shards - K Uint8Array data shards (each must have same length)
   * @returns {Uint8Array[]} K + M Uint8Array shards (first K are data, last M are parity)
   */
  encode(shards) {
    if (shards.length !== this.dataShards) {
      throw new Error(`Expected ${this.dataShards} shards, got ${shards.length}`);
    }
    const L = shards[0].length;
    const outputs = [];

    // Systematic part (0 to K-1)
    for (let i = 0; i < this.dataShards; i++) {
      if (shards[i].length !== L) {
        throw new Error("All shards must have the same length");
      }
      outputs.push(new Uint8Array(shards[i]));
    }

    // Parity part (K to K+M-1)
    for (let i = 0; i < this.parityShards; i++) {
      const parity = new Uint8Array(L);
      const row = this.cauchyMatrix[i];
      for (let j = 0; j < this.dataShards; j++) {
        const data = shards[j];
        const factor = row[j];
        if (factor !== 0) {
          for (let k = 0; k < L; k++) {
            parity[k] ^= gfMul(data[k], factor);
          }
        }
      }
      outputs.push(parity);
    }

    return outputs;
  }

  /**
   * Reconstructs the original K data shards from any K available shards.
   * @param {Uint8Array[]} shards - Array of K + M shards (missing shards should be null/undefined)
   * @param {boolean[]} shardPresent - Array of size K + M indicating if shard is present
   * @returns {Uint8Array[]} Reconstructed K data shards
   */
  decode(shards, shardPresent) {
    const presentIndices = [];
    for (let i = 0; i < shardPresent.length; i++) {
      if (shardPresent[i] && shards[i]) {
        presentIndices.push(i);
      }
    }

    if (presentIndices.length < this.dataShards) {
      throw new Error(`Insufficient shards: need ${this.dataShards}, got ${presentIndices.length}`);
    }

    // If the first K (data shards) are all present, we can just return them directly
    let allDataPresent = true;
    for (let i = 0; i < this.dataShards; i++) {
      if (!shardPresent[i]) {
        allDataPresent = false;
        break;
      }
    }
    if (allDataPresent) {
      const result = [];
      for (let i = 0; i < this.dataShards; i++) {
        result.push(new Uint8Array(shards[i]));
      }
      return result;
    }

    // We select the first K present shards to form our system of equations
    const selectedIndices = presentIndices.slice(0, this.dataShards);
    const L = shards[selectedIndices[0]].length;

    // Build submatrix E (K x K) from G
    const E = [];
    const subShards = [];
    for (let i = 0; i < this.dataShards; i++) {
      const idx = selectedIndices[i];
      subShards.push(shards[idx]);

      const row = new Uint8Array(this.dataShards);
      if (idx < this.dataShards) {
        row[idx] = 1; // Identity row
      } else {
        const cauchyRow = this.cauchyMatrix[idx - this.dataShards];
        for (let j = 0; j < this.dataShards; j++) {
          row[j] = cauchyRow[j];
        }
      }
      E.push(row);
    }

    // Invert submatrix E
    const invE = invertMatrix(E, this.dataShards);

    // Multiply invE by subShards to recover the original data shards
    const reconstructed = Array.from({ length: this.dataShards }, () => new Uint8Array(L));
    for (let i = 0; i < this.dataShards; i++) {
      const row = invE[i];
      const target = reconstructed[i];
      for (let j = 0; j < this.dataShards; j++) {
        const shardData = subShards[j];
        const factor = row[j];
        if (factor !== 0) {
          for (let k = 0; k < L; k++) {
            target[k] ^= gfMul(shardData[k], factor);
          }
        }
      }
    }

    return reconstructed;
  }
}
