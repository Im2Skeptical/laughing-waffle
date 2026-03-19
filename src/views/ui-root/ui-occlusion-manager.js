function isFiniteRect(rect) {
  return !!(
    rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function normalizeRect(rect) {
  if (!isFiniteRect(rect)) return null;
  return {
    x: Number(rect.x),
    y: Number(rect.y),
    width: Number(rect.width),
    height: Number(rect.height),
  };
}

function isPointInsideRect(point, rect) {
  if (!point || !rect) return false;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

export function createUiOcclusionManager() {
  let nextProviderId = 1;
  const providers = new Map();

  function registerProvider(getRects) {
    if (typeof getRects !== "function") {
      return () => {};
    }
    const providerId = nextProviderId;
    nextProviderId += 1;
    providers.set(providerId, getRects);
    return () => {
      providers.delete(providerId);
    };
  }

  function getRects() {
    const rects = [];
    for (const getRectsForProvider of providers.values()) {
      const rawRects = getRectsForProvider();
      if (!Array.isArray(rawRects)) continue;
      for (const rawRect of rawRects) {
        const rect = normalizeRect(rawRect);
        if (rect) rects.push(rect);
      }
    }
    return rects;
  }

  function isOccluded(point) {
    for (const rect of getRects()) {
      if (isPointInsideRect(point, rect)) return true;
    }
    return false;
  }

  return {
    registerProvider,
    getRects,
    isOccluded,
  };
}
