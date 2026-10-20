import { Match, ORDERS } from '../src/engine/sim';
import { buildTeam } from '../src/engine/formations';

let fails = 0;
const ok = (n: string, c: boolean, x: unknown = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`, c ? '' : JSON.stringify(x)); };

// 1. orders change behaviour: a defender ordered to 'overlap' ends up much higher up the pitch than one told to 'drop'
const mk = () => new Match(buildTeam('A', '4-4-2', 0), buildTeam('B', '4-4-2', 1), 11, 0.1);
const avgX = (m: Match, id: string, secs: number) => { const p = m.findPlayer(id)!; let s = 0; for (let i = 0; i < secs * 10; i++) { m.step(0.1); s += p.x; } return s / (secs * 10); };
const a = mk(), b = mk(), c = mk();
const idOf = (m: Match) => m.teams[0].players[1].id; // left full-back
const fbId = idOf(a);
for (let i = 0; i < 300; i++) { a.step(0.1); b.step(0.1); c.step(0.1); }
ok('giveOrder accepts a valid order', a.giveOrder(fbId, 'overlap', 40, 'test'));
b.giveOrder(idOf(b), 'drop', 40, 'test');
const xa = avgX(a, idOf(a), 40), xb = avgX(b, idOf(b), 40), xc = avgX(c, idOf(c), 40);
ok(`overlap (${xa.toFixed(1)}m) sits higher than drop (${xb.toFixed(1)}m), baseline ${xc.toFixed(1)}m`, xa > xb + 5, { xa, xb, xc });
const lbl = mk(); lbl.giveOrder(idOf(lbl), 'press', 20); lbl.step(0.1);
ok('player label shows the order', lbl.findPlayer(idOf(lbl))!.intent.includes('★'), lbl.findPlayer(idOf(lbl))!.intent);

// 2. expiry
const e = mk();
const id = e.teams[0].players[5].id;
const instBefore = JSON.stringify(e.findPlayer(id)!.spec.inst);
e.giveOrder(id, 'press', 10, '');
for (let i = 0; i < 50; i++) e.step(0.1);
ok('order active before expiry', e.findPlayer(id)!.order !== null);
for (let i = 0; i < 100; i++) e.step(0.1);
ok('order expires on its own', e.findPlayer(id)!.order === null);
ok('base instructions untouched by orders', JSON.stringify(e.findPlayer(id)!.spec.inst) === instBefore);

// 3. guards
ok('GK cannot be given orders', !e.giveOrder(e.teams[0].players[0].id, 'press', 10));
ok('unknown order rejected', !e.giveOrder(id, 'moonwalk', 10));
ok('mark needs a valid target', !e.giveOrder(id, 'mark', 10) && e.giveOrder(id, 'mark', 10, '', e.teams[1].players[9].id));
ok('every order name has a label', Object.values(ORDERS).every((o) => o.label.length > 3));

// 4. orders affect outcomes: team A always counter-pressing / pressing vs none (same seeds) - just ensure it runs and stats stay sane
const m = mk();
for (let i = 0; i < 6000; i++) { if (i % 300 === 0) for (const p of m.teams[0].players.slice(1)) m.giveOrder(p.id, 'press', 25); m.step(0.1); }
ok('match with constant AI orders still plays sensibly', m.stats[0].passes > 20 && m.stats[1].passes > 20, [m.stats[0].passes, m.stats[1].passes]);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
