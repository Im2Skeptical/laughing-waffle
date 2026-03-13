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
uniform float u_vintageAmount;
uniform float u_grain;
uniform float u_colorBleed;
uniform float u_timeWarp;
uniform float u_noiseScale;
uniform float u_wobbleAmount;
uniform float u_wobbleScale;
uniform float u_wobbleSpeed;
uniform float u_misregisterMode;
uniform float u_vignetteStrength;
uniform float u_vignetteInner;
uniform float u_vignetteOuter;
uniform float u_worldSpaceMode;
uniform vec2 u_stageSize;
uniform vec2 u_worldOffset;
uniform vec2 u_cameraPosition;
uniform float u_cameraScale;
uniform vec4 u_worldBounds;

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

// Time-evolving domain warp that morphs patterns instead of scrolling them.
vec2 phaseWarp(vec2 p, float t, float scale) {
  vec2 q = p / max(scale, 0.001);
  float n1 = fbm(
    q * 1.13 + vec2(sin(t * 0.41) * 2.3, cos(t * 0.37) * 2.1)
  );
  float n2 = fbm(
    q.yx * 1.07 + vec2(cos(t * 0.53) * 1.9, sin(t * 0.47) * 2.4)
  );
  return vec2(n1 - 0.5, n2 - 0.5);
}

