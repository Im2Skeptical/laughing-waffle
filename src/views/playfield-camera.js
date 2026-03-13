import {
  VIEWPORT_DESIGN_HEIGHT,
  VIEWPORT_DESIGN_WIDTH,
} from "./layout-pixi.js";

const DEFAULT_SURFACE_HALF_SIZE = 20000;
const DEFAULT_PAN_BOUNDS = Object.freeze({
  width: VIEWPORT_DESIGN_WIDTH * 2,
  height: VIEWPORT_DESIGN_HEIGHT * 2,
  centerX: VIEWPORT_DESIGN_WIDTH * 0.5,
  centerY: VIEWPORT_DESIGN_HEIGHT * 0.5,
});

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function clampZoom(scale, minZoom, maxZoom) {
  return clamp(scale, minZoom, maxZoom);
}

export function computeWorldPointAtScreenPoint(screenPoint, cameraState) {
  const point = screenPoint && typeof screenPoint === "object" ? screenPoint : {};
  const camera = cameraState && typeof cameraState === "object" ? cameraState : {};
  const scale = Number.isFinite(camera.scale) ? camera.scale : 1;
  const x = Number.isFinite(camera.x) ? camera.x : 0;
  const y = Number.isFinite(camera.y) ? camera.y : 0;
  return {
    x: (Number(point.x) - x) / scale,
    y: (Number(point.y) - y) / scale,
  };
}

export function computeScreenPointForWorldPoint(worldPoint, cameraState) {
  const point = worldPoint && typeof worldPoint === "object" ? worldPoint : {};
  const camera = cameraState && typeof cameraState === "object" ? cameraState : {};
  const scale = Number.isFinite(camera.scale) ? camera.scale : 1;
  const x = Number.isFinite(camera.x) ? camera.x : 0;
  const y = Number.isFinite(camera.y) ? camera.y : 0;
  return {
    x: Number(point.x) * scale + x,
    y: Number(point.y) * scale + y,
  };
}

export function computeZoomAtPoint(cameraState, screenPoint, factor, zoomLimits) {
  const camera = cameraState && typeof cameraState === "object" ? cameraState : {};
  const point = screenPoint && typeof screenPoint === "object" ? screenPoint : {};
  const prevScale = Number.isFinite(camera.scale) ? camera.scale : 1;
  const nextScale = clampZoom(
    prevScale * Number(factor || 1),
    Number.isFinite(zoomLimits?.minZoom) ? zoomLimits.minZoom : prevScale,
    Number.isFinite(zoomLimits?.maxZoom) ? zoomLimits.maxZoom : prevScale
  );
  if (Math.abs(nextScale - prevScale) < 0.0001) {
    return {
      scale: prevScale,
      x: Number.isFinite(camera.x) ? camera.x : 0,
      y: Number.isFinite(camera.y) ? camera.y : 0,
    };
  }
  const world = computeWorldPointAtScreenPoint(point, camera);
  return {
    scale: nextScale,
    x: Number(point.x) - world.x * nextScale,
    y: Number(point.y) - world.y * nextScale,
  };
}

export function resolvePanBounds(layout = null) {
  const panBounds =
    layout?.panBounds && typeof layout.panBounds === "object"
      ? layout.panBounds
      : layout && typeof layout === "object"
        ? layout
        : null;
  const width = Number.isFinite(panBounds?.width)
    ? Math.max(VIEWPORT_DESIGN_WIDTH, Number(panBounds.width))
    : DEFAULT_PAN_BOUNDS.width;
  const height = Number.isFinite(panBounds?.height)
    ? Math.max(VIEWPORT_DESIGN_HEIGHT, Number(panBounds.height))
    : DEFAULT_PAN_BOUNDS.height;
  const centerX = Number.isFinite(panBounds?.centerX)
    ? Number(panBounds.centerX)
    : DEFAULT_PAN_BOUNDS.centerX;
  const centerY = Number.isFinite(panBounds?.centerY)
    ? Number(panBounds.centerY)
    : DEFAULT_PAN_BOUNDS.centerY;
  return {
    width,
    height,
    centerX,
    centerY,
    minX: centerX - width * 0.5,
    maxX: centerX + width * 0.5,
    minY: centerY - height * 0.5,
    maxY: centerY + height * 0.5,
  };
}

