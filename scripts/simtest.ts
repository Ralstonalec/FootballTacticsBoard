import { buildTeam } from '../src/engine/formations';
import { runBatchSync } from '../src/engine/batch';

const n = Number(process.argv[2] ?? 20);
const a = process.argv[3] ?? '4-3-3';
const b = process.argv[4] ?? '4-4-2';
const t0 = Date.now();
const agg = runBatchSync(buildTeam('A', a, 0), buildTeam('B', b, 1), n, Number(process.argv[5] ?? 42));
const ms = Date.now() - t0;
const pm = (v: number) => (v / n).toFixed(2);
console.log(`${a} vs ${b}, ${n} matches in ${ms}ms (${(ms / n).toFixed(0)}ms/match)`);
console.log(`W-D-L: ${agg.wins[0]}-${agg.draws}-${agg.wins[1]}   goals/match: ${pm(agg.goals[0])} - ${pm(agg.goals[1])}`);
for (const i of [0, 1] as const) {
  const s = agg.stats[i];
  const poss = (s.possessionT / (agg.stats[0].possessionT + agg.stats[1].possessionT)) * 100;
  console.log(
    `team${i}: poss ${poss.toFixed(0)}%  shots ${pm(s.shots)}  onT ${pm(s.onTarget)}  xG ${pm(s.xg)}  passes ${pm(s.passes)} (${((s.passesDone / s.passes) * 100).toFixed(0)}%)` +
      `  tackles ${pm(s.tackles)}  int ${pm(s.interceptions)}  hiRec ${pm(s.highRecoveries)}  f3 ${pm(s.finalThirdEntries)}  counterShots ${pm(s.counterShots)}  chan ${s.xgByChannel.map((v) => pm(v)).join('/')}`,
  );
}