void main() {
  vec2 uv = vTextureCoord;
  vec2 texel = inputSize.zw;
  vec2 minUv = texel * 0.5;
  vec2 maxUv = vec2(1.0) - texel * 0.5;

  vec4 srcCenter = texture2D(uSampler, uv);
  if (srcCenter.a <= 0.0001) {
    gl_FragColor = srcCenter;
    return;
  }

  float centerAlpha = max(srcCenter.a, 0.0001);
  vec3 centerStraight = srcCenter.rgb / centerAlpha;

  float intensity = max(0.0, u_intensity);
  float warp = clamp(u_timeWarp, 0.0, 1.0);
  float noiseScale = max(0.2, u_noiseScale);
  vec2 stageSize = max(u_stageSize, vec2(1.0));
  vec2 screenPx = vec2(gl_FragCoord.x, stageSize.y - gl_FragCoord.y);
  float worldSpaceMode = step(0.5, u_worldSpaceMode);
  float safeCameraScale = max(0.0001, u_cameraScale);
  vec2 worldPx = mix(
    screenPx,
    (screenPx - u_cameraPosition) / safeCameraScale,
    worldSpaceMode
  );

  // Organic wobble affects sampling fields only (not geometry).
  float wobbleAmount = max(0.0, u_wobbleAmount);
  float wobbleScale = max(0.1, u_wobbleScale);
  float wobbleSpeed = max(0.0, u_wobbleSpeed);
  float wobbleTime = u_timeSec * wobbleSpeed;
  float evolveTime = wobbleTime * (0.65 + warp * 0.9);
  vec2 wobbleBase = worldPx / (48.0 / wobbleScale);
  vec2 wobbleDomainWarp =
    phaseWarp(worldPx, evolveTime, 64.0 / wobbleScale) *
    (1.1 + wobbleAmount * 1.8);
  float wobbleField = fbm(
    wobbleBase +
    wobbleDomainWarp +
    vec2(sin(evolveTime * 0.31), cos(evolveTime * 0.27)) * 0.35
  );
  float wobblePhase = (wobbleField - 0.5) * wobbleAmount;
  vec2 wobbleOffset =
    texel *
    vec2(wobblePhase, -wobblePhase * 0.8) *
    (1.4 + warp * 1.6);
  vec2 wobbleUv = clamp(uv + wobbleOffset, minUv, maxUv);
  vec4 srcWobble = texture2D(uSampler, wobbleUv);
  float wobbleAlpha = max(srcWobble.a, 0.0001);
  vec3 wobbleStraight = srcWobble.rgb / wobbleAlpha;
  vec3 baseColor = mix(centerStraight, wobbleStraight, clamp(wobbleAmount * 0.45, 0.0, 0.45));

  // Classic lithographic RGB split with edge-safe alpha masking.
  float misregister = max(0.0, u_colorBleed) * intensity;
  if (u_misregisterMode > 0.5 && misregister > 0.0001) {
    vec2 splitDomainWarp = phaseWarp(worldPx, evolveTime + 3.7, 82.0 / noiseScale) * 1.6;
    float splitNoise = fbm((worldPx / (78.0 / noiseScale)) + splitDomainWarp);
    float theta = splitNoise * 6.28318530718;
    vec2 dir = vec2(cos(theta), sin(theta));
    float splitMag = (0.7 + warp * 0.8) * misregister;

    vec2 offR = texel * dir * 2.2 * splitMag;
    vec2 offG = texel * dir * -1.4 * splitMag;
    vec2 offB = texel * dir * 1.1 * splitMag;

    vec4 rs = texture2D(uSampler, clamp(wobbleUv + offR, minUv, maxUv));
    vec4 gs = texture2D(uSampler, clamp(wobbleUv + offG, minUv, maxUv));
    vec4 bs = texture2D(uSampler, clamp(wobbleUv + offB, minUv, maxUv));
    float rr = rs.a > 0.0001 ? rs.r / rs.a : 0.0;
    float gg = gs.a > 0.0001 ? gs.g / gs.a : 0.0;
    float bb = bs.a > 0.0001 ? bs.b / bs.a : 0.0;
    vec3 splitColor = vec3(rr, gg, bb);

    float edgeMask =
      smoothstep(0.42, 0.96, srcCenter.a) *
      smoothstep(0.42, 0.96, rs.a) *
      smoothstep(0.42, 0.96, gs.a) *
      smoothstep(0.42, 0.96, bs.a);
    float splitMix = 0.28 * clamp(misregister, 0.0, 1.0) * edgeMask;
    baseColor = mix(baseColor, splitColor, splitMix);
  }

  vec2 mottleDomainWarp = phaseWarp(worldPx, evolveTime + 8.1, 94.0 / noiseScale) * 1.4;
  float mottleNoise = fbm((worldPx / (86.0 / noiseScale)) + mottleDomainWarp);
  baseColor *= 1.0 + (mottleNoise - 0.5) * (max(0.0, u_mottling) * intensity);

  float warmth = clamp(max(0.0, u_warmth), 0.0, 1.0);
  float vintage = clamp(u_vintageAmount, 0.0, 1.0);
  float lum = dot(baseColor, vec3(0.299, 0.587, 0.114));
  float desatAmount = clamp(0.16 * warmth + 0.46 * vintage, 0.0, 0.85);
  vec3 desat = mix(baseColor, vec3(lum), desatAmount);
  vec3 paperTint = vec3(1.05, 0.98, 0.86);
  float paperTintAmount = clamp(0.2 * warmth + 0.6 * vintage, 0.0, 1.0);
  vec3 graded = desat * mix(vec3(1.0), paperTint, paperTintAmount);

  float grainA = hash(worldPx * (1.22 + noiseScale * 0.22));
  float grainB = hash(worldPx.yx * (0.79 + noiseScale * 0.1) + vec2(17.3, 9.1));
  float grain = (grainA * 0.7 + grainB * 0.3) * 2.0 - 1.0;
  graded += grain * (0.03 * max(0.0, u_grain) * intensity * (0.6 + vintage * 0.6));

  vec2 stageUv = clamp(screenPx / stageSize, vec2(0.0), vec2(1.0));
  if (worldSpaceMode > 0.5) {
    vec2 worldBoundsSize = max(u_worldBounds.zw, vec2(1.0));
    stageUv = clamp(
      (worldPx - u_worldBounds.xy) / worldBoundsSize,
      vec2(0.0),
      vec2(1.0)
    );
  }
  float vignetteInner = clamp(u_vignetteInner, 0.0, 0.95);
  float vignetteOuter = clamp(
    max(u_vignetteOuter, vignetteInner + 0.01),
    vignetteInner + 0.01,
    1.4
  );
  float vignetteDist = distance(stageUv, vec2(0.5, 0.5));
  float vignetteMask = smoothstep(vignetteInner, vignetteOuter, vignetteDist);
  float vignetteStrength =
    clamp(u_vignetteStrength, 0.0, 1.0) * (0.5 + vintage * 0.5);
  graded *= 1.0 - vignetteMask * vignetteStrength;

  float pulse = 0.5 + 0.5 * sin(u_timeSec * (0.35 + warp * 0.55));
  float warpTint = (pulse - 0.5) * warp * 0.035 * intensity;
  graded *= vec3(1.0 + warpTint, 1.0, 1.0 - warpTint * 0.28);

  float mixAmount = clamp(intensity, 0.0, 1.2);
  vec3 styled = mix(centerStraight, clamp(graded, 0.0, 1.0), mixAmount);
  gl_FragColor = vec4(styled * srcCenter.a, srcCenter.a);
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
    u_intensity: toFinite(opts.u_intensity, 1),
    u_mottling: toFinite(opts.u_mottling, 0.6),
    u_warmth: toFinite(opts.u_warmth, 0.7),
    u_vintageAmount: toFinite(opts.u_vintageAmount, 0.7),
    u_grain: toFinite(opts.u_grain, 0.7),
    u_colorBleed: toFinite(opts.u_colorBleed, 0.2),
    u_timeWarp: toFinite(opts.u_timeWarp, 0),
    u_noiseScale: toFinite(opts.u_noiseScale, 1),
    u_wobbleAmount: toFinite(opts.u_wobbleAmount, 0.14),
    u_wobbleScale: toFinite(opts.u_wobbleScale, 1.5),
    u_wobbleSpeed: toFinite(opts.u_wobbleSpeed, 0.5),
    u_misregisterMode: toFinite(opts.u_misregisterMode, 1),
    u_vignetteStrength: toFinite(opts.u_vignetteStrength, 0.08),
    u_vignetteInner: toFinite(opts.u_vignetteInner, 0.38),
    u_vignetteOuter: toFinite(opts.u_vignetteOuter, 0.92),
    u_worldSpaceMode: toFinite(opts.u_worldSpaceMode, 0),
    u_stageSize: [
      toFinite(opts.u_stageSizeX, 1),
      toFinite(opts.u_stageSizeY, 1),
    ],
    u_worldOffset: [
      toFinite(opts.u_worldOffsetX, 0),
      toFinite(opts.u_worldOffsetY, 0),
    ],
    u_cameraPosition: [
      toFinite(opts.u_cameraPositionX, 0),
      toFinite(opts.u_cameraPositionY, 0),
    ],
    u_cameraScale: toFinite(opts.u_cameraScale, 1),
    u_worldBounds: [
      toFinite(opts.u_worldBoundsX, 0),
      toFinite(opts.u_worldBoundsY, 0),
      toFinite(opts.u_worldBoundsWidth, 1),
      toFinite(opts.u_worldBoundsHeight, 1),
    ],
  });
}
