// Browser-native Compression Stream Wrapper

/**
 * Compresses data using the specified format.
 * @param {Uint8Array} data - The input data to compress.
 * @param {string} format - The compression format ('gzip' or 'deflate').
 * @returns {Promise<Uint8Array>} The compressed data.
 */
export async function compressData(data, format = 'gzip') {
  try {
    const stream = new Response(data).body.pipeThrough(new CompressionStream(format));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    console.error("Compression failed:", error);
    throw error;
  }
}

/**
 * Decompresses data using the specified format.
 * @param {Uint8Array} data - The compressed input data.
 * @param {string} format - The decompression format ('gzip' or 'deflate').
 * @returns {Promise<Uint8Array>} The decompressed data.
 */
export async function decompressData(data, format = 'gzip') {
  try {
    const stream = new Response(data).body.pipeThrough(new DecompressionStream(format));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    console.error("Decompression failed:", error);
    throw error;
  }
}
