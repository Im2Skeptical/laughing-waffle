const FRAGMENT_SHADER = `
precision mediump float;
precision mediump int;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform highp vec4 inputSize;

uniform float u_timeSec;
uniform float u_intensity;
uniform float u_mottling;
uniform float u_warmth;
uniform float u_grain;
uniform float u_colorBleed;
uniform float u_timeWarp;
uniform float u_noiseScale;
uniform vec2 u_worldOffset;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = rot * p * 2.0 + vec2(100.0, 63.0);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vTextureCoord;
  vec2 texel = inputSize.zw;

  vec4 src = texture2D(uSampler, uv);
  if (src.a <= 0.0001) {
    gl_FragColor = src;
    return;
  }

  float alpha = max(src.a, 0.0001);
  vec3 srcStraight = src.rgb / alpha;

  float intensity = max(0.0, u_intensity);
  float warp = clamp(u_timeWarp, 0.0, 1.0);
  // Keep frontier motion calm; amplify drift mostly when time-warping.
  float drift = u_timeSec * (0.006 + warp * 0.03);
  vec2 driftVec = vec2(drift * 0.37, -drift * 0.23);
  float noiseScale = max(0.2, u_noiseScale);
  vec2 worldPx = uv * inputSize.xy + u_worldOffset;

  // Use world-space coordinates to avoid per-rectangle repetition.
  float bleedNoise = fbm((worldPx + driftVec * 24.0) / (92.0 / noiseScale)) * 2.0 - 1.0;
  float bleedStrength = max(0.0, u_colorBleed) * intensity;
  vec3 baseColor = srcStraight;
  if (bleedStrength > 0.0001) {
    vec2 bleedOffset =
      texel *
      vec2(bleedNoise, -bleedNoise * 0.7) *
      (2.4 + warp * 1.6) *
      bleedStrength;
    vec2 minUv = texel * 0.5;
    vec2 maxUv = vec2(1.0) - texel * 0.5;
    vec4 bleedSample = texture2D(uSampler, clamp(uv + bleedOffset, minUv, maxUv));
    float bleedAlpha = max(bleedSample.a, 0.0001);
    vec3 bleedStraight = bleedSample.rgb / bleedAlpha;
    float interiorMask =
      smoothstep(0.35, 0.95, src.a) *
      smoothstep(0.35, 0.95, bleedSample.a);
    float bleedMix = 0.24 * clamp(bleedStrength, 0.0, 1.0) * interiorMask;
    baseColor = mix(baseColor, bleedStraight, bleedMix);
  }

  float mottleNoise = fbm((worldPx + driftVec * 16.0) / (86.0 / noiseScale));
  baseColor *= 1.0 + (mottleNoise - 0.5) * (max(0.0, u_mottling) * intensity);

  float lum = dot(baseColor, vec3(0.299, 0.587, 0.114));
  float warmAmt = clamp(max(0.0, u_warmth) * intensity, 0.0, 1.2);
  vec3 desat = mix(baseColor, vec3(lum), 0.3 * warmAmt);
  vec3 paperTint = vec3(1.05, 0.98, 0.86);
  vec3 graded = desat * mix(vec3(1.0), paperTint, 0.9 * clamp(max(0.0, u_warmth), 0.0, 1.0));

  // Static paper grain to avoid frame-to-frame sparkle at normal speed.
  float grainA = hash(worldPx * (1.18 + noiseScale * 0.24));
  float grainB = hash(worldPx.yx * (0.74 + noiseScale * 0.11) + vec2(17.3, 9.1));
  float grain = (grainA * 0.7 + grainB * 0.3) * 2.0 - 1.0;
  graded += grain * (0.036 * max(0.0, u_grain) * intensity);

  float pulse = 0.5 + 0.5 * sin(u_timeSec * (0.6 + warp * 0.8));
  float warpTint = (pulse - 0.5) * warp * 0.06 * intensity;
  graded *= vec3(1.0 + warpTint, 1.0, 1.0 - warpTint * 0.35);

  float mixAmount = clamp(intensity, 0.0, 1.0);
  vec3 styled = mix(srcStraight, clamp(graded, 0.0, 1.0), mixAmount);
  gl_FragColor = vec4(styled * src.a, src.a);
}
`;

function toFinite(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function getPixiFilterCtor() {
  return globalThis?.PIXI?.Filter || null;
}

export function createMuchaPaintFilter(opts = {}) {
  const FilterCtor = getPixiFilterCtor();
  if (!FilterCtor) {
    throw new Error("PIXI.Filter is unavailable; Mucha paint filter cannot be created.");
  }

  const vertexSrc =
    typeof FilterCtor.defaultVertexSrc === "string"
      ? FilterCtor.defaultVertexSrc
      : undefined;

  return new FilterCtor(vertexSrc, FRAGMENT_SHADER, {
    u_timeSec: toFinite(opts.u_timeSec, 0),
    u_intensity: toFinite(opts.u_intensity, 1.0),
    u_mottling: toFinite(opts.u_mottling, 0.6),
    u_warmth: toFinite(opts.u_warmth, 0.7),
    u_grain: toFinite(opts.u_grain, 0.7),
    u_colorBleed: toFinite(opts.u_colorBleed, 0.4),
    u_timeWarp: toFinite(opts.u_timeWarp, 0),
    u_noiseScale: toFinite(opts.u_noiseScale, 1),
    u_worldOffset: [toFinite(opts.u_worldOffsetX, 0), toFinite(opts.u_worldOffsetY, 0)],
  });
}
