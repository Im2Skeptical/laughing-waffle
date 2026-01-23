export function bumpInvVersion(inv) {
  inv.version = (inv.version ?? 0) + 1;
}
