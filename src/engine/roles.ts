import { Instructions, PlayerSpec, Role, Team, defaultInstructions } from './types';

/** One-click role templates: a base position class plus a tuned set of behaviours. */
export interface RoleTemplate { name: string; role: Role; blurb: string; inst: Partial<Instructions> }

export const ROLE_TEMPLATES: RoleTemplate[] = [
  { name: 'Ball-playing centre-back', role: 'CB', blurb: 'Steps out, breaks lines with passes, carries when space opens', inst: { passing: 'mixed', dribble: 0.3, runs: 0.2, roam: 0.2, press: 0.4 } },
  { name: 'Sweeper', role: 'CB', blurb: 'Drops behind the line, covers, plays it safe', inst: { depth: -0.35, roam: 0.15, press: 0.2, runs: 0.05, track: 0.85, passing: 'safe' } },
  { name: 'Defensive full-back', role: 'FB', blurb: 'Stays back, defends the flank first', inst: { runs: 0.15, width: 0.1, depth: -0.2, track: 1, press: 0.55, cross: 0.4 } },
  { name: 'Overlapping full-back', role: 'FB', blurb: 'Bombs on past the winger and delivers', inst: { runs: 0.95, width: 0.8, cross: 0.85, roam: 0.4, track: 0.55 } },
  { name: 'Inverted full-back', role: 'FB', blurb: 'Tucks into midfield to add control', inst: { width: -0.9, roam: 0.5, runs: 0.35, passing: 'safe', cross: 0.2 } },
  { name: 'Attacking wing-back', role: 'WB', blurb: 'The whole flank: runs, crosses, recovers', inst: { runs: 1, width: 0.95, cross: 0.85, dribble: 0.5, track: 0.6 } },
  { name: 'Anchor man', role: 'DM', blurb: 'Screens the back line, rarely leaves his spot', inst: { roam: 0, runs: 0.05, depth: -0.2, track: 0.9, press: 0.5, shoot: 0.05, passing: 'safe' } },
  { name: 'Deep-lying playmaker', role: 'DM', blurb: 'Drops to receive and dictates tempo with passes', inst: { depth: -0.35, roam: 0.45, runs: 0.15, dribble: 0.15, shoot: 0.15, press: 0.4, passing: 'mixed', track: 0.6 } },
  { name: 'Box-to-box midfielder', role: 'CM', blurb: 'Covers the pitch: wins it, then arrives in the box', inst: { roam: 0.7, runs: 0.8, press: 0.8, shoot: 0.45, track: 0.85 } },
  { name: 'Half-space runner (mezzala)', role: 'CM', blurb: 'Drifts into the channel and runs beyond the striker', inst: { lane: 0.3, roam: 0.5, runs: 0.85, depth: 0.1, shoot: 0.5 } },
  { name: 'Playmaker (number 10)', role: 'AM', blurb: 'Free between the lines, creates and shoots', inst: { roam: 0.7, depth: -0.1, runs: 0.55, shoot: 0.5, dribble: 0.5, passing: 'mixed' } },
  { name: 'Traditional winger', role: 'W', blurb: 'Hugs the touchline, beats his man, crosses', inst: { width: 0.9, cross: 0.9, dribble: 0.75, runs: 0.7, shoot: 0.3, roam: 0.25 } },
  { name: 'Inside forward', role: 'W', blurb: 'Starts wide, cuts in to shoot', inst: { width: -0.7, dribble: 0.8, shoot: 0.85, runs: 0.85, cross: 0.15, roam: 0.45 } },
  { name: 'Target man', role: 'ST', blurb: 'Holds it up, wins it in the air, lays off', inst: { roam: 0.2, runs: 0.5, depth: -0.1, dribble: 0.1, shoot: 0.6, passing: 'safe', press: 0.5 } },
  { name: 'Poacher', role: 'ST', blurb: 'Lives on the last line, shoots on sight', inst: { roam: 0.1, runs: 1, depth: 0.4, shoot: 1, dribble: 0.2, press: 0.3, track: 0.2 } },
  { name: 'False 9', role: 'ST', blurb: 'Drops into midfield and links play', inst: { roam: 0.9, runs: 0.25, depth: -0.6, passing: 'safe', dribble: 0.55, shoot: 0.5, press: 0.4 } },
  { name: 'Pressing forward', role: 'ST', blurb: 'Leads the press, harasses defenders', inst: { press: 1, roam: 0.5, runs: 0.7, track: 0.7, shoot: 0.6 } },
];

export interface BriefResult {
  role?: Role;
  roleName?: string;
  inst: Partial<Instructions>;
  notes: string[]; // what was understood, in plain words
  unmatched: boolean; // nothing recognised
}

