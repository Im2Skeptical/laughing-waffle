import { installSolidUiHitArea } from "../ui-helpers/solid-ui-hit-area.js";

export function createWindowManager({
  PIXI,
  layer,
  coreWidth,
  defaultOrigin,
  getTargetAnchorRect,
  getScreenSize,
  makeTargetRef,
  applyWindowScale,
  onBeforeDestroyWindow = null,
} = {}) {
  const windows = new Map();

  function positionWindow(win, origin, offsetIndex, force = false) {
    if (!win || (!force && win.hasPosition)) return;
    const baseX = Number.isFinite(origin?.x)
      ? origin.x
      : Number.isFinite(defaultOrigin?.x)
        ? defaultOrigin.x
        : 0;
    const baseY = Number.isFinite(origin?.y)
      ? origin.y
      : Number.isFinite(defaultOrigin?.y)
        ? defaultOrigin.y
        : 0;
    const idx = Number.isFinite(offsetIndex)
      ? Math.max(0, Math.floor(offsetIndex))
      : 0;
    const offset = 24 * idx;
    win.container.x = baseX + offset;
    win.container.y = baseY + offset;
    win.hasPosition = true;
  }

  function positionWindowAtAnchor(win) {
    if (!win || !win.anchorRect || win.hasPosition) return;
    const bounds = win.container?.getLocalBounds?.() ?? null;
    const scale = Number.isFinite(win?.uiScale) ? win.uiScale : 1;
    const width = Math.max(1, Math.floor((bounds?.width ?? coreWidth) * scale));
    const height = Math.max(1, Math.floor((bounds?.height ?? 140) * scale));
    const idx = Number.isFinite(win.offsetIndex)
      ? Math.max(0, Math.floor(win.offsetIndex))
      : 0;
    const offset = 24 * idx;

    let x = win.anchorRect.x + win.anchorRect.width / 2 - width / 2;
    let y = win.anchorRect.y + win.anchorRect.height + 12;
    x += offset;
    y += offset;

    const screen = getScreenSize?.() ?? { width: 0, height: 0 };
    const maxX = Math.max(8, screen.width - width - 8);
    const maxY = Math.max(8, screen.height - height - 8);
    x = Math.max(8, Math.min(maxX, x));
    y = Math.max(8, Math.min(maxY, y));

    win.container.x = Math.round(x);
    win.container.y = Math.round(y);
    win.hasPosition = true;
  }

  function ensureWindow(windowId, target, systemId, origin, offsetIndex, opts = {}) {
    if (!windowId) return null;
    const targetRef = makeTargetRef?.(target) ?? null;
    let win = windows.get(windowId);
    if (win) {
      if (targetRef) win.targetRef = targetRef;
      if (systemId != null) win.systemId = systemId;
      if (opts.groupKind) win.groupKind = opts.groupKind;
      applyWindowScale?.(win);
      return win;
    }

    const container = new PIXI.Container();
    container.zIndex = 130;
    layer.addChild(container);
    const solidHitArea = installSolidUiHitArea(container, () => {
      const bounds = container.getLocalBounds?.() ?? null;
      return {
        x: 0,
        y: 0,
        width: bounds?.width ?? coreWidth,
        height: bounds?.height ?? 140,
      };
    });

    const content = new PIXI.Container();
    container.addChild(content);

    win = {
      windowId,
      processId: opts.processId || null,
      group: opts.group === true,
      groupKind: opts.groupKind || null,
      targetRef,
      systemId: systemId || null,
      container,
      content,
      dropTargets: [],
      lastSignature: null,
      pinned: false,
      hovered: false,
      externalFocused: false,
      hasPosition: false,
      anchorRect: getTargetAnchorRect?.(target) ?? null,
      offsetIndex: Number.isFinite(offsetIndex) ? Math.floor(offsetIndex) : 0,
      idleFrames: 0,
      uiScale: 1,
      lastBounds: null,
      solidHitArea,
    };
    applyWindowScale?.(win);
    windows.set(windowId, win);
    if (!win.anchorRect) {
      positionWindow(win, origin, offsetIndex, true);
    } else {
      win.container.x = win.anchorRect.x;
      win.container.y = win.anchorRect.y + win.anchorRect.height + 12;
    }
    win.solidHitArea?.refresh?.();
    return win;
  }

  function hideWindow(windowId) {
    const win = windows.get(windowId);
    if (!win) return;
    win.pinned = false;
    win.hovered = false;
    if (win.container) win.container.visible = false;
  }

  function destroyWindow(windowId) {
    const win = windows.get(windowId);
    if (!win) return;
    onBeforeDestroyWindow?.(windowId, win, windows);
    win.solidHitArea?.destroy?.();
    win.container?.parent?.removeChild?.(win.container);
    win.container?.destroy?.({ children: true });
    windows.delete(windowId);
  }

  function setWindowPinned(windowId, pinned) {
    const win = windows.get(windowId);
    if (!win) return;
    win.pinned = !!pinned;
    if (!win.pinned && !win.hovered && !win.externalFocused) {
      win.container.visible = false;
    } else {
      win.container.visible = true;
    }
    win.lastSignature = null;
  }

  function togglePinnedWindow(windowId) {
    const win = windows.get(windowId);
    if (!win) return;
    setWindowPinned(windowId, !win.pinned);
  }

  function invalidateAllSignatures() {
    for (const win of windows.values()) {
      if (win) win.lastSignature = null;
    }
  }

  return {
    get: (windowId) => windows.get(windowId),
    values: () => windows.values(),
    entries: () => windows.entries(),
    ensureWindow,
    hideWindow,
    destroyWindow,
    setWindowPinned,
    togglePinnedWindow,
    positionWindowAtAnchor,
    invalidateAllSignatures,
  };
}
