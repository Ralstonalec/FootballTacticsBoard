import { useState } from 'react';
import { Section } from './ui';

export interface CoachLogEntry { from: 'you' | 'coach'; text: string; changes?: string[] }

const EXAMPLES = [
  'Left back, get forward and overlap',
  'Both strikers press the centre-backs',
  'We\'re 1-0 up: sit deeper and slow it down',
  'Man-mark their number 10 with our DM',
  'Switch the play to the right wing',
];

export function CoachPanel(props: {
  aiReady: boolean; busy: boolean; live: boolean; log: CoachLogEntry[]; selectedLabel: string | null;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim() || props.busy) return;
    props.onSend(text.trim());
    setText('');
  };
  return (
    <Section title={props.live ? '🎙 Coach the team — live' : '🎙 Coach the team'}>
      <p className="muted">
        Tell the AI assistant manager what to change, in plain words. It edits individual players' instructions
        {props.live ? ' instantly, mid-match.' : '; during a match it applies instantly.'}
        {props.selectedLabel ? ` (${props.selectedLabel} is selected: say "him" or "this player".)` : ''}
      </p>
      <textarea
        rows={2}
        value={text}
        placeholder="e.g. “number 7 stay wider and press higher, number 3 mark their striker”"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
      />
      <div className="chips">
        {EXAMPLES.map((x) => <button key={x} className="chip" onClick={() => setText(x)}>{x}</button>)}
      </div>
      <button className="primary" onClick={send} disabled={!props.aiReady || props.busy || !text.trim()}
        title={props.aiReady ? '' : 'AI is not configured yet (see ⚙ in the feedback panel). The quick-coach buttons on each player work without it.'}>
        {props.busy ? 'Thinking…' : 'Send to assistant'}
      </button>
      {!props.aiReady && <p className="muted">AI not configured: use the quick-coach buttons / sliders on each player, or set up the API key.</p>}
      <ul className="coach-log">
        {props.log.slice(-6).map((l, i) => (
          <li key={i} className={l.from}>
            <b>{l.from === 'you' ? 'You' : 'Assistant'}:</b> {l.text}
            {l.changes?.map((c, j) => <div key={j} className="change">→ {c}</div>)}
          </li>
        ))}
      </ul>
    </Section>
  );
}