const ROLE_NOUNS: [RegExp, Role][] = [
  [/\b(goal ?keeper|keeper)\b/, 'GK'],
  [/\b(centre|center) ?-?backs?|\bcbs?\b/, 'CB'],
  [/\bwing ?-?backs?\b/, 'WB'],
  [/\bfull ?-?backs?\b/, 'FB'],
  [/\b(holding|defensive) mid(field(er)?)?|\banchor\b|\bpivot\b|\bsix\b|\bdm\b/, 'DM'],
  [/\b(attacking mid(field(er)?)?|playmaker|trequartista|number 10|no\.? ?10|cam)\b/, 'AM'],
  [/\b(box.to.box|central mid(field(er)?)?|midfielder|cm)\b/, 'CM'],
  [/\b(winger|wide forward|wide mid(field(er)?)?)\b/, 'W'],
  [/\b(striker|centre.?forward|center.?forward|number 9|no\.? ?9|forward)\b/, 'ST'],
];

interface Rule { re: RegExp; note: string; apply: (i: Partial<Instructions>, m: RegExpMatchArray) => void; neg?: boolean }

const RULES: Rule[] = [
  { re: /\bdrop(s|ping)? (deep|back|short|into (the )?midfield)|\bcome(s)? (short|deep|to (the )?ball)|link (up )?play|between the lines?/, note: 'Drops deeper to link play', apply: (i) => { i.depth = -0.5; i.roam = Math.max(i.roam ?? 0, 0.6); } },
  { re: /\bstay(s)? (high|up|forward|advanced)|on the (last line|shoulder)|last defender|offside line|play(s)? high/, note: 'Stays high on the last line', apply: (i) => { i.depth = 0.5; i.runs = 0.85; } },
  { re: /\b(stay|hold|sit)(s)? (back|deep)|in front of (the )?(back|defen[cs]e)|break(s|ing)? up (play|attacks?)|shield(s)? the (back|defen[cs]e)|screen|rest.?defen[cs]e|stay(s)? at home|never (go|going) forward|don.?t (go|get) forward/, note: 'Stays back as cover', apply: (i) => { i.depth = -0.25; i.runs = 0.08; i.roam = Math.min(i.roam ?? 1, 0.1); i.track = 0.9; } },
  { re: /\b(stay|hug|keep)(s)? (the )?(wide|width|touchline|line)|\bstay(s)? wide|\bwide\b(?! (forward|mid))|hug(s)? the (line|touchline)/, note: 'Stays wide, hugging the touchline', apply: (i) => { i.width = 0.9; } },
  { re: /\bcut(s|ting)? (in|inside)|come(s)? inside|inverted|inside forward|tuck(s|ing)? in/, note: 'Cuts inside', apply: (i) => { i.width = -0.8; i.cross = Math.min(i.cross ?? 0.5, 0.2); } },
  { re: /\bcross(es|ing)?\b|deliver(s)?\b|byline|whip(s)? (it|balls?) in|early (ball|cross)/, note: 'Crosses at every chance', apply: (i) => { i.cross = 0.95; } },
  { neg: true, re: /\b(don.?t|never|rarely) cross\b/, note: 'Does not cross', apply: (i) => { i.cross = 0.05; } },
  { re: /\boverlap(s|ping)?\b|\bget(s)? forward\b|bomb(s)? (on|forward)|\battack(ing|s)? (full|wing).?back|run(s)? beyond|run(s)? in behind|\bruns? the channel|get(s)? in behind|late runs?|arrive(s)? in the box/, note: 'Makes forward / overlapping runs', apply: (i) => { i.runs = 0.95; } },
  { neg: true, re: /\b(don.?t|never|rarely) press\b|conserve|save (his )?energy/, note: 'Does not press', apply: (i) => { i.press = 0.1; } },
  { re: /\bpress(es|ing)?\b|close(s)? (him |them )?down|hunt(s)?\b|harass(es)?|win(s)? it back|counter.?press/, note: 'Presses aggressively', apply: (i) => { i.press = 0.95; } },
  { re: /\btrack(s|ing)? (back|runners)|recover(s|ing)?|defensive (work|duties)|work(s)? hard defensively|get(s)? back/, note: 'Tracks back hard', apply: (i) => { i.track = 0.95; } },
  { neg: true, re: /\b(don.?t|never|rarely) (track|defend|recover)|stay(s)? up the pitch|lazy|\bfree of defensive/, note: 'Stays up the pitch (little defensive work)', apply: (i) => { i.track = 0.1; i.press = Math.min(i.press ?? 1, 0.3); } },
  { neg: true, re: /\b(don.?t|never|rarely|seldom) shoot|lay(s)? (it )?off|pass(es)? (instead of|rather than) shooting/, note: 'Rarely shoots', apply: (i) => { i.shoot = 0.08; } },
  { re: /\bshoot(s|ing)?\b|shots?\b|\bfinish(es|ing)?\b|poach|score(s)?\b|shoot on sight|long shots?/, note: 'Shoots at every chance', apply: (i) => { i.shoot = 0.95; } },
  { neg: true, re: /\b(don.?t|never|rarely) dribble|no dribbl/, note: 'Does not dribble', apply: (i) => { i.dribble = 0.05; } },
  { re: /\bdribble(s|r)?\b|take(s)? (players|defenders|him|them) on|take on|run(s)? at|beat(s)? (his|the) (man|marker)|1v1|one.on.one/, note: 'Takes players on', apply: (i) => { i.dribble = 0.9; } },
  { re: /\bsimple\b|safe(ly)?\b|one.?touch|short pass(es)?|keep(s)? it|keep (the )?(ball|possession)|recycle/, note: 'Plays simple, safe passes', apply: (i) => { i.passing = 'safe'; i.dribble = Math.min(i.dribble ?? 1, 0.15); i.shoot = Math.min(i.shoot ?? 1, 0.2); } },
  { re: /\bdirect(ly)?\b|long (balls?|passes)|vertical|killer pass(es)?|forward pass(es)?|play(s)? (it )?forward/, note: 'Plays direct, forward passes', apply: (i) => { i.passing = 'direct'; } },
  { re: /\bmixed\b|balanced passing/, note: 'Mixes short and direct passes', apply: (i) => { i.passing = 'mixed'; } },
  { re: /\bfree role|\broam(s|ing)?\b|float(s|ing)?\b|wander|drift(s|ing)?\b|everywhere|go(es)? where (he|the ball)/, note: 'Free role: roams to find space', apply: (i) => { i.roam = 0.92; } },
  { re: /\bdisciplined|(stay|hold|keep)(s)? (his |your )?(position|zone|shape|spot)|don.?t roam|sticks? to|positional(ly)? (disciplined|discipline)|fixed position/, note: 'Holds position, disciplined', apply: (i) => { i.roam = 0; } },
  { re: /half.?space/, note: 'Occupies the half-space (inside channel)', apply: (i, m) => { void m; i.lane = i.lane ?? 0.3; } },
  { re: /\b(central(ly)?|centre|center)\b(?!\s*-?\s*(backs?|forwards?|mids?|midfield))|through the middle|middle of the pitch/, note: 'Operates centrally', apply: (i) => { i.lane = 0.5; } },
  { re: /\b(left|right)(\s+(side|flank|channel|wing|half.?space))?\b/, note: 'Works a specific side', apply: (i, m) => { const right = m[1] === 'right'; const hs = /half.?space/.test(m[0]); i.lane = right ? (hs ? 0.7 : 0.88) : hs ? 0.3 : 0.12; } },
];

