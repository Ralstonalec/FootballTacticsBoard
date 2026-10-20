import { SYSTEM, type AIMode } from './_prompts';

// Vercel serverless function. The API key never reaches the browser.
//   OPENROUTER_API_KEY  (required)
//   OPENROUTER_MODEL    (optional, any OpenRouter model id; default below)
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5';
const MAX_CONTENT = 40_000;
const MAX_TOKENS: Record<AIMode, number> = { feedback: 1200, coach: 700, scenario: 900, explain: 900 };

// Best-effort per-instance rate limit (serverless instances do not share memory;
// use Vercel Firewall / Upstash for a hard limit).
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 30;
}

interface Req { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void }

export default async function handler(req: Req, res: Res): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, configured: Boolean(key) });
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
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-title': 'Football Tactics Board' },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
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
