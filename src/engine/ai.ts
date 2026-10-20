import type { Instructions, Team, TeamTactics } from './types';
import type { Aggregate } from './batch';
import { ORDERS, type Match, type TeamIdx } from './sim';
import { SYSTEM, type AIMode } from '../../api/_prompts';

const ENDPOINT = '/api/claude';

export interface BrowserKey { apiKey: string; textModel: string; decisionModel: string }
export interface ServerInfo { configured: boolean; textModel?: string; decisionModel?: string }

/** Is the Vercel function reachable and configured? (not available in plain `vite dev`.) */
export async function probeServer(): Promise<ServerInfo> {
  try {
    const r = await fetch(ENDPOINT);
    if (!r.ok) return { configured: false };
    const j = await r.json();
    return { configured: j.configured === true, textModel: j.textModel, decisionModel: j.decisionModel };
  } catch {
    return { configured: false };
  }
}

async function callAI(mode: AIMode, content: string, browserKey?: BrowserKey): Promise<string> {
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
  // Local-development fallback: call OpenRouter directly with a key the user pasted into the browser.
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${browserKey.apiKey}`, 'x-title': 'Football Tactics Board' },
    body: JSON.stringify({
      model: mode === 'decide' ? browserKey.decisionModel : browserKey.textModel,
      max_tokens: mode === 'coach' ? 700 : mode === 'feedback' ? 1200 : mode === 'decide' ? 600 : 900,
      messages: [{ role: 'system', content: SYSTEM[mode] }, { role: 'user', content }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenRouter error: ${res.status} ${data.error?.message ?? ''}`);
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('The model returned an empty reply.');
  return text as string;
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
  browserKey?: BrowserKey;
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
  browserKey?: BrowserKey;
}): Promise<CoachResult> {
  oppRef = opts.opp;
  const content = `Coach's instruction: ${opts.command}${opts.selectedNumber ? `\n(The coach currently has player #${opts.selectedNumber} selected.)` : ''}\n\nMy team:\n${JSON.stringify(compact(opts.team, opts.match, opts.side))}\n\nOpponent:\n${JSON.stringify(compact(opts.opp, opts.match, (1 - opts.side) as 0 | 1))}${liveSummary(opts.match, opts.side)}`;
  const text = await callAI('coach', content, opts.browserKey);
  return parseCoachReply(text, opts.team, opts.opp);
}

// ------------------------------------------------------------ shape lab
export interface ScenarioStep { x: number; y: number; poss: 0 | 1; seconds: number; caption: string }
export interface Scenario { title: string; steps: ScenarioStep[] }

export function parseScenario(text: string): Scenario {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The AI did not return a ball sequence.');
  let raw: { title?: unknown; steps?: unknown };
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('The AI returned a malformed ball sequence.'); }
  const steps: ScenarioStep[] = [];
  for (const s of (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 14)) {
    const x = Number(s?.x), y = Number(s?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const secs = Number(s.seconds);
    steps.push({
      x: Math.max(0, Math.min(105, x)),
      y: Math.max(0, Math.min(68, y)),
      poss: s.poss === 'away' ? 1 : 0,
      seconds: Number.isFinite(secs) ? Math.max(0, Math.min(8, secs)) : 2,
      caption: typeof s.caption === 'string' ? s.caption.slice(0, 120) : '',
    });
  }
  if (steps.length < 2) throw new Error('The AI sequence was too short to animate.');
  steps[0].seconds = 0;
  return { title: typeof raw.title === 'string' ? raw.title.slice(0, 80) : 'AI sequence', steps };
}

const brief = (t: Team) => ({ name: t.name, shape: t.players.map((p) => p.role).join(' '), tactics: t.tactics });

export async function askScenario(opts: { prompt: string; home: Team; away: Team; browserKey?: BrowserKey }): Promise<Scenario> {
  const content = `Coach's request: ${opts.prompt}\n\nHome: ${JSON.stringify(brief(opts.home))}\nAway: ${JSON.stringify(brief(opts.away))}`;
  return parseScenario(await callAI('scenario', content, opts.browserKey));
}

export interface ShapeSnapshot { caption: string; ball: [number, number]; possession: 'home' | 'away'; home: unknown; away: unknown }

export async function askExplain(opts: { title: string; snapshots: ShapeSnapshot[]; browserKey?: BrowserKey }): Promise<string> {
  const content = `Sequence: ${opts.title}\n\n${JSON.stringify(opts.snapshots)}`;
  return callAI('explain', content, opts.browserKey);
}

// ------------------------------------------------------------ decision model
export interface DecisionOrder { playerId: string; order: string; seconds: number; markId?: string; why: string; n: number }
export interface DecisionResult { say: string; orders: DecisionOrder[] }

const f2 = (v: number) => +v.toFixed(2);

/** Compact snapshot of the match from one team's point of view, for the decision model. */
export function buildDecisionState(m: Match, side: TeamIdx): string {
  const mine = m.teams[side], theirs = m.teams[1 - side];
  const fx = (x: number) => f2(side === 0 ? x / 105 : 1 - x / 105);
  const fy = (y: number) => f2(side === 0 ? y / 68 : 1 - y / 68);
  const opx = (x: number) => f2(side === 0 ? 1 - x / 105 : x / 105); // opponent in their own frame
  const opy = (y: number) => f2(side === 0 ? 1 - y / 68 : y / 68);
  const owner = m.ball.owner;
  const poss = owner ? owner.team : m.ball.lastTeam;
  const me = m.stats[side], them = m.stats[1 - side];
  return JSON.stringify({
    clock: m.clock, score: { you: m.score[side], opponent: m.score[1 - side] },
    possession: poss === side ? 'you' : 'opponent',
    ballWith: owner ? (owner.team === side ? `your #${mine.players.indexOf(owner.spec) + 1}` : `their #${theirs.players.indexOf(owner.spec) + 1}`) : 'loose/in flight',
    ball: { x: fx(m.ball.x), y: fy(m.ball.y) },
    stats: { shots: [me.shots, them.shots], xg: [f2(me.xg), f2(them.xg)] },
    tactics: mine.tactics,
    yourPlayers: mine.players.map((sp, i) => {
      const p = m.findPlayer(sp.id)!;
      return { n: i + 1, role: sp.role, x: fx(p.x), y: fy(p.y), doing: p.intent, order: p.order && m.t < p.order.until ? p.order.name : null, stamina: f2(p.stamina) };
    }),
    opponents: theirs.players.map((sp, i) => {
      const p = m.findPlayer(sp.id)!;
      return { n: i + 1, role: sp.role, x: opx(p.x), y: opy(p.y) };
    }),
  });
}

export function parseDecisions(text: string, m: Match, side: TeamIdx): DecisionResult {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The decision model did not return orders.');
  let raw: { say?: unknown; orders?: unknown };
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('The decision model returned malformed orders.'); }
  const mine = m.teams[side].players, theirs = m.teams[1 - side].players;
  const seen = new Set<string>();
  const orders: DecisionOrder[] = [];
  for (const o of (Array.isArray(raw.orders) ? raw.orders : []).slice(0, 6)) {
    const n = Number(o?.n);
    const sp = Number.isInteger(n) ? mine[n - 1] : undefined;
    const name = typeof o?.order === 'string' ? o.order : '';
    if (!sp || sp.role === 'GK' || !Object.hasOwn(ORDERS, name) || seen.has(sp.id)) continue;
    let markId: string | undefined;
    if (name === 'mark') {
      const t = theirs[Number(o.mark) - 1];
      if (!t) continue;
      markId = t.id;
    }
    const secs = Number(o.seconds);
    seen.add(sp.id);
    orders.push({
      playerId: sp.id, n, order: name, markId,
      seconds: Math.max(6, Math.min(45, Number.isFinite(secs) ? secs : 15)),
      why: typeof o.why === 'string' ? o.why.slice(0, 100) : '',
    });
  }
  return { say: typeof raw.say === 'string' ? raw.say.slice(0, 200) : '', orders };
}

