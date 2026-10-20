// Smoke test against the REAL OpenRouter API, using your key and models.
//   OPENROUTER_API_KEY=sk-or-... [OPENROUTER_TEXT_MODEL=...] [OPENROUTER_DECISION_MODEL=...] npm run livetest
import handler from '../api/claude';
import { buildDecisionState, parseCoachReply, parseDecisions, parseScenario } from '../src/engine/ai';
import { Match } from '../src/engine/sim';
import { buildTeam } from '../src/engine/formations';

if (!process.env.OPENROUTER_API_KEY) { console.error('Set OPENROUTER_API_KEY first.'); process.exit(2); }

const call = async (mode: string, content: string) => {
  let code = 0; let out: { text?: string; error?: string } = {};
  const res = { status(c: number) { code = c; return res; }, json(b: unknown) { out = b as typeof out; } };
  const t0 = Date.now();
  await handler({ method: 'POST', body: { mode, content }, headers: {} }, res);
  return { code, ms: Date.now() - t0, ...out };
};
let fails = 0;
const report = (name: string, ok: boolean, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };

const me = buildTeam('Home', '4-3-3', 0), opp = buildTeam('Away', '4-4-2', 1);
const m = new Match(me, opp, 1, 0.1);
for (let i = 0; i < 900; i++) m.step(0.1);

const info = await handler({ method: 'GET', headers: {} }, { status: () => ({ json: () => {} }) as never, json: (b: unknown) => console.log('config:', JSON.stringify(b)) });
void info;

// decision model (the in-match player decisions)
const d = await call('decide', buildDecisionState(m, 0));
if (d.code !== 200) report('decision model call', false, `${d.code} ${d.error}`);
else {
  try {
    const parsed = parseDecisions(d.text!, m, 0);
    report('decision model returns valid orders', true, `${parsed.orders.length} orders in ${d.ms}ms: ${parsed.orders.map((o) => `#${o.n} ${o.order}`).join(', ') || '(none needed)'} | "${parsed.say}"`);
  } catch (e) { report('decision model returns valid orders', false, `${(e as Error).message}\n   raw: ${d.text?.slice(0, 300)}`); }
}

// text model: coach command
const c = await call('coach', `Coach's instruction: right back push up and go wide, striker press harder\n\nMy team:\n${JSON.stringify(me.players.map((p, i) => ({ n: i + 1, role: p.role, x: p.x, y: p.y, ...p.inst })))}\n\nOpponent:\n[]`);
if (c.code !== 200) report('text model: coach', false, `${c.code} ${c.error}`);
else { try { const r = parseCoachReply(c.text!, me, opp); report('text model: coach reply parses', r.changes.length > 0, `${r.changes.length} changes in ${c.ms}ms: ${r.changes.map((x) => x.label).join(' | ')}`); } catch (e) { report('text model: coach reply parses', false, `${(e as Error).message}\n   raw: ${c.text?.slice(0, 300)}`); } }

// text model: shape-lab scenario
const s = await call('scenario', `Coach's request: away win it in midfield and break down our right\n\nHome: ${me.players.map((p) => p.role).join(' ')}\nAway: ${opp.players.map((p) => p.role).join(' ')}`);
if (s.code !== 200) report('text model: scenario', false, `${s.code} ${s.error}`);
else { try { const r = parseScenario(s.text!); report('text model: scenario parses', true, `${r.steps.length} steps in ${s.ms}ms ("${r.title}")`); } catch (e) { report('text model: scenario parses', false, `${(e as Error).message}\n   raw: ${s.text?.slice(0, 300)}`); } }

console.log(fails ? `\n${fails} FAILED. If replies are not valid JSON, pick a model that follows format instructions better.` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