export function clampCameraToBounds(cameraState, viewportSize, panBounds) {
  const camera = cameraState && typeof cameraState === "object" ? cameraState : {};
  const bounds = resolvePanBounds({ panBounds });
  const scale = Number.isFinite(camera.scale) ? Math.max(0.001, camera.scale) : 1;
  const viewportWidth = Number.isFinite(viewportSize?.width)
    ? Math.max(1, Number(viewportSize.width))
    : VIEWPORT_DESIGN_WIDTH;
  const viewportHeight = Number.isFinite(viewportSize?.height)
    ? Math.max(1, Number(viewportSize.height))
    : VIEWPORT_DESIGN_HEIGHT;
  const minCameraX = viewportWidth - bounds.maxX * scale;
  const maxCameraX = -bounds.minX * scale;
  const minCameraY = viewportHeight - bounds.maxY * scale;
  const maxCameraY = -bounds.minY * scale;

  return {
    scale,
    x:
      minCameraX <= maxCameraX
        ? clamp(
            Number.isFinite(camera.x) ? camera.x : 0,
            minCameraX,
            maxCameraX
          )
        : (minCameraX + maxCameraX) * 0.5,
    y:
      minCameraY <= maxCameraY
        ? clamp(
            Number.isFinite(camera.y) ? camera.y : 0,
            minCameraY,
            maxCameraY
          )
        : (minCameraY + maxCameraY) * 0.5,
  };
}

export function isPointInsideRect(point, rect) {
  if (!point || !rect) return false;
  const x = Number(point.x);
  const y = Number(point.y);
  const rx = Number(rect.x);
  const ry = Number(rect.y);
  const rw = Number(rect.width);
  const rh = Number(rect.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (!Number.isFinite(rx) || !Number.isFinite(ry)) return false;
  if (!Number.isFinite(rw) || !Number.isFinite(rh) || rw <= 0 || rh <= 0) {
    return false;
  }
  return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
}

function toStageCoordsFromClient(app, clientX, clientY) {
  const view = app?.view;
  const screen = app?.screen;
  if (!view || !screen) return null;
  const rect = view.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((clientX - rect.left) * screen.width) / rect.width,
    y: ((clientY - rect.top) * screen.height) / rect.height,
  };
}

function drawGestureSurface(surface, screenWidth, screenHeight) {
  if (!surface) return;
  const width = Number.isFinite(screenWidth)
    ? Math.max(screenWidth, VIEWPORT_DESIGN_WIDTH)
    : VIEWPORT_DESIGN_WIDTH;
  const height = Number.isFinite(screenHeight)
    ? Math.max(screenHeight, VIEWPORT_DESIGN_HEIGHT)
    : VIEWPORT_DESIGN_HEIGHT;
  const halfWidth = Math.max(DEFAULT_SURFACE_HALF_SIZE, width * 8);
  const halfHeight = Math.max(DEFAULT_SURFACE_HALF_SIZE, height * 8);
  surface.clear();
  surface.beginFill(0xffffff, 0.001);
  surface.drawRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
  surface.endFill();
  surface.hitArea = new PIXI.Rectangle(
    -halfWidth,
    -halfHeight,
    halfWidth * 2,
    halfHeight * 2
  );
}

