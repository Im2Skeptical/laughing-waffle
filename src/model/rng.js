// rng.js — deterministic PRNG utilities

function _rngNextFloat(state) {
  let t = (state.rng.seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function _rngNextInt(state, min, max) {
  const a = Math.ceil(min);
  const b = Math.floor(max);
  return a + Math.floor(_rngNextFloat(state) * (b - a + 1));
}

function _rngNextFloatSeed(seedState) {
  let t = (seedState.seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function _rngNextIntSeed(seedState, min, max) {
  const a = Math.ceil(min);
  const b = Math.floor(max);
  return a + Math.floor(_rngNextFloatSeed(seedState) * (b - a + 1));
}

export function createRng(seed) {
  const seedState = {
    seed: Number.isFinite(seed) ? Math.floor(seed) : 0,
  };
  return {
    nextFloat: () => _rngNextFloatSeed(seedState),
    nextInt: (min, max) => _rngNextIntSeed(seedState, min, max),
  };
}

// Attaches helpers as runtime methods on state (not serializable).
// Stage 6 serialize/deserialize omits and reattaches these.
export function attachRngHelpers(state) {
  state.rngNextFloat = () => _rngNextFloat(state);
  state.rngNextInt = (min, max) => _rngNextInt(state, min, max);
}
