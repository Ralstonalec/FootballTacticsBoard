import type { Instructions, Team, TeamTactics } from './types';
import type { Aggregate } from './batch';
import type { Match } from './sim';
import { SYSTEM, type AIMode } from '../../api/_prompts';

const ENDPOINT = '/api/claude';

export interface AIStatus { server: boolean; browserKey: boolean }

/** Is the Vercel function reachable and configured? (false in plain `vite dev`.) */
export async function probeServer(): Promise<boolean> {
  try {
    const r = await fetch(ENDPOINT);
    if (!r.ok) return false;
    const j = await r.json();
    return j.configured === true;
  } catch {
    return false;
  }
}

async function callAI(mode: AIMode, content: string, browserKey?: { apiKey: string; model: string }): Promise<string> {
  if (!browserKey?.apiKey) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, content }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `AI request failed (${res.status})`);
    return data.text as string;
  }
  // Local-development fallback: call Anthropic directly with a key the user pasted into the browser.
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': browserKey.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: browserKey.model, max_tokens: mode === 'coach' ? 700 : 1200, system: SYSTEM[mode], messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg += ' ' + ((await res.json()).error?.message ?? ''); } catch { /* ignore */ }
    throw new Error(`Claude API error: ${msg}`);
  }
  const data = await res.json();
  return (data.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n');
}

function compact(team: Team, match: Match | null, teamIdx: 0 | 1) {
  return {
    name: team.name,
    tactics: team.tactics,
    players: team.players.map((p, i) => {
      const live = match?.findPlayer(p.id);
      const pos = live
        ? { x: +(teamIdx === 0 ? live.x / 105 : 1 - live.x / 105).toFixed(2), y: +(teamIdx === 0 ? live.y / 68 : 1 - live.y / 68).toFixed(2) }
        : { x: +p.x.toFixed(2), y: +p.y.toFixed(2) };
      return {
        n: i + 1, role: p.role, ...pos,
        roam: p.inst.roam, press: p.inst.press, runs: p.inst.runs, dribble: p.inst.dribble,
        shoot: p.inst.shoot, width: p.inst.width, passing: p.inst.passing,
        mark: p.inst.mark ? markNumber(p.inst.mark) : null,
      };
    }),
  };
}
let oppRef: Team | null = null;
const markNumber = (id: string) => {
  const i = oppRef?.players.findIndex((p) => p.id === id) ?? -1;
  return i >= 0 ? i + 1 : null;
};

function simSummary(agg: Aggregate | null | undefined, side: 0 | 1): string {
  if (!agg || !agg.n) return '';
  const me = agg.stats[side], them = agg.stats[1 - side];
  const pm = (v: number) => +(v / agg.n).toFixed(2);
  return `\n\nSimulation over ${agg.n} matches (your team vs opponent): W${agg.wins[side]} D${agg.draws} L${agg.wins[1 - side]}; goals ${pm(agg.goals[side])}-${pm(agg.goals[1 - side])};
xG ${pm(me.xg)}-${pm(them.xg)}; shots ${pm(me.shots)}-${pm(them.shots)}; counter-attack shots ${pm(me.counterShots)}-${pm(them.counterShots)};
final-third entries by route (left/centre/right) ${me.entriesByChannel.map(pm).join('/')}; xG conceded by route into your (left/centre/right): ${[them.xgByChannel[2], them.xgByChannel[1], them.xgByChannel[0]].map(pm).join('/')}.`;
}

function liveSummary(match: Match | null, side: 0 | 1): string {
  if (!match) return '';
  const me = match.stats[side], them = match.stats[1 - side];
  const poss = Math.round((me.possessionT / Math.max(1, me.possessionT + them.possessionT)) * 100);
  const owner = match.ball.owner;
  return `\n\nLIVE MATCH: ${match.clock}, score you ${match.score[side]}-${match.score[1 - side]}. Possession ${poss}%, shots ${me.shots}-${them.shots}, xG ${me.xg.toFixed(2)}-${them.xg.toFixed(2)}. ${
    owner ? `Ball with ${owner.team === side ? 'your' : 'their'} ${owner.spec.role}.` : 'Ball loose or in flight.'
  } Positions above are the players' current positions.`;
}

