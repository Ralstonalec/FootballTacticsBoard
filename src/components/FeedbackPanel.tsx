import { useState } from 'react';
import type { Finding } from '../engine/analysis';
import type { IdeaResult } from '../engine/ideas';
import { Section } from './ui';

const ICON = { good: '✅', info: 'ℹ️', warn: '⚠️', risk: '🛑' } as const;

export function FeedbackPanel(props: {
  sideName: string;
  findings: Finding[];
  simFindings: Finding[];
  idea: IdeaResult | null;
  ideaMiss: boolean;
  claudeText: string;
  claudeBusy: boolean;
  claudeError: string;
  aiReady: boolean;
  serverAI: boolean;
  apiKey: string; model: string;
  onApiKey: (k: string) => void; onModel: (m: string) => void;
  onAnalyze: (idea: string) => void;
  onApplyIdea: () => void;
  onAsk: (idea: string) => void;
  onHighlight: (ids: string[]) => void;
}) {
  const [idea, setIdea] = useState('');
  const [settings, setSettings] = useState(false);
  const render = (fs: Finding[]) => (
    <ul className="findings">
      {fs.map((f, i) => (
        <li key={i} className={f.severity} onClick={() => props.onHighlight(f.playerIds ?? [])} style={{ cursor: f.playerIds?.length ? 'pointer' : 'default' }}>
          <b>{ICON[f.severity]} {f.title}</b>
          <p>{f.detail}</p>
          {f.playerIds?.length ? <small>click to highlight players</small> : null}
        </li>
      ))}
    </ul>
  );
  return (
    <Section title={`Tactical feedback — ${props.sideName}`} right={<button onClick={() => setSettings(!settings)} title="AI settings">⚙</button>}>
      {settings && (
        <div className="settings">
          <p className="muted">{props.serverAI ? '✅ Server-side AI is configured (key stays on the server).' : 'Server-side AI not detected. For local dev only, paste a key below; it stays in this browser.'}</p>
          <label className="field">Local-dev OpenRouter key (optional)
            <input className="text" type="password" value={props.apiKey} placeholder="sk-or-…" onChange={(e) => props.onApiKey(e.target.value)} />
          </label>
          <label className="field">Model (OpenRouter id)
            <input className="text" value={props.model} onChange={(e) => props.onModel(e.target.value)} />
          </label>
        </div>
      )}
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Describe your idea… e.g. “high press with a back three, wing-backs overlapping, false 9 dropping between the lines”"
        rows={4}
      />
      <div className="row">
        <button className="primary" onClick={() => props.onAnalyze(idea)}>Analyze</button>
        <button onClick={() => props.onAsk(idea)} disabled={!props.aiReady || props.claudeBusy} title={props.aiReady ? 'Ask Claude for a full critique' : 'AI is not configured: set OPENROUTER_API_KEY on Vercel, or paste a key in ⚙ for local dev'}>
          {props.claudeBusy ? 'Asking AI…' : '✨ Ask AI'}
        </button>
      </div>

      {props.idea && (
        <div className="idea">
          <h4>Your idea: {props.idea.matched.join(' + ')}</h4>
          {props.idea.feedback.map((t, i) => <p key={i}>{t}</p>)}
          {props.idea.risks.map((t, i) => <p key={i} className="risk-text">⚠️ {t}</p>)}
          {props.idea.apply && <button onClick={props.onApplyIdea}>Apply this idea to the board</button>}
        </div>
      )}
      {props.ideaMiss && <p className="muted">I didn't recognise a specific concept in that text (offline mode understands: press, low block, counter, possession, false 9, wing-backs, overload left/right, inverted full-backs, back three/five, offside trap). Configure the AI (see ⚙) to have Claude critique free-form ideas.</p>}

      {props.claudeError && <p className="error">{props.claudeError}</p>}
      {props.claudeText && (
        <div className="claude">
          <h4>✨ AI's take</h4>
          <div className="claude-text">{props.claudeText}</div>
        </div>
      )}

      {props.simFindings.length > 0 && (<><h4>From simulation</h4>{render(props.simFindings)}</>)}
      <h4>Structure &amp; instructions</h4>
      {render(props.findings)}
    </Section>
  );
}
