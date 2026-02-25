// constants.js
// Shared constants for skill tree Pixi view.

export const DEFAULT_NODE_RADIUS = 24;
export const DEFAULT_NOTABLE_RADIUS = 34;
export const MIN_NODE_RADIUS = 10;
export const MAX_NODE_RADIUS = 72;

export const EDGE_COLOR = 0x4b5875;
export const EDGE_ALPHA = 0.8;
export const EDGE_LANE_MIN_DEGREE = 3;
export const EDGE_LANE_STEP_MEDIUM = 11;
export const EDGE_LANE_STEP_DENSE = 14;
export const EDGE_ENDPOINT_LANE_SCALE = 0.38;
export const EDGE_CURVE_MAX_OFFSET = 64;

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 2.4;

export const EDGE_MODE_ALL = "all";
export const EDGE_MODE_FOCUS = "focus";
export const EDGE_MODE_PROGRESS = "progress";
export const EDGE_MODE_ORDER = [EDGE_MODE_ALL, EDGE_MODE_FOCUS, EDGE_MODE_PROGRESS];