/**
 * Offline interpreter for a coach's free-text instruction. Handles the common football phrases;
 * anything it cannot recognise is reported back so the UI can suggest the AI path.
 */
export function interpretBrief(text: string, player: PlayerSpec, opp?: Team): BriefResult {
  const s = text.toLowerCase().replace(/[’']/g, "'");
  const inst: Partial<Instructions> = {};
  const notes: string[] = [];
  let role: Role | undefined;
  let roleName: string | undefined;

  // named role template ("be a false 9", "play as a deep-lying playmaker")
  const bare = (n: string) => n.toLowerCase().replace(/ \(.*\)/, '');
  const tpl = [...ROLE_TEMPLATES].sort((a, b) => bare(b.name).length - bare(a.name).length).find((t) => s.includes(t.name.toLowerCase().replace(/ \(.*\)/, '')) || (t.name.includes('(') && s.includes(t.name.toLowerCase().match(/\((.*)\)/)![1])));
  if (tpl) {
    role = tpl.role;
    roleName = tpl.name;
    Object.assign(inst, tpl.inst);
    notes.push(`Role: ${tpl.name}: ${tpl.blurb}`);
  } else {
    const asRole = s.match(/\b(?:act|play|be|operate|work|used|deploy(?:ed)?)(?:s)?(?: as| like)?(?: a| an| the)?\s+([a-z0-9. -]{3,40})/);
    if (asRole) {
      for (const [re, r] of ROLE_NOUNS) if (re.test(asRole[1])) { role = r; break; }
      if (role) notes.push(`Base role: ${role}`);
    }
  }

  // Negations ("never shoot", "don't press") are applied first and removed from the text, so the
  // positive rules cannot also read the same words ("shoot", "press") the other way round.
  let rest = s;
  for (const rule of RULES.filter((r) => r.neg)) {
    const m = rest.match(rule.re);
    if (m) { rule.apply(inst, m); notes.push(rule.note); rest = rest.replace(rule.re, ' '); }
  }
  for (const rule of RULES.filter((r) => !r.neg)) {
    const m = rest.match(rule.re);
    if (m) { rule.apply(inst, m); notes.push(rule.note); }
  }

  // man-marking: "mark their number 9", "mark #10", "man-mark their striker / playmaker"
  if (opp && /\bmark(ing)?\b/.test(s) && !/\b(don.?t|never) mark\b/.test(s)) {
    const num = s.match(/mark(?:ing)?\s+(?:their\s+|the\s+)?(?:opp(?:onent)?\s+)?(?:number|no\.?|#)\s*(\d{1,2})/) ?? s.match(/mark(?:ing)?\s+#?(\d{1,2})\b/);
    let target: PlayerSpec | undefined;
    if (num) target = opp.players[Number(num[1]) - 1];
    else {
      const wants: Role[] = /striker|forward|number 9|centre.?forward/.test(s) ? ['ST'] : /playmaker|number 10|no\.? ?10|attacking mid/.test(s) ? ['AM', 'CM'] : /winger|wide/.test(s) ? ['W', 'WB'] : /best|danger/.test(s) ? ['ST', 'AM', 'W'] : [];
      for (const w of wants) { target = opp.players.find((p) => p.role === w); if (target) break; }
    }
    if (target) {
      inst.mark = target.id;
      notes.push(`Man-marks their #${opp.players.indexOf(target) + 1} ${target.role}`);
    } else notes.push("Wants to man-mark but I couldn't tell who (say e.g. “mark their number 9”)");
  } else if (/\b(zonal|stop marking|don.?t mark)\b/.test(s)) {
    inst.mark = null;
    notes.push('Zonal marking (no man-marking)');
  }

  void player;
  return { role, roleName, inst, notes, unmatched: notes.length === 0 };
}

/** Applies a role/brief result to a player (instructions merged over the role defaults when the role changes). */
export function applyBriefToPlayer(p: PlayerSpec, r: { role?: Role; roleName?: string; inst: Partial<Instructions> }, brief: string, allowRoleChange: boolean, reset = false): PlayerSpec {
  const next: PlayerSpec = { ...p, brief };
  const newRole = allowRoleChange && r.role && r.role !== p.role ? r.role : undefined;
  if (newRole) next.role = newRole;
  next.inst = newRole || reset ? { ...defaultInstructions(next.role) } : { ...p.inst };
  Object.assign(next.inst, r.inst);
  if (r.roleName) next.roleName = r.roleName;
  return next;
}

/** Human-readable line for each behaviour that changed. */
export function describeChanges(before: Instructions, after: Instructions, oppLabel: (id: string) => string): string[] {
  const out: string[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const num = (k: 'roam' | 'press' | 'runs' | 'dribble' | 'shoot' | 'track' | 'cross', label: string) => {
    const a = (before[k] ?? (k === 'track' || k === 'cross' ? 0.5 : 0)) as number, b = (after[k] ?? (k === 'track' || k === 'cross' ? 0.5 : 0)) as number;
    if (Math.abs(a - b) > 0.005) out.push(`${label}: ${pct(a)} → ${pct(b)}`);
  };
  num('roam', 'Roam'); num('press', 'Press'); num('runs', 'Forward runs'); num('dribble', 'Dribble'); num('shoot', 'Shoot'); num('track', 'Track back'); num('cross', 'Crossing');
  if (Math.abs((before.width ?? 0) - (after.width ?? 0)) > 0.005) out.push(`Width: ${Math.round(before.width * 100)}% → ${Math.round(after.width * 100)}%`);
  const d0 = before.depth ?? 0, d1 = after.depth ?? 0;
  if (Math.abs(d0 - d1) > 0.005) out.push(`Depth: ${d1 < 0 ? 'drops deeper' : d1 > 0 ? 'stays higher' : 'neutral'} (${d1 >= 0 ? '+' : ''}${Math.round(d1 * 100)}%)`);
  if ((before.lane ?? null) !== (after.lane ?? null)) out.push(`Channel: ${after.lane == null ? 'formation default' : `${Math.round(after.lane * 100)}% across (0 = left, 100 = right)`}`);
  if (before.passing !== after.passing) out.push(`Passing: ${before.passing} → ${after.passing}`);
  if (before.mark !== after.mark) out.push(after.mark ? `Marking: ${oppLabel(after.mark)}` : 'Marking: zonal');
  return out;
}
