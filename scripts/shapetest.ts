import { Match } from '../src/engine/sim';
import { buildTeam } from '../src/engine/formations';
const m = new Match(buildTeam('A', '4-3-3', 0), buildTeam('B', '4-4-2', 1), 1, 0.1);
const hist = (team: 0 | 1) => Object.entries(m.byTeam[team].reduce((a, p) => ((a[p.intent] = (a[p.intent] ?? 0) + 1), a), {} as Record<string, number>)).map(([k, v]) => `${k}×${v}`).join(', ');
const avgX = (team: 0 | 1) => m.byTeam[team].filter((p) => p.spec.role !== 'GK').reduce((s, p) => s + (team === 0 ? p.x : 105 - p.x), 0) / 10;
for (const [x, y, poss, label] of [[20, 34, 0, 'home build-up deep'], [60, 10, 0, 'home down the left wing'], [85, 34, 0, 'home attack in final third'], [70, 34, 1, 'away has it in home half']] as [number, number, 0 | 1, string][]) {
  for (let i = 0; i < 200; i++) { m.scriptBall(x, y, poss); m.step(0.1); }
  console.log(`\n${label}: ball (${x},${y}) poss=${poss === 0 ? 'home' : 'away'}  home shape depth ${avgX(0).toFixed(0)}m, away ${avgX(1).toFixed(0)}m`);
  console.log('  home:', hist(0)); console.log('  away:', hist(1));
}
