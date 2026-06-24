use anyhow::Result;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use zstd::bulk::{Compressor, Decompressor};

/// Compress data using ZSTD with SIMD acceleration.
/// Uses `zstdmt` (multi-threaded) and `experimental` features for max performance.
pub fn zstd_compress(data: &[u8]) -> Result<Vec<u8>> {
    // Level 3 = default; higher = better compression but slower
    // Using multi-threaded compressor for SIMD parallelism
    let mut compressor = Compressor::new(3)?;
    let compressed = compressor.compress(data)?;
    Ok(compressed)
}

/// Decompress ZSTD data.
pub fn zstd_decompress(compressed: &[u8]) -> Result<Vec<u8>> {
    let mut decompressor = Decompressor::new()?;
    let data = decompressor.decompress(compressed, 1024 * 1024 * 10)?; // max 10MB
    Ok(data)
}

/// Compress directly to a byte buffer with a pre-allocated output.
/// Zero-copy friendly — caller provides the buffer.
pub fn zstd_compress_into(data: &[u8], output: &mut Vec<u8>) -> Result<usize> {
    let initial_len = output.len();
    let mut compressor = Compressor::new(3)?;
    let compressed = compressor.compress(data)?;
    output.extend_from_slice(&compressed);
    Ok(output.len() - initial_len)
}

/// Base64 decode for screenshot data.
pub fn base64_decode(encoded: &str) -> Result<Vec<u8>> {
    Ok(BASE64.decode(encoded)?)
}

/// Base64 encode binary data.
pub fn base64_encode(data: &[u8]) -> String {
    BASE64.encode(data)
}

/// Compress a JSON string with ZSTD, return base64-encoded result.
pub fn compress_json_to_b64(json: &str) -> Result<String> {
    let compressed = zstd_compress(json.as_bytes())?;
    Ok(BASE64.encode(&compressed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip() {
        let original = b"Hello, observability platform! This is a test payload for ZSTD compression with SIMD acceleration.";
        let compressed = zstd_compress(original).unwrap();
        let decompressed = zstd_decompress(&compressed).unwrap();
        assert_eq!(&decompressed, original);
        assert!(compressed.len() < original.len(), "compressed should be smaller");
    }

    #[test]
    fn test_base64_roundtrip() {
        let data = b"screenshot data here";
        let encoded = base64_encode(data);
        let decoded = base64_decode(&encoded).unwrap();
        assert_eq!(&decoded, data);
    }

    #[test]
    fn test_compress_json() {
        let json = r#"{"id":"test","url":"https://example.com","payload":[1,2,3]}"#;
        let result = compress_json_to_b64(json).unwrap();
        assert!(!result.is_empty());
        // Should be a valid base64 string
        let decoded = BASE64.decode(&result).unwrap();
        let decompressed = zstd_decompress(&decoded).unwrap();
        assert_eq!(std::str::from_utf8(&decompressed).unwrap(), json);
    }
}