export function createPlayfieldCamera({
  app,
  root,
  layout = null,
  getFixedUiRects = null,
  canStartPan = null,
  canInteract = null,
} = {}) {
  const cameraLayout = layout && typeof layout === "object" ? layout : {};
  const minZoom = Number.isFinite(cameraLayout?.minZoom)
    ? cameraLayout.minZoom
    : 0.75;
  const maxZoom = Number.isFinite(cameraLayout?.maxZoom)
    ? cameraLayout.maxZoom
    : 1.8;
  const defaultZoom = clampZoom(
    Number.isFinite(cameraLayout?.defaultZoom) ? cameraLayout.defaultZoom : 1,
    minZoom,
    maxZoom
  );
  const wheelStep = Number.isFinite(cameraLayout?.wheelStep)
    ? Math.max(1.001, cameraLayout.wheelStep)
    : 1.1;
  const dragThresholdPx = Number.isFinite(cameraLayout?.dragThresholdPx)
    ? Math.max(0, cameraLayout.dragThresholdPx)
    : 3;
  const pinchMinDistancePx = Number.isFinite(cameraLayout?.pinchMinDistancePx)
    ? Math.max(1, cameraLayout.pinchMinDistancePx)
    : 8;
  const panBounds = resolvePanBounds(cameraLayout);
  const camera = {
    scale: defaultZoom,
    x: 0,
    y: 0,
  };
  const pan = {
    active: false,
    startGlobalX: 0,
    startGlobalY: 0,
    startX: 0,
    startY: 0,
    moved: false,
  };
  const pinch = {
    active: false,
    startScale: defaultZoom,
    startDistance: 0,
    anchorWorldX: 0,
    anchorWorldY: 0,
    moved: false,
  };

  const gestureSurface = new PIXI.Graphics();
  gestureSurface.eventMode = "static";
  gestureSurface.cursor = "grab";

  let stageMoveHandler = null;
  let stageUpHandler = null;

  function getEnabled() {
    return cameraLayout?.enabled !== false;
  }

  function canInteractNow() {
    if (!getEnabled()) return false;
    if (typeof canInteract === "function") return canInteract() !== false;
    return true;
  }

  function applyTransform() {
    if (!root) return;
    root.scale.set(camera.scale);
    root.position.set(Math.floor(camera.x), Math.floor(camera.y));
  }

  function setCamera(nextScale, nextX, nextY) {
    const clamped = clampCameraToBounds(
      {
        scale: clampZoom(nextScale, minZoom, maxZoom),
        x: Number.isFinite(nextX) ? nextX : camera.x,
        y: Number.isFinite(nextY) ? nextY : camera.y,
      },
      {
        width: app?.screen?.width,
        height: app?.screen?.height,
      },
      panBounds
    );
    camera.scale = clamped.scale;
    camera.x = clamped.x;
    camera.y = clamped.y;
    applyTransform();
  }

  function worldToScreen(point) {
    if (root && typeof root.toGlobal === "function" && point) {
      const globalPoint = root.toGlobal(point);
      if (
        globalPoint &&
        Number.isFinite(globalPoint.x) &&
        Number.isFinite(globalPoint.y)
      ) {
        return {
          x: globalPoint.x,
          y: globalPoint.y,
        };
      }
    }
    return computeScreenPointForWorldPoint(point, camera);
  }

  function screenToWorld(point) {
    if (root && typeof root.toLocal === "function" && point) {
      const localPoint = root.toLocal(point);
      if (
        localPoint &&
        Number.isFinite(localPoint.x) &&
        Number.isFinite(localPoint.y)
      ) {
        return {
          x: localPoint.x,
          y: localPoint.y,
        };
      }
    }
    return computeWorldPointAtScreenPoint(point, camera);
  }

  function reset() {
    endPan();
    resetPinchState();
    setCamera(defaultZoom, 0, 0);
  }

  function getFixedRects() {
    const rawRects =
      typeof getFixedUiRects === "function" ? getFixedUiRects() : [];
    return Array.isArray(rawRects) ? rawRects.filter(Boolean) : [];
  }

  function isFixedUiPoint(stageX, stageY) {
    const point = { x: stageX, y: stageY };
    for (const rect of getFixedRects()) {
      if (isPointInsideRect(point, rect)) return true;
    }
    return false;
  }

  function resize() {
    if (!root) return;
    if (!gestureSurface.parent) {
      root.addChildAt(gestureSurface, 0);
    } else if (root.getChildIndex(gestureSurface) !== 0) {
      root.setChildIndex(gestureSurface, 0);
    }
    drawGestureSurface(gestureSurface, app?.screen?.width, app?.screen?.height);
    applyTransform();
  }

  function zoomAtStagePoint(stagePoint, factor) {
    if (!stagePoint || isFixedUiPoint(stagePoint.x, stagePoint.y)) return;
    const next = computeZoomAtPoint(camera, stagePoint, factor, {
      minZoom,
      maxZoom,
    });
    setCamera(next.scale, next.x, next.y);
  }

  function onPanMove(ev) {
    if (!pan.active || pinch.active) return;
    const global = ev?.data?.global;
    if (!global) return;
    const dx = global.x - pan.startGlobalX;
    const dy = global.y - pan.startGlobalY;
    if (Math.abs(dx) > dragThresholdPx || Math.abs(dy) > dragThresholdPx) {
      pan.moved = true;
    }
    setCamera(camera.scale, pan.startX + dx, pan.startY + dy);
  }

  function unbindStagePanHandlers() {
    if (stageMoveHandler) app?.stage?.off?.("pointermove", stageMoveHandler);
    if (stageUpHandler) {
      app?.stage?.off?.("pointerup", stageUpHandler);
      app?.stage?.off?.("pointerupoutside", stageUpHandler);
      app?.stage?.off?.("pointercancel", stageUpHandler);
    }
    stageMoveHandler = null;
    stageUpHandler = null;
  }

  function endPan() {
    if (!pan.active) return;
    pan.active = false;
    pan.moved = false;
    gestureSurface.cursor = "grab";
    unbindStagePanHandlers();
  }

  function startPan(ev) {
    if (!canInteractNow() || pinch.active) return;
    if (typeof canStartPan === "function" && canStartPan() === false) return;
    const global = ev?.data?.global;
    if (!global) return;
    pan.active = true;
    pan.startGlobalX = global.x;
    pan.startGlobalY = global.y;
    pan.startX = camera.x;
    pan.startY = camera.y;
    pan.moved = false;
    gestureSurface.cursor = "grabbing";
    stageMoveHandler = onPanMove;
    stageUpHandler = () => endPan();
    app?.stage?.on?.("pointermove", stageMoveHandler);
    app?.stage?.on?.("pointerup", stageUpHandler);
    app?.stage?.on?.("pointerupoutside", stageUpHandler);
    app?.stage?.on?.("pointercancel", stageUpHandler);
    ev?.stopPropagation?.();
  }

  function resetPinchState() {
    pinch.active = false;
    pinch.startScale = camera.scale;
    pinch.startDistance = 0;
    pinch.anchorWorldX = 0;
    pinch.anchorWorldY = 0;
    pinch.moved = false;
  }

  function primePinchFromTouches(touchA, touchB) {
    const stageA = toStageCoordsFromClient(app, touchA?.clientX, touchA?.clientY);
    const stageB = toStageCoordsFromClient(app, touchB?.clientX, touchB?.clientY);
    if (!stageA || !stageB) return false;
    const centerX = (stageA.x + stageB.x) * 0.5;
    const centerY = (stageA.y + stageB.y) * 0.5;
    if (isFixedUiPoint(centerX, centerY)) return false;
    const distance = Math.hypot(stageA.x - stageB.x, stageA.y - stageB.y);
    if (!Number.isFinite(distance) || distance < pinchMinDistancePx) return false;
    const anchorWorld = screenToWorld({ x: centerX, y: centerY });
    pinch.active = true;
    pinch.startScale = camera.scale;
    pinch.startDistance = distance;
    pinch.anchorWorldX = anchorWorld.x;
    pinch.anchorWorldY = anchorWorld.y;
    pinch.moved = false;
    return true;
  }

  function updatePinchFromTouches(touchA, touchB) {
    if (!pinch.active) return;
    const stageA = toStageCoordsFromClient(app, touchA?.clientX, touchA?.clientY);
    const stageB = toStageCoordsFromClient(app, touchB?.clientX, touchB?.clientY);
    if (!stageA || !stageB) return;
    const centerX = (stageA.x + stageB.x) * 0.5;
    const centerY = (stageA.y + stageB.y) * 0.5;
    if (isFixedUiPoint(centerX, centerY)) return;
    const distance = Math.hypot(stageA.x - stageB.x, stageA.y - stageB.y);
    if (!Number.isFinite(distance) || distance < 1) return;
    const nextScale = clampZoom(
      pinch.startScale * (distance / Math.max(1, pinch.startDistance)),
      minZoom,
      maxZoom
    );
    const nextX = centerX - pinch.anchorWorldX * nextScale;
    const nextY = centerY - pinch.anchorWorldY * nextScale;
    if (
      Math.abs(nextScale - camera.scale) > 0.0001 ||
      Math.abs(nextX - camera.x) > 0.5 ||
      Math.abs(nextY - camera.y) > 0.5
    ) {
      pinch.moved = true;
    }
    setCamera(nextScale, nextX, nextY);
  }

  function handleWheel(ev) {
    if (!canInteractNow()) return;
    const stagePoint = toStageCoordsFromClient(app, ev?.clientX, ev?.clientY);
    if (!stagePoint) return;
    if (isFixedUiPoint(stagePoint.x, stagePoint.y)) return;
    ev.preventDefault?.();
    zoomAtStagePoint(stagePoint, ev.deltaY < 0 ? wheelStep : 1 / wheelStep);
  }

  function handleTouchStart(ev) {
    if (!canInteractNow()) return;
    const touches = ev?.touches;
    if (!touches || touches.length < 2) return;
    if (pan.active) endPan();
    if (primePinchFromTouches(touches[0], touches[1])) {
      ev.preventDefault?.();
    }
  }

  function handleTouchMove(ev) {
    if (!canInteractNow()) return;
    const touches = ev?.touches;
    if (!touches) return;
    if (touches.length < 2) {
      if (pinch.active) resetPinchState();
      return;
    }
    if (!pinch.active && !primePinchFromTouches(touches[0], touches[1])) {
      return;
    }
    updatePinchFromTouches(touches[0], touches[1]);
    ev.preventDefault?.();
  }

  function handleTouchEnd(ev) {
    if (!pinch.active) return;
    const touches = ev?.touches;
    if (touches && touches.length >= 2) {
      if (!primePinchFromTouches(touches[0], touches[1])) {
        resetPinchState();
      }
      ev?.preventDefault?.();
      return;
    }
    resetPinchState();
  }

  function destroy() {
    endPan();
    resetPinchState();
    gestureSurface.off?.("pointerdown", startPan);
    app?.view?.removeEventListener?.("wheel", handleWheel);
    app?.view?.removeEventListener?.("touchstart", handleTouchStart);
    app?.view?.removeEventListener?.("touchmove", handleTouchMove);
    app?.view?.removeEventListener?.("touchend", handleTouchEnd);
    app?.view?.removeEventListener?.("touchcancel", handleTouchEnd);
    gestureSurface.removeFromParent?.();
    gestureSurface.destroy?.();
  }

  resize();
  gestureSurface.on("pointerdown", startPan);
  app?.view?.addEventListener?.("wheel", handleWheel, { passive: false });
  app?.view?.addEventListener?.("touchstart", handleTouchStart, {
    passive: false,
  });
  app?.view?.addEventListener?.("touchmove", handleTouchMove, {
    passive: false,
  });
  app?.view?.addEventListener?.("touchend", handleTouchEnd, {
    passive: false,
  });
  app?.view?.addEventListener?.("touchcancel", handleTouchEnd, {
    passive: false,
  });

  return {
    applyTransform,
    resize,
    reset,
    screenToWorld,
    worldToScreen,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    startPan,
    endPan,
    isFixedUiPoint,
    destroy,
    getGestureSurface: () => gestureSurface,
    getCameraState: () => ({ ...camera }),
  };
}
