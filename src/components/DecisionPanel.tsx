import { Section } from './ui';

export interface DecisionOpts { home: boolean; away: boolean; every: number; wait: boolean; cap: number }
export interface DecisionLogEntry { clock: string; team: 0 | 1; say: string; orders: string[]; error?: boolean }

export function DecisionPanel(props: {
  opts: DecisionOpts; onOpts: (o: Partial<DecisionOpts>) => void;
  aiReady: boolean; model: string; calls: number; thinking: boolean; log: DecisionLogEntry[];
}) {
  const { opts } = props;
  return (
    <Section title="🧠 AI decision model" right={props.thinking ? <span className="tag">thinking…</span> : <span className="tag">{props.calls}/{opts.cap} calls</span>}>
      <p className="muted">
        The engine plays the match moment to moment; the decision model reads the situation every few match-seconds and gives
        individual players short-lived orders (press, cover, overlap, mark…). Live matches only.
      </p>
      <label className="check"><input type="checkbox" checked={opts.home} disabled={!props.aiReady} onChange={(e) => props.onOpts({ home: e.target.checked })} /> AI decides for <b className="home">Home</b></label>
      <label className="check"><input type="checkbox" checked={opts.away} disabled={!props.aiReady} onChange={(e) => props.onOpts({ away: e.target.checked })} /> AI decides for <b className="away">Away</b></label>
      <div className="row">
        <select value={opts.every} onChange={(e) => props.onOpts({ every: Number(e.target.value) })} title="Match-seconds between decisions for each team">
          {[10, 20, 40, 90].map((s) => <option key={s} value={s}>every {s}s</option>)}
        </select>
        <select value={opts.cap} onChange={(e) => props.onOpts({ cap: Number(e.target.value) })} title="Maximum model calls per match (cost control)">
          {[30, 80, 200, 500].map((c) => <option key={c} value={c}>max {c} calls</option>)}
        </select>
      </div>
      <label className="check"><input type="checkbox" checked={opts.wait} onChange={(e) => props.onOpts({ wait: e.target.checked })} /> pause the match while the AI thinks</label>
      {!props.aiReady && <p className="muted">AI is not configured: set OPENROUTER_API_KEY on Vercel (or paste a key in ⚙ for local dev).</p>}
      {props.aiReady && props.model && <p className="muted">Decision model: <code>{props.model}</code></p>}
      <ul className="coach-log">
        {props.log.slice(-6).reverse().map((l, i) => (
          <li key={i} className={l.error ? 'you' : 'coach'}>
            <b>{l.clock} {l.team === 0 ? '🔵' : '🔴'}</b> {l.say}
            {l.orders.map((o, j) => <div key={j} className="change">→ {o}</div>)}
          </li>
        ))}
      </ul>
    </Section>
  );
}
