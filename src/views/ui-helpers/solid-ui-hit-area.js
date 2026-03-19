function sanitizeRect(rect) {
  if (
    !rect ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }
  return {
    x: Math.floor(rect.x),
    y: Math.floor(rect.y),
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height)),
  };
}

export function installSolidUiHitArea(container, getLocalRect) {
  if (!container || typeof getLocalRect !== "function") {
    return {
      refresh() {},
      destroy() {},
    };
  }

  container.eventMode = "static";
  if (container.interactiveChildren == null) {
    container.interactiveChildren = true;
  }

  function refresh() {
    const rect = sanitizeRect(getLocalRect());
    if (!rect) {
      container.hitArea = null;
      return null;
    }
    container.hitArea = new PIXI.Rectangle(rect.x, rect.y, rect.width, rect.height);
    return rect;
  }

  function destroy() {}

  refresh();

  return {
    refresh,
    destroy,
  };
}
