import { SYSTEM, type AIMode } from './_prompts.js';

// Vercel serverless function. The API key never reaches the browser.
//   OPENROUTER_API_KEY         (required)
//   OPENROUTER_TEXT_MODEL      model for coach / feedback / scenario / explain (falls back to OPENROUTER_MODEL, then default)
//   OPENROUTER_DECISION_MODEL  model for in-match player decisions; pick a fast, cheap one
//   OPENROUTER_BASE_URL        optional, for proxies / tests (default https://openrouter.ai/api/v1)
const DEFAULT_TEXT_MODEL = 'anthropic/claude-sonnet-4.5';
const DEFAULT_DECISION_MODEL = 'anthropic/claude-haiku-4.5';
const textModel = () => process.env.OPENROUTER_TEXT_MODEL || process.env.OPENROUTER_MODEL || DEFAULT_TEXT_MODEL;
const decisionModel = () => process.env.OPENROUTER_DECISION_MODEL || DEFAULT_DECISION_MODEL;
const MAX_CONTENT = 40_000;
const MAX_TOKENS: Record<AIMode, number> = { feedback: 1200, coach: 700, scenario: 900, explain: 900, decide: 600, role: 500 };

// Best-effort per-instance rate limit (serverless instances do not share memory;
// use Vercel Firewall / Upstash for a hard limit).
const RATE_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 60;
const baseUrl = () => process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > (RATE_PER_MIN);
}

interface Req { method?: string; body?: unknown; url?: string; query?: Record<string, string | string[] | undefined>; headers: Record<string, string | string[] | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void }

export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    await handle(req, res);
  } catch (e) {
    console.error('api/claude failed:', e);
    res.status(500).json({ error: `The AI function crashed: ${e instanceof Error ? e.message : String(e)}` });
  }
}

async function handle(req: Req, res: Res): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (req.method === 'GET') {
    const wantsCheck = req.query?.check === '1' || (req.url ?? '').includes('check=1');
    if (wantsCheck) {
      const fwd0 = req.headers['x-forwarded-for'];
      const ip0 = (Array.isArray(fwd0) ? fwd0[0] : fwd0)?.split(',')[0]?.trim() ?? 'unknown';
      if (limited(ip0)) { res.status(429).json({ error: 'Too many requests, slow down.' }); return; }
      res.status(200).json({ checks: await diagnose(key) });
      return;
    }
    res.status(200).json({ ok: true, configured: Boolean(key), textModel: textModel(), decisionModel: decisionModel() });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!key) {
    res.status(503).json({ error: 'OPENROUTER_API_KEY is not set on the server.' });
    return;
  }
  const fwd = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() ?? 'unknown';
  if (limited(ip)) {
    res.status(429).json({ error: 'Too many requests, slow down.' });
    return;
  }

  const body = (typeof req.body === 'string' ? safeParse(req.body) : req.body) as { mode?: string; content?: string } | null;
  const mode = body?.mode as AIMode | undefined;
  const content = body?.content;
  if (!mode || !Object.hasOwn(SYSTEM, mode) || typeof content !== 'string' || !content || content.length > MAX_CONTENT) {
    res.status(400).json({ error: 'Invalid request.' });
    return;
  }

  try {
    const upstream = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-title': 'Football Tactics Board' },
      body: JSON.stringify({
        model: mode === 'decide' ? decisionModel() : textModel(),
        max_tokens: MAX_TOKENS[mode],
        messages: [
          { role: 'system', content: SYSTEM[mode] },
          { role: 'user', content },
        ],
      }),
    });
    const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    if (!upstream.ok) {
      res.status(502).json({ error: data.error?.message ?? `Upstream error ${upstream.status}` });
      return;
    }
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) {
      res.status(502).json({ error: 'The model returned an empty reply.' });
      return;
    }
    res.status(200).json({ text });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'Upstream request failed' });
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

export interface Check { name: string; ok: boolean; detail: string }

/** Step-by-step connection check. Never returns the key itself. */
async function diagnose(key: string | undefined): Promise<Check[]> {
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail });

  if (!key) {
    add('API key is set on the server', false, 'OPENROUTER_API_KEY is empty here. In Vercel: Project, Settings, Environment Variables: add it for the environment you are visiting (Production vs Preview) and REDEPLOY; changes only apply to new deployments.');
    return out;
  }
  add('API key is set on the server', true, `found a ${key.length}-character value`);

  const problems: string[] = [];
  if (key !== key.trim()) problems.push('has leading/trailing whitespace or a newline');
  if (/["']/.test(key)) problems.push('contains quote characters (paste the raw key, no quotes)');
  if (!key.trim().startsWith('sk-or-')) problems.push('does not start with "sk-or-" (is it an OpenRouter key, not an OpenAI/Anthropic one?)');
  add('Key looks well-formed', problems.length === 0, problems.length ? problems.join('; ') : 'starts with sk-or- and has no stray characters');

  const auth = { authorization: `Bearer ${key.trim()}` };
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${baseUrl()}${path}`, { headers, signal: AbortSignal.timeout(12_000) });
  const why = async (r: Response) => {
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    return `HTTP ${r.status}${j.error?.message ? `: ${j.error.message}` : ''}`;
  };

  try {
    const r = await get('/key', auth);
    if (r.ok) {
      const j = (await r.json()) as { data?: { limit_remaining?: number | null; is_free_tier?: boolean } };
      const rem = j.data?.limit_remaining;
      add('OpenRouter accepts the key', true, rem == null ? 'valid; no spend limit set' : `valid; $${rem.toFixed(2)} of its limit remaining${j.data?.is_free_tier ? ' (free tier)' : ''}`);
      if (typeof rem === 'number' && rem <= 0) add('Key has credit', false, 'the key spend limit is used up: raise it or add credits at openrouter.ai/credits');
    } else {
      add('OpenRouter accepts the key', false, `${await why(r)}${r.status === 401 ? ' (key is invalid, revoked, or copied wrongly)' : ''}`);
      return out;
    }
  } catch (e) {
    add('Server can reach openrouter.ai', false, e instanceof Error ? e.message : 'request failed or timed out');
    return out;
  }

  const wanted = [['text', textModel()], ['decision', decisionModel()]] as const;
  try {
    const r = await get('/models');
    if (r.ok) {
      const ids = new Set(((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? []);
      for (const [label, id] of wanted) add(`${label[0].toUpperCase()}${label.slice(1)} model exists`, ids.has(id), ids.has(id) ? id : `"${id}" is not an OpenRouter model id. Copy the exact id from openrouter.ai/models and set OPENROUTER_${label.toUpperCase()}_MODEL.`);
    }
  } catch { /* the live calls below will surface any network problem */ }

  for (const [label, id] of wanted) {
    try {
      const r = await fetch(`${baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ model: id, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] }),
        signal: AbortSignal.timeout(20_000),
      });
      const label2 = `${label[0].toUpperCase()}${label.slice(1)} model answers`;
      if (r.ok) add(label2, true, id);
      else {
        const detail = await why(r);
        const hint = r.status === 402 ? ' (out of credits: add some at openrouter.ai/credits)' : r.status === 404 ? ' (model unavailable; check your OpenRouter privacy/data-policy settings or pick another model)' : r.status === 429 ? ' (rate limited by OpenRouter or the provider)' : '';
        add(label2, false, `${id}: ${detail}${hint}`);
      }
    } catch (e) {
      add(`${label[0].toUpperCase()}${label.slice(1)} model answers`, false, `${id}: ${e instanceof Error ? e.message : 'timed out'}`);
    }
  }
  return out;
}
