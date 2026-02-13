// src/model/timegraph/sampling.js

import {
  FOCUS_ACTION_SAMPLE_MAX,
  FOCUS_NEAR_CURSOR_HALFSPAN_SEC,
  FOCUS_SAMPLE_MAX,
  FOCUS_SAMPLE_MIN,
  FOCUS_SAMPLE_TARGET,
  NORMAL_ACTION_SAMPLE_MAX,
  NORMAL_SAMPLE_MAX,
  NORMAL_SAMPLE_MIN,
  NORMAL_SAMPLE_TARGET,
  SAMPLING_BUCKET_SEC,
  SAMPLE_CACHE_MAX,
} from "./constants.js";
import { clampSec } from "./utils.js";
import {
  getActionSecondsInRange as getTimelineActionSecondsInRange,
  getActionSecondsInRangeSampled,
} from "../timeline/index.js";

export function getSamplingModeSignature(focus, windowSec) {
  const span = Math.max(1, Math.floor(windowSec ?? 0));
  const bucket = Math.max(1, Math.round(span / SAMPLING_BUCKET_SEC));
  return `${focus ? "focus" : "normal"}:${bucket}`;
}

export function resolveSampleTarget(focus) {
  if (focus) {
    return Math.max(
      FOCUS_SAMPLE_MIN,
      Math.min(FOCUS_SAMPLE_MAX, FOCUS_SAMPLE_TARGET)
    );
  }
  return Math.max(
    NORMAL_SAMPLE_MIN,
    Math.min(NORMAL_SAMPLE_MAX, NORMAL_SAMPLE_TARGET)
  );
}

export function addFillerSamples(sampleSet, startSec, endSec, count) {
  const start = clampSec(startSec);
  const end = clampSec(endSec);
  if (count <= 0 || end <= start) return;
  const span = end - start;
  const step = span / (count + 1);
  for (let i = 1; i <= count; i++) {
    const sec = Math.round(start + step * i);
    if (sec > start && sec < end) {
      sampleSet.add(sec);
    }
  }
}

export function addGridSamples(sampleSet, startSec, endSec, targetCount) {
  const start = clampSec(startSec);
  const end = clampSec(endSec);
  const target = Math.max(2, Math.floor(targetCount ?? 0));
  if (end <= start) return;

  const span = end - start;
  const rough = span / Math.max(1, target - 1);
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
  const candidates = [1, 2, 5, 10];
  let stride = candidates[candidates.length - 1] * pow10;
  for (const c of candidates) {
    const s = c * pow10;
    if (s >= rough) {
      stride = s;
      break;
    }
  }
  stride = Math.max(1, Math.floor(stride));

  // Anchor the grid to absolute timeline multiples so samples remain stable as
  // history grows (critical for t=0 anchored full-history views).
  const first = Math.ceil(start / stride) * stride;
  for (let sec = first; sec <= end; sec += stride) {
    sampleSet.add(sec);
  }
  sampleSet.add(end);
}

export function pickActionSecondsForSampling(
  actionSecs,
  { focus, cursorSec, startSec, endSec } = {}
) {
  const list = Array.isArray(actionSecs) ? actionSecs : [];
  if (!list.length) return [];

  const maxActions = focus ? FOCUS_ACTION_SAMPLE_MAX : NORMAL_ACTION_SAMPLE_MAX;
  if (list.length <= maxActions) return list.slice();

  const start = clampSec(startSec);
  const end = clampSec(endSec);
  const selected = new Set();

  // Stable coarse selection: bucket by absolute timeline range, so appending
  // actions near the frontier does not reshuffle historical selections.
  const span = Math.max(1, end - start + 1);
  const bucketSpan = Math.max(1, Math.ceil(span / maxActions));
  let idx = 0;
  for (
    let bucketStart = start;
    bucketStart <= end && selected.size < maxActions;
    bucketStart += bucketSpan
  ) {
    const bucketEnd = bucketStart + bucketSpan - 1;
    while (idx < list.length && list[idx] < bucketStart) idx++;
    let picked = -1;
    while (idx < list.length && list[idx] <= bucketEnd) {
      picked = list[idx];
      idx++;
    }
    if (picked >= 0) {
      selected.add(picked);
    }
  }

  selected.add(list[0]);
  selected.add(list[list.length - 1]);
  const cursor = Number.isFinite(cursorSec) ? clampSec(cursorSec) : null;
  const nearRadius = focus ? FOCUS_NEAR_CURSOR_HALFSPAN_SEC : 20;

  if (cursor != null) {
    for (let i = list.length - 1; i >= 0; i--) {
      const sec = list[i];
      if (Math.abs(sec - cursor) <= nearRadius) {
        selected.add(sec);
      }
    }
  }

  while (selected.size > maxActions) {
    // Keep boundaries; trim newest-to-oldest extras deterministically.
    const arr = Array.from(selected.values()).sort((a, b) => a - b);
    const candidate = arr[arr.length - 2];
    if (candidate == null || candidate === list[0]) break;
    selected.delete(candidate);
  }

  return Array.from(selected.values()).sort((a, b) => a - b);
}

