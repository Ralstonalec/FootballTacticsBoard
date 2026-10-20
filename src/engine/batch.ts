import { Match, TeamStats, emptyStats } from './sim';
import type { Team } from './types';

export interface Aggregate {
  n: number;
  wins: [number, number];
  draws: number;
  goals: [number, number];
  stats: [TeamStats, TeamStats]; // summed over matches
}

export const emptyAggregate = (): Aggregate => ({
  n: 0, wins: [0, 0], draws: 0, goals: [0, 0], stats: [emptyStats(), emptyStats()],
});

function addStats(a: TeamStats, b: TeamStats): void {
  for (const k of Object.keys(a) as (keyof TeamStats)[]) {
    const av = a[k];
    const bv = b[k];
    if (typeof av === 'number' && typeof bv === 'number') (a[k] as number) = av + bv;
    else if (Array.isArray(av) && Array.isArray(bv)) bv.forEach((v, i) => ((av as number[])[i] += v as number));
  }
}

export function addMatch(agg: Aggregate, m: Match): void {
  agg.n++;
  agg.goals[0] += m.score[0];
  agg.goals[1] += m.score[1];
  if (m.score[0] > m.score[1]) agg.wins[0]++;
  else if (m.score[1] > m.score[0]) agg.wins[1]++;
  else agg.draws++;
  addStats(agg.stats[0], m.stats[0]);
  addStats(agg.stats[1], m.stats[1]);
}

export function runBatchSync(home: Team, away: Team, n: number, seed = 1, dt = 0.2): Aggregate {
  const agg = emptyAggregate();
  for (let i = 0; i < n; i++) {
    const m = new Match(structuredClone(home), structuredClone(away), seed + i * 7919, dt);
    m.runToEnd();
    addMatch(agg, m);
  }
  return agg;
}

/** Runs matches in the background of the UI thread, yielding between matches. */
export async function runBatch(
  home: Team, away: Team, n: number, seed: number,
  onProgress?: (done: number, agg: Aggregate) => void, dt = 0.2,
): Promise<Aggregate> {
  const agg = emptyAggregate();
  for (let i = 0; i < n; i++) {
    const m = new Match(structuredClone(home), structuredClone(away), seed + i * 7919, dt);
    m.runToEnd();
    addMatch(agg, m);
    onProgress?.(i + 1, agg);
    await new Promise((r) => setTimeout(r, 0));
  }
  return agg;
}
