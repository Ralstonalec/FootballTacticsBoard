import { interpretBrief, ROLE_TEMPLATES, applyBriefToPlayer, describeChanges } from '../src/engine/roles';
import { parseRoleReply } from '../src/engine/ai';
import { Match, TeamIdx } from '../src/engine/sim';
import { buildTeam } from '../src/engine/formations';
import { defaultInstructions, Team } from '../src/engine/types';

let fails = 0;
const ok = (n: string, c: boolean, x: unknown = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`, c ? '' : JSON.stringify(x)); };
const me = buildTeam('Me', '4-4-2', 0), opp = buildTeam('Opp', '4-4-2', 1);
const first = (role: string) => me.players.find((p) => p.role === role)!;

// ---------------------------------------------------------------- phrase understanding
let r = interpretBrief('Drop deep between the centre-backs, play safe passes, never shoot', first('ST'), opp);
ok('drop deep + safe passes + never shoot', (r.inst.depth ?? 0) < -0.3 && r.inst.passing === 'safe' && (r.inst.shoot ?? 1) < 0.2, r);
r = interpretBrief('Stay wide, beat his man and cross at every chance', first('W'), opp);
ok('stay wide + dribble + cross', (r.inst.width ?? 0) > 0.8 && (r.inst.dribble ?? 0) > 0.8 && (r.inst.cross ?? 0) > 0.9, r.inst);
r = interpretBrief('Cut inside from the left and press their full-back', first('W'), opp);
ok('cut inside + left lane + press', (r.inst.width ?? 0) < -0.5 && (r.inst.lane ?? 1) < 0.3 && (r.inst.press ?? 0) > 0.9, r.inst);
r = interpretBrief('Sit in front of the back four and break up attacks', first('CM'), opp);
ok('"sit in front of the back four" -> understood (stay back/disciplined)', !r.unmatched, r);
r = interpretBrief('Make late runs into the box and shoot on sight', first('CM'), opp);
ok('late runs + shoot', (r.inst.runs ?? 0) > 0.9 && (r.inst.shoot ?? 0) > 0.9, r.inst);
r = interpretBrief('Never press, save energy', first('ST'), opp);
ok('"never press" is not read as "press"', (r.inst.press ?? 1) <= 0.1, r.inst);
r = interpretBrief("Don't cross, just cut inside", first('W'), opp);
ok('"don\'t cross" is not read as "cross"', (r.inst.cross ?? 1) <= 0.2, r.inst);
r = interpretBrief('mark their number 9', first('DM'), opp);
ok('mark by shirt number', r.inst.mark === opp.players[8].id, r);
r = interpretBrief('man-mark their striker', first('DM'), opp);
ok('mark by role (striker -> their ST)', r.inst.mark === opp.players.find((p) => p.role === 'ST')!.id, r);
r = interpretBrief('mark their playmaker', first('DM'), opp);
ok('mark by role (playmaker -> AM/CM)', !!r.inst.mark && ['AM', 'CM'].includes(opp.players.find((p) => p.id === r.inst.mark)!.role), r);
r = interpretBrief('play as a false 9', first('CM'), opp);
ok('named role template ("false 9") sets role ST + dropping behaviour', r.role === 'ST' && r.roleName === 'False 9' && (r.inst.depth ?? 0) < -0.4, r);
r = interpretBrief('act as a deep-lying playmaker', first('CM'), opp);
ok('named role template ("deep-lying playmaker")', r.roleName === 'Deep-lying playmaker', r);
r = interpretBrief('be a winger', first('CM'), opp);
ok('"be a winger" changes the base role to W', r.role === 'W', r);
r = interpretBrief('blah blah nothing here', first('CM'), opp);
ok('gibberish is reported as unmatched', r.unmatched && r.notes.length === 0, r);
r = interpretBrief('Hug the touchline but stay disciplined and hold your position', first('W'), opp);
ok('compound: wide + disciplined', (r.inst.width ?? 0) > 0.8 && r.inst.roam === 0, r.inst);
ok('every template has valid, in-range settings', ROLE_TEMPLATES.every((t) => Object.entries(t.inst).every(([k, v]) => typeof v !== 'number' || (k === 'width' || k === 'depth' ? v >= -1 && v <= 1 : v >= 0 && v <= 1))), 'range');
ok('template names are unique', new Set(ROLE_TEMPLATES.map((t) => t.name)).size === ROLE_TEMPLATES.length);

// ---------------------------------------------------------------- applying
const st = first('ST');
const tpl = ROLE_TEMPLATES.find((t) => t.name === 'Poacher')!;
const applied = applyBriefToPlayer(st, { role: tpl.role, roleName: tpl.name, inst: tpl.inst }, 'x', true, true);
ok('template resets then applies (Poacher: shoot 1, depth +0.4)', applied.inst.shoot === 1 && applied.inst.depth === 0.4 && applied.roleName === 'Poacher' && applied.brief === 'x');
const w = first('W');
const noRole = applyBriefToPlayer(w, { role: 'ST', inst: { shoot: 0.9 } }, 'b', false);
ok('role change is ignored when not allowed (mid-match), behaviours still applied', noRole.role === 'W' && noRole.inst.shoot === 0.9);
const diff = describeChanges(defaultInstructions('ST'), applied.inst, () => 'x');
ok('describeChanges lists what changed in words', diff.some((d) => /^Shoot:/.test(d)) && diff.some((d) => /^Depth:/.test(d)), diff);

// ---------------------------------------------------------------- AI reply validation
const ai = parseRoleReply('```json\n{"roleName":"Dropping nine","role":"ST","inst":{"depth":-5,"roam":0.9,"passing":"wild","hax":1,"lane":null,"mark":3,"cross":"x"},"summary":"Drops in."}\n```', opp);
ok('AI reply: clamps, drops unknown/invalid keys', ai.inst.depth === -1 && ai.inst.roam === 0.9 && !('hax' in ai.inst) && ai.inst.passing === undefined && ai.inst.lane === null && ai.inst.cross === undefined, ai.inst);
ok('AI reply: mark number -> opponent id; role/roleName kept', ai.inst.mark === opp.players[2].id && ai.role === 'ST' && ai.roleName === 'Dropping nine');
let threw = false; try { parseRoleReply('no json', opp); } catch { threw = true; }
ok('AI reply: non-JSON throws friendly error', threw);

// ---------------------------------------------------------------- behaviour in the simulator
const mkTeam = (mod: (t: Team) => void): Team => { const t = buildTeam('A', '4-4-2', 0); mod(t); return t; };
const run = (home: Team, seed: number, secs: number, sample: (m: Match) => void) => {
  const m = new Match(structuredClone(home), buildTeam('B', '4-4-2', 1), seed, 0.1);
  for (let i = 0; i < secs * 10; i++) { m.step(0.1); if (i % 10 === 0) sample(m); }
  return m;
};
const avg = (home: Team, role: string, pick: (p: { x: number; y: number }) => number, when: 'poss' | 'out' | 'any' = 'any') => {
  let s = 0, n = 0;
  for (const seed of [1, 2, 3]) {
    const id = home.players.find((p) => p.role === role)!.id;
    run(home, seed, 600, (m) => {
      const poss: TeamIdx = m.ball.owner ? m.ball.owner.team : m.ball.lastTeam;
      if (when === 'poss' && poss !== 0) return; if (when === 'out' && poss !== 1) return;
      const p = m.findPlayer(id)!; s += pick(p); n++;
    });
  }
  return s / n;
};
const depthLow = avg(mkTeam((t) => t.players.find((p) => p.role === 'ST')!.inst.depth = -0.6), 'ST', (p) => p.x, 'poss');
const depthHigh = avg(mkTeam((t) => t.players.find((p) => p.role === 'ST')!.inst.depth = 0.5), 'ST', (p) => p.x, 'poss');
ok(`depth: striker dropping deep (${depthLow.toFixed(1)}m) plays much deeper than one staying high (${depthHigh.toFixed(1)}m)`, depthHigh - depthLow > 8, { depthLow, depthHigh });

const laneL = avg(mkTeam((t) => t.players.find((p) => p.role === 'CM')!.inst.lane = 0.1), 'CM', (p) => p.y);
const laneR = avg(mkTeam((t) => t.players.find((p) => p.role === 'CM')!.inst.lane = 0.9), 'CM', (p) => p.y);
ok(`lane: midfielder told to work the left (y=${laneL.toFixed(1)}m) vs the right (y=${laneR.toFixed(1)}m)`, laneR - laneL > 15, { laneL, laneR });

const trackHi = avg(mkTeam((t) => t.players.find((p) => p.role === 'W')!.inst.track = 1), 'W', (p) => p.x, 'out');
const trackLo = avg(mkTeam((t) => t.players.find((p) => p.role === 'W')!.inst.track = 0), 'W', (p) => p.x, 'out');
ok(`track back: winger tracking back (${trackHi.toFixed(1)}m) is deeper than one who doesn't (${trackLo.toFixed(1)}m) when out of possession`, trackLo - trackHi > 3, { trackHi, trackLo });

const crossesFor = (c: number) => { let n = 0; for (const seed of [11, 12, 13, 14, 15, 16]) { const t = mkTeam((tt) => tt.players.forEach((p) => { if (p.role === 'FB' || p.role === 'W') p.inst.cross = c; })); const m = run(t, seed, 5400, () => {}); n += m.stats[0].crosses; } return n; };
const crossHi = crossesFor(1), crossLo = crossesFor(0);
ok(`cross: crossers deliver more (${crossHi}) than players told not to (${crossLo})`, crossHi > crossLo * 1.5 && crossHi > 10, { crossHi, crossLo });

const poacherShots = (() => { let n = 0; for (const seed of [21, 22, 23, 24]) { const t = mkTeam((tt) => { const s = tt.players.find((p) => p.role === 'ST')!; Object.assign(s.inst, ROLE_TEMPLATES.find((x) => x.name === 'Poacher')!.inst); }); n += run(t, seed, 5400, () => {}).stats[0].shots; } return n; })();
ok('role template runs end-to-end in a full match', poacherShots > 20, poacherShots);

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
