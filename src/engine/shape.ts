import type { Match, SimPlayer, TeamIdx } from './sim';
import { PW } from './geometry';

const own = (team: TeamIdx, x: number) => (team === 0 ? x : PW - x);

/** Outfield players grouped into lines by depth (own-goal-first). */
export function lineClusters(m: Match, team: TeamIdx): SimPlayer[][] {
  const ps = m.byTeam[team].filter((p) => p.spec.role !== 'GK').sort((a, b) => own(team, a.x) - own(team, b.x));
  const lines: SimPlayer[][] = [];
  for (const p of ps) {
    const last = lines[lines.length - 1];
    if (last && own(team, p.x) - own(team, last[last.length - 1].x) < 11) last.push(p);
    else lines.push([p]);
  }
  return lines;
}

export function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export interface ShapeMetrics {
  length: number; // back-to-front depth of the outfield block (m)
  width: number; // side-to-side spread (m)
  lineHeights: number[]; // average distance of each line from own goal (m)
  gaps: number[]; // distance between consecutive lines (m)
}

export function shapeMetrics(m: Match, team: TeamIdx): ShapeMetrics {
  const out = m.byTeam[team].filter((p) => p.spec.role !== 'GK');
  if (!out.length) return { length: 0, width: 0, lineHeights: [], gaps: [] };
  const xs = out.map((p) => own(team, p.x));
  const ys = out.map((p) => p.y);
  const lineHeights = lineClusters(m, team).map((l) => l.reduce((s, p) => s + own(team, p.x), 0) / l.length);
  return {
    length: Math.max(...xs) - Math.min(...xs),
    width: Math.max(...ys) - Math.min(...ys),
    lineHeights,
    gaps: lineHeights.slice(1).map((h, i) => h - lineHeights[i]),
  };
}

export function intentHistogram(m: Match, team: TeamIdx): Record<string, number> {
  const h: Record<string, number> = {};
  for (const p of m.byTeam[team]) h[p.intent] = (h[p.intent] ?? 0) + 1;
  return h;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
export function snapshotTeam(m: Match, team: TeamIdx) {
  const s = shapeMetrics(m, team);
  return { length: r1(s.length), width: r1(s.width), lineHeights: s.lineHeights.map(r1), gaps: s.gaps.map(r1), doing: intentHistogram(m, team) };
}