export async function askDecisions(opts: { match: Match; side: TeamIdx; browserKey?: BrowserKey }): Promise<DecisionResult> {
  const text = await callAI('decide', buildDecisionState(opts.match, opts.side), opts.browserKey);
  return parseDecisions(text, opts.match, opts.side);
}

export interface DiagCheck { name: string; ok: boolean; detail: string }

/** Ask the server to test every link in the chain (key present, valid, models exist, models answer). */
export async function runDiagnostics(): Promise<DiagCheck[]> {
  let res: Response;
  try { res = await fetch(`${ENDPOINT}?check=1`); } catch { throw new Error('Could not reach /api/claude at all (network error).'); }
  const text = await res.text();
  let j: { checks?: DiagCheck[]; error?: string } = {};
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (j.checks) return j.checks;
  if (res.status >= 500 && !(() => { try { JSON.parse(text); return true; } catch { return false; } })())
    throw new Error(`The /api/claude function crashed on the server (HTTP ${res.status}) before it could answer. Open Vercel, then the project, then Logs, filter to /api/claude and look at the error (a missing module or a deploy problem is the usual cause). If you just deployed a fix, make sure you are on the new deployment.`);
  const isJson = (() => { try { JSON.parse(text); return true; } catch { return false; } })();
  if (!isJson)
    throw new Error(`There is no working /api/claude function here (got ${res.status === 200 ? 'a non-API page' : 'HTTP ' + res.status}). On Vercel this usually means the api/ folder was not deployed (check the project's Root Directory is the repo root and that the latest deployment succeeded). In plain \`npm run dev\` there is no API at all: use \`npx vercel dev\`, or paste a key into the local-dev field below.`);
  throw new Error(j.error ?? `Unexpected response (HTTP ${res.status}).`);
}