export function buildSampleSeconds({
  startSec,
  endSec,
  historyEndSec,
  cursorSec,
  actionSecs,
  focus,
}) {
  const start = clampSec(startSec);
  const end = clampSec(endSec);
  if (end < start) return [];

  const samples = new Set([start, end]);
  const historyEnd = clampSec(historyEndSec ?? 0);
  if (historyEnd >= start && historyEnd <= end) samples.add(historyEnd);
  if (Number.isFinite(cursorSec)) {
    const cursor = clampSec(cursorSec);
    if (cursor >= start && cursor <= end) samples.add(cursor);
  }

  const sampledActionSecs = pickActionSecondsForSampling(actionSecs, {
    focus: !!focus,
    cursorSec,
    startSec: start,
    endSec: end,
  });

  for (const sec of sampledActionSecs) {
    const t = clampSec(sec);
    if (t >= start && t <= end) samples.add(t);
  }

  const target = resolveSampleTarget(!!focus);
  if (samples.size >= target) {
    return Array.from(samples.values()).sort((a, b) => a - b);
  }

  let remaining = target - samples.size;

  if (!focus) {
    addGridSamples(samples, start, end, target);
    // Keep non-focus sampling stable over time. In full-history mode, filler
    // redistribution causes sample-second churn every frontier advance, which
    // defeats value-cache reuse and scales render cost with large tSec.
    return Array.from(samples.values()).sort((a, b) => a - b);
  }

  if (focus && Number.isFinite(cursorSec)) {
    const cursor = clampSec(cursorSec);
    const focusStart = Math.max(start, cursor - FOCUS_NEAR_CURSOR_HALFSPAN_SEC);
    const focusEnd = Math.min(end, cursor + FOCUS_NEAR_CURSOR_HALFSPAN_SEC);
    if (focusEnd > focusStart) {
      const focusFill = Math.min(
        remaining,
        Math.max(0, Math.floor(target * 0.4))
      );
      addFillerSamples(samples, focusStart, focusEnd, focusFill);
      remaining = target - samples.size;
    }
  }

  if (remaining > 0) {
    addFillerSamples(samples, start, end, remaining);
  }

  return Array.from(samples.values()).sort((a, b) => a - b);
}

export function alignForecastSampleSeconds(seconds, historyEndSec, stepSec, endSec) {
  const step = Math.max(1, Math.floor(stepSec ?? 1));
  if (step <= 1) {
    return Array.isArray(seconds)
      ? Array.from(new Set(seconds.map((sec) => clampSec(sec)).values())).sort(
          (a, b) => a - b
        )
      : [];
  }

  const historyEnd = clampSec(historyEndSec);
  const end = clampSec(endSec);
  const aligned = new Set();

  for (const secRaw of seconds || []) {
    const sec = clampSec(secRaw);
    if (sec <= historyEnd) {
      aligned.add(sec);
      continue;
    }

    let snapped = Math.floor(sec / step) * step;
    if (snapped <= historyEnd) {
      snapped = Math.ceil((historyEnd + 1) / step) * step;
    }
    if (snapped > end) {
      snapped = end;
    }
    aligned.add(snapped);
  }

  return Array.from(aligned.values()).sort((a, b) => a - b);
}

export function collectHistorySampleSeconds(historyEndSec, strideSec) {
  const end = clampSec(historyEndSec);
  const stride = Math.max(1, Math.floor(strideSec ?? 1));
  const secs = [];
  for (let sec = 0; sec <= end; sec += stride) {
    secs.push(sec);
  }
  if (!secs.length || secs[secs.length - 1] !== end) {
    secs.push(end);
  }
  return secs;
}

export function collectActionSecondsInRange(tl, startSec, endSec) {
  return getTimelineActionSecondsInRange(tl, startSec, endSec, { copy: false });
}

export function collectActionSecondsForSampling(
  tl,
  startSec,
  endSec,
  { focus = false, cursorSec = null } = {}
) {
  const baseCap =
    (focus ? FOCUS_ACTION_SAMPLE_MAX : NORMAL_ACTION_SAMPLE_MAX) * 6;
  const sampled = getActionSecondsInRangeSampled(tl, startSec, endSec, baseCap, {
    copy: false,
  });

  if (!Number.isFinite(cursorSec)) return sampled;

  const radiusSec = focus ? FOCUS_NEAR_CURSOR_HALFSPAN_SEC * 2 : 30;
  const near = getTimelineActionSecondsInRange(
    tl,
    cursorSec - radiusSec,
    cursorSec + radiusSec,
    { copy: false }
  );
  if (!near.length) return sampled;

  const merged = new Set(sampled);
  for (const sec of near) merged.add(sec);
  return Array.from(merged.values()).sort((a, b) => a - b);
}

export function collectHistorySampleSecondsInRange(tl, startSec, endSec, strideSec) {
  const start = clampSec(startSec);
  const end = clampSec(endSec);
  if (end < start) return [];
  const stride = Math.max(1, Math.floor(strideSec ?? 1));
  const secs = [];
  for (let sec = start; sec <= end; sec += stride) {
    secs.push(sec);
  }
  if (!secs.length || secs[secs.length - 1] !== end) {
    secs.push(end);
  }
  const actionSecs = collectActionSecondsInRange(tl, start, end);
  if (!actionSecs.length) return secs;
  const merged = new Set(secs);
  for (const sec of actionSecs) merged.add(sec);
  merged.add(end);
  return Array.from(merged.values()).sort((a, b) => a - b);
}

export function shouldCacheForecastSec(sec, historyEndSec) {
  return clampSec(sec) > clampSec(historyEndSec);
}

export function cacheSampleSeconds(sampleCache, key, secs) {
  if (!sampleCache || key == null) return;
  sampleCache.delete(key);
  sampleCache.set(key, secs);
  while (sampleCache.size > SAMPLE_CACHE_MAX) {
    const oldest = sampleCache.keys().next().value;
    if (oldest == null) break;
    sampleCache.delete(oldest);
  }
}
