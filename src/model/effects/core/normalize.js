export function normalizeEffectSpec(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (raw.op) return raw;
  if (raw.kind) {
    const { kind, ...rest } = raw;
    return { op: kind, ...rest };
  }
  return null;
}
