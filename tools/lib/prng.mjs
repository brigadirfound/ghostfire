/** Stable FNV-1a seed + Mulberry32 generator for reproducible content tools. */
export function seedFromString(value) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(String(value))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 0x6d2b79f5;
}

export function createSeededRandom(seed) {
  let state = typeof seed === 'number' ? seed >>> 0 : seedFromString(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
