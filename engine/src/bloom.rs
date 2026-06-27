//! Bloom filter
//!
//! A Bloom filter is a tiny, clever structure that answers one question fast:
//! "have I *definitely never* seen this key?" It can give two answers:
//!
//!   - "definitely not present"  -> 100% certain, the key was never added
//!   - "probably present"        -> might be there, better go check for real
//!
//! It never says "no" by mistake (no false negatives), but it can occasionally
//! say "probably" when the answer is really no (a rare false positive). That
//! trade is exactly what we want: when looking up a key, we can skip reading an
//! entire SSTable file from disk the moment its Bloom filter says "definitely
//! not present." That saves a huge amount of slow disk work.
//!
//! How it works: we keep a row of bits (all 0 to start). To add a key we hash
//! it `k` different ways and set those `k` bits to 1. To test a key we hash it
//! the same `k` ways — if *any* of those bits is still 0, the key was never
//! added. If all are 1, it's "probably" there.

use std::io;

const FNV_OFFSET_A: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_OFFSET_B: u64 = 0x8422_2325_cbf2_9ce4;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// A simple Bloom filter sized for an expected number of keys.
#[derive(Clone)]
pub struct Bloom {
    bits: Vec<u8>, // the bit row, packed 8 bits per byte
    m: u64,        // total number of bits (always a multiple of 8)
    k: u32,        // how many hash functions / bits per key
}

impl Bloom {
    /// Build an empty filter sized for roughly `expected` keys, aiming for a low
    /// (~1%) false-positive rate: about 10 bits per key and 7 hash functions.
    pub fn new(expected: usize) -> Self {
        let bits_wanted = (expected.max(1) as u64) * 10;
        // Round up to a whole number of bytes, and never smaller than 64 bits.
        let m = bits_wanted.max(64).div_ceil(8) * 8;
        Bloom {
            bits: vec![0u8; (m / 8) as usize],
            m,
            k: 7,
        }
    }

    /// Record that `key` has been added.
    pub fn add(&mut self, key: &[u8]) {
        let (h1, h2) = Self::hashes(key);
        for i in 0..self.k as u64 {
            let bit = (h1.wrapping_add(i.wrapping_mul(h2))) % self.m;
            self.bits[(bit / 8) as usize] |= 1 << (bit % 8);
        }
    }

    /// Returns `false` only if `key` was *definitely* never added. A `true`
    /// answer means "probably present — go check the real data."
    pub fn maybe_contains(&self, key: &[u8]) -> bool {
        let (h1, h2) = Self::hashes(key);
        for i in 0..self.k as u64 {
            let bit = (h1.wrapping_add(i.wrapping_mul(h2))) % self.m;
            if self.bits[(bit / 8) as usize] & (1 << (bit % 8)) == 0 {
                return false;
            }
        }
        true
    }

    /// Serialize to bytes: [ m: 8 ][ k: 4 ][ bit bytes ]. Stored inside the
    /// SSTable file so the filter survives restarts.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(12 + self.bits.len());
        out.extend_from_slice(&self.m.to_le_bytes());
        out.extend_from_slice(&self.k.to_le_bytes());
        out.extend_from_slice(&self.bits);
        out
    }

    /// Rebuild a filter from the bytes produced by [`Bloom::to_bytes`].
    pub fn from_bytes(bytes: &[u8]) -> io::Result<Bloom> {
        if bytes.len() < 12 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Bloom: data too short",
            ));
        }
        let m = u64::from_le_bytes(bytes[0..8].try_into().unwrap());
        let k = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
        let bits = bytes[12..].to_vec();
        if bits.len() as u64 != m / 8 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Bloom: bit length does not match m",
            ));
        }
        Ok(Bloom { bits, m, k })
    }

    /// Two independent 64-bit hashes (FNV-1a with different starting values),
    /// combined by "double hashing" to cheaply produce `k` bit positions.
    fn hashes(key: &[u8]) -> (u64, u64) {
        let h1 = fnv1a(key, FNV_OFFSET_A);
        // Make the second hash odd so it never shares factors with m.
        let h2 = fnv1a(key, FNV_OFFSET_B) | 1;
        (h1, h2)
    }
}

/// Standard FNV-1a 64-bit hash with a customizable starting value.
fn fnv1a(data: &[u8], offset_basis: u64) -> u64 {
    let mut hash = offset_basis;
    for &byte in data {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}
