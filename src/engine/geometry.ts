export const PW = 105; // pitch length (m)
export const PH = 68; // pitch width (m)
export const GOAL_W = 7.32;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** Team 0 attacks +x; team 1 attacks -x and sees the pitch mirrored. */
export function toWorld(team: 0 | 1, nx: number, ny: number): [number, number] {
  return team === 0 ? [nx * PW, ny * PH] : [(1 - nx) * PW, (1 - ny) * PH];
}

export function fromWorld(team: 0 | 1, wx: number, wy: number): [number, number] {
  return team === 0 ? [wx / PW, wy / PH] : [1 - wx / PW, 1 - wy / PH];
}

/** Distance from point to segment a-b. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