export async function askFeedback(opts: {
  idea: string; team: Team; opp: Team; agg?: Aggregate | null; side: 0 | 1;
  browserKey?: { apiKey: string; model: string };
}): Promise<string> {
  oppRef = opts.opp;
  const content = `Coach's idea: ${opts.idea || '(no specific idea; review the setup)'}\n\nMy team:\n${JSON.stringify(compact(opts.team, null, opts.side))}\n\nOpponent:\n${JSON.stringify(compact(opts.opp, null, (1 - opts.side) as 0 | 1))}${simSummary(opts.agg, opts.side)}`;
  return callAI('feedback', content, opts.browserKey);
}

// ------------------------------------------------------------------ coaching
export interface CoachChange { playerId: string; patch: Partial<Instructions>; label: string }
export interface CoachResult { say: string; changes: CoachChange[]; team: Partial<TeamTactics> }

const INST_RANGE: Record<string, [number, number]> = {
  roam: [0, 1], press: [0, 1], runs: [0, 1], dribble: [0, 1], shoot: [0, 1], width: [-1, 1],
};
const TEAM_KEYS: (keyof TeamTactics)[] = ['lineHeight', 'compactness', 'tempo', 'width'];

/** Parse and sanitise the model's JSON: unknown keys and out-of-range values never reach the simulator. */
export function parseCoachReply(text: string, team: Team, opp: Team): CoachResult {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The coach AI did not return instructions.');
  let raw: { say?: unknown; changes?: unknown; team?: unknown };
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('The coach AI returned malformed instructions.'); }

  const changes: CoachChange[] = [];
  for (const c of Array.isArray(raw.changes) ? raw.changes : []) {
    const n = Number(c?.n);
    const player = Number.isInteger(n) ? team.players[n - 1] : undefined;
    if (!player || typeof c.set !== 'object' || !c.set) continue;
    const patch: Partial<Instructions> = {};
    const parts: string[] = [];
    for (const [k, v] of Object.entries(c.set as Record<string, unknown>)) {
      if (k in INST_RANGE && typeof v === 'number' && Number.isFinite(v)) {
        const [lo, hi] = INST_RANGE[k];
        const val = Math.max(lo, Math.min(hi, v));
        (patch as Record<string, number>)[k] = val;
        parts.push(`${k} ${Math.round(val * 100)}%`);
      } else if (k === 'passing' && (v === 'safe' || v === 'mixed' || v === 'direct')) {
        patch.passing = v;
        parts.push(`passing ${v}`);
      } else if (k === 'mark') {
        if (v === null) { patch.mark = null; parts.push('zonal'); }
        else if (Number.isInteger(v) && opp.players[(v as number) - 1]) {
          patch.mark = opp.players[(v as number) - 1].id;
          parts.push(`marks #${v}`);
        }
      }
    }
    if (parts.length) changes.push({ playerId: player.id, patch, label: `#${n} ${player.role}: ${parts.join(', ')}` });
  }
  const tacticsPatch: Partial<TeamTactics> = {};
  if (raw.team && typeof raw.team === 'object') {
    for (const k of TEAM_KEYS) {
      const v = (raw.team as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) tacticsPatch[k] = Math.max(0, Math.min(1, v));
    }
  }
  return { say: typeof raw.say === 'string' ? raw.say : 'Done.', changes, team: tacticsPatch };
}

export async function askCoach(opts: {
  command: string; team: Team; opp: Team; side: 0 | 1; match: Match | null; selectedNumber?: number;
  browserKey?: { apiKey: string; model: string };
}): Promise<CoachResult> {
  oppRef = opts.opp;
  const content = `Coach's instruction: ${opts.command}${opts.selectedNumber ? `\n(The coach currently has player #${opts.selectedNumber} selected.)` : ''}\n\nMy team:\n${JSON.stringify(compact(opts.team, opts.match, opts.side))}\n\nOpponent:\n${JSON.stringify(compact(opts.opp, opts.match, (1 - opts.side) as 0 | 1))}${liveSummary(opts.match, opts.side)}`;
  const text = await callAI('coach', content, opts.browserKey);
  return parseCoachReply(text, opts.team, opts.opp);
}
