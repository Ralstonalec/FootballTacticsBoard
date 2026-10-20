import handler from '../api/claude';
import { parseCoachReply, parseScenario } from '../src/engine/ai';
import { buildTeam } from '../src/engine/formations';

type R = { code: number; body: unknown };
const call = async (method: string, body?: unknown, ip = '1.1.1.1'): Promise<R> => {
  let code = 0; let out: unknown;
  const res = { status(c: number) { code = c; return res; }, json(b: unknown) { out = b; } };
  await handler({ method, body, headers: { 'x-forwarded-for': ip } }, res);
  return { code, body: out };
};
let fails = 0;
const ok = (name: string, cond: boolean, extra: unknown = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`, cond ? '' : JSON.stringify(extra)); };

// no key
delete process.env.OPENROUTER_API_KEY;
ok('GET without key reports configured:false', JSON.stringify((await call('GET')).body) === '{"ok":true,"configured":false}');
ok('POST without key -> 503', (await call('POST', { mode: 'coach', content: 'x' })).code === 503);

// with key + stubbed upstream
process.env.OPENROUTER_API_KEY = 'test-key';
let seen: { url?: string; init?: RequestInit } = {};
globalThis.fetch = (async (url: string, init: RequestInit) => {
  seen = { url, init };
  return new Response(JSON.stringify({ choices: [{ message: { content: '{"say":"ok","changes":[]}' } }] }), { status: 200 });
}) as typeof fetch;
ok('GET with key reports configured:true', JSON.stringify((await call('GET')).body).includes('"configured":true'));
const r = await call('POST', { mode: 'coach', content: 'hello' });
ok('POST coach -> 200 with text', r.code === 200 && (r.body as { text: string }).text.includes('"say"'), r);
const sent = JSON.parse(String(seen.init?.body));
ok('server injects its own system prompt', sent.messages[0].role === 'system' && sent.messages[0].content.includes('assistant manager'));
ok('hits OpenRouter', seen.url === 'https://openrouter.ai/api/v1/chat/completions');
ok('key sent upstream only', (seen.init?.headers as Record<string, string>).authorization === 'Bearer test-key');
ok('rejects unknown mode', (await call('POST', { mode: 'anything', content: 'x' })).code === 400);
ok('rejects client-supplied system prompt as mode', (await call('POST', { mode: 'system', content: 'x' })).code === 400);
ok('rejects oversized content', (await call('POST', { mode: 'coach', content: 'a'.repeat(50000) })).code === 400);
ok('rejects prototype-name mode', (await call('POST', { mode: 'toString', content: 'x' })).code === 400);
ok('rejects PUT', (await call('PUT')).code === 405);
let limited = 0;
for (let i = 0; i < 35; i++) if ((await call('POST', { mode: 'coach', content: 'x' }, '9.9.9.9')).code === 429) limited++;
ok('rate limit kicks in after 30/min', limited >= 4, limited);

// coach reply parsing / sanitising
const me = buildTeam('Me', '4-4-2', 0), opp = buildTeam('Opp', '4-4-2', 1);
const parsed = parseCoachReply('Sure!\n```json\n{"say":"Pushing him up","changes":[{"n":2,"set":{"runs":5,"press":0.9,"passing":"direct","mark":3,"hax":1}},{"n":99,"set":{"runs":1}},{"n":1,"set":{"width":"wide"}}],"team":{"lineHeight":0.8,"evil":1}}\n```', me, opp);
ok('parse: valid change kept & clamped', parsed.changes.length === 1 && parsed.changes[0].patch.runs === 1 && parsed.changes[0].patch.press === 0.9, parsed);
ok('parse: marking maps to opponent id', parsed.changes[0].patch.mark === opp.players[2].id);
ok('parse: unknown keys/players dropped', !('hax' in parsed.changes[0].patch) && !('evil' in parsed.team) && parsed.team.lineHeight === 0.8);
let threw = false; try { parseCoachReply('no json here', me, opp); } catch { threw = true; }
ok('parse: non-JSON throws friendly error', threw);
ok('POST scenario mode accepted', (await call('POST', { mode: 'scenario', content: 'x' }, '7.7.7.7')).code === 200);
ok('POST explain mode accepted', (await call('POST', { mode: 'explain', content: 'x' }, '7.7.7.7')).code === 200);
const sc = parseScenario('{"title":"T","steps":[{"x":-5,"y":99,"poss":"away","seconds":99,"caption":"a"},{"x":50,"y":30,"poss":"home","seconds":2,"caption":"b"},{"x":"bad","y":1}]}');
ok('scenario: clamped to pitch/time, bad steps dropped', sc.steps.length === 2 && sc.steps[0].x === 0 && sc.steps[0].y === 68 && sc.steps[0].seconds === 0 && sc.steps[0].poss === 1, sc);
let t2 = false; try { parseScenario('{"steps":[{"x":1,"y":1}]}'); } catch { t2 = true; }
ok('scenario: too-short sequence rejected', t2);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
