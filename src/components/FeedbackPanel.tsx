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
  onOpenSettings: () => void;
  onAnalyze: (idea: string) => void;
  onApplyIdea: () => void;
  onAsk: (idea: string) => void;
  onHighlight: (ids: string[]) => void;
}) {
  const [idea, setIdea] = useState('');
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
    <Section title={`Tactical feedback — ${props.sideName}`} right={<button onClick={props.onOpenSettings} title="AI settings">⚙ AI settings</button>}>
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder="Describe your idea… e.g. “high press with a back three, wing-backs overlapping, false 9 dropping between the lines”"
        rows={4}
      />
      <div className="row">
        <button className="primary" onClick={() => props.onAnalyze(idea)}>Analyze</button>
        <button onClick={() => props.onAsk(idea)} disabled={!props.aiReady || props.claudeBusy} title={props.aiReady ? 'Ask Claude for a full critique' : 'AI is not configured: open the 🤖 AI button (top right) to set it up'}>
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
      {props.ideaMiss && <p className="muted">I didn't recognise a specific concept in that text (offline mode understands: press, low block, counter, possession, false 9, wing-backs, overload left/right, inverted full-backs, back three/five, offside trap). Set up the AI (🤖 button, top right) to have the AI critique free-form ideas.</p>}

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
