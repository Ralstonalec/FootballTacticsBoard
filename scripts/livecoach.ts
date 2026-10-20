import { Match } from '../src/engine/sim';
import { buildTeam } from '../src/engine/formations';

const m = new Match(buildTeam('A', '4-4-2', 0), buildTeam('B', '4-4-2', 1), 3, 0.1);
const defLine = () => {
  const d = m.byTeam[0].filter((p) => p.spec.role === 'CB' || p.spec.role === 'FB');
  return d.reduce((s, p) => s + p.x, 0) / d.length;
};
const avgOver = (secs: number) => { let sum = 0, n = 0; for (let i = 0; i < secs * 10; i++) { m.step(0.1); sum += defLine(); n++; } return sum / n; };
const base = avgOver(300);
m.coachTeam(0, { lineHeight: 1, compactness: 1 }, 'push the line');
const high = avgOver(300);
m.coachTeam(0, { lineHeight: 0, compactness: 1 }, 'drop the line');
const deep = avgOver(300);
console.log(`avg defensive-line x (m): base ${base.toFixed(1)} -> high line ${high.toFixed(1)} -> deep line ${deep.toFixed(1)}`);

// individual player: make the right winger stop pressing & hold, vs go free role; measure mean distance from base spot
const w = m.byTeam[0].find((p) => p.spec.role === 'W')!;
const spread = (secs: number) => { let s = 0, n = 0; for (let i = 0; i < secs * 10; i++) { m.step(0.1); s += Math.hypot(w.x - w.spec.x * 105, w.y - w.spec.y * 68); n++; } return s / n; };
m.coachPlayer(w.spec.id, { roam: 0, runs: 0, press: 0 }, 'hold');
const held = spread(300);
m.coachPlayer(w.spec.id, { roam: 1, runs: 1, press: 1 }, 'free');
const free = spread(300);
console.log(`winger mean distance from his spot (m): held ${held.toFixed(1)} -> free ${free.toFixed(1)}`);
console.log(held < free && high > deep + 5 ? 'LIVE COACHING HAS A MEASURABLE EFFECT' : 'NO EFFECT?');
