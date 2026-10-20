import { useState } from 'react';
import type { Match } from '../engine/sim';
import { shapeMetrics } from '../engine/shape';
import { PLAYBOOKS } from '../engine/playbooks';
import { Section } from './ui';

export interface LabUI {
  playing: boolean;
  speed: number;
  poss: 0 | 1;
  title: string;
  step: number;
  steps: number;
  caption: string;
  shape: boolean;
  labels: 'off' | 'selected' | 'all';
  explaining: boolean;
  generating: boolean;
  explanation: string;
  error: string;
  snapshots: number;
}

export function ShapeLabPanel(props: {
  match: Match; tick: number; ui: LabUI; aiReady: boolean; selected: { label: string; intent: string } | null;
  onPlaybook: (i: number) => void;
  onPlay: () => void;
  onRestart: () => void;
  onSpeed: (s: number) => void;
  onPoss: (p: 0 | 1) => void;
  onShape: (v: boolean) => void;
  onLabels: (v: 'off' | 'selected' | 'all') => void;
  onGenerate: (prompt: string) => void;
  onExplain: () => void;
  onExit: () => void;
}) {
  const { ui, match: m } = props;
  const [prompt, setPrompt] = useState('');
  const mh = shapeMetrics(m, 0);
  const ma = shapeMetrics(m, 1);
  const f = (v: number) => v.toFixed(0);
  const gaps = (x: number[]) => (x.length ? x.map(f).join(' / ') + ' m' : '–');
  return (
    <Section title="🎞 Shape lab" right={<button onClick={props.onExit}>✕ Exit</button>}>
      <p className="muted">
        Watch how both formations move with the ball. <b>Click or drag on the pitch</b> to move the ball yourself, or play a sequence.
        Labels show what each player is deciding to do right now.
      </p>

      <h4>Ball sequence</h4>
      <div className="row">
        <select value="" onChange={(e) => e.target.value !== '' && props.onPlaybook(Number(e.target.value))}>
          <option value="">Choose a playbook…</option>
          {PLAYBOOKS.map((p, i) => <option key={p.title} value={i}>{p.title}</option>)}
        </select>
      </div>
      <div className="row">
        <button className="primary" onClick={props.onPlay} disabled={!ui.steps}>{ui.playing ? '⏸ Pause' : '▶ Play'}</button>
        <button onClick={props.onRestart} disabled={!ui.steps}>⟲ Restart</button>
        <select value={ui.speed} onChange={(e) => props.onSpeed(Number(e.target.value))}>
          {[0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}× speed</option>)}
        </select>
      </div>
      {ui.steps > 0 && (
        <div className="lab-caption">
          <b>{ui.title}</b> · step {Math.min(ui.step + 1, ui.steps)}/{ui.steps}
          <div>{ui.caption}</div>
        </div>
      )}
      <div className="row">
        <span className="muted" style={{ flex: '0 0 auto', alignSelf: 'center' }}>Ball belongs to</span>
        <div className="seg">
          <button className={ui.poss === 0 ? 'on home' : 'home'} onClick={() => props.onPoss(0)}>Home</button>
          <button className={ui.poss === 1 ? 'on away' : 'away'} onClick={() => props.onPoss(1)}>Away</button>
        </div>
      </div>

      <h4>Diagram</h4>
      <div className="row">
        <label><input type="checkbox" checked={ui.shape} onChange={(e) => props.onShape(e.target.checked)} /> lines &amp; shape</label>
        <select value={ui.labels} onChange={(e) => props.onLabels(e.target.value as LabUI['labels'])}>
          <option value="off">Labels: off</option>
          <option value="selected">Labels: selected</option>
          <option value="all">Labels: everyone</option>
        </select>
      </div>
      {props.selected && <p className="intent"><b>{props.selected.label}</b>: {props.selected.intent}</p>}

      <table className="stats" data-tick={props.tick}>
        <tbody>
          <tr><td className="home">{f(mh.length)} m</td><th>Block depth</th><td className="away">{f(ma.length)} m</td></tr>
          <tr><td className="home">{f(mh.width)} m</td><th>Block width</th><td className="away">{f(ma.width)} m</td></tr>
          <tr><td className="home">{gaps(mh.gaps)}</td><th>Gaps between lines</th><td className="away">{gaps(ma.gaps)}</td></tr>
          <tr><td className="home">{mh.lineHeights.length ? f(mh.lineHeights[0]) : '–'} m</td><th>Back line from own goal</th><td className="away">{ma.lineHeights.length ? f(ma.lineHeights[0]) : '–'} m</td></tr>
        </tbody>
      </table>

      <h4>AI</h4>
      <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe a ball sequence to test, e.g. “away win it in midfield and break down our right, then we counter-press”" />
      <div className="row">
        <button onClick={() => props.onGenerate(prompt)} disabled={!props.aiReady || ui.generating || !prompt.trim()}
          title={props.aiReady ? '' : 'AI is not configured (see ⚙ in the feedback panel)'}>
          {ui.generating ? 'Writing…' : '✨ Generate sequence'}
        </button>
        <button onClick={props.onExplain} disabled={!props.aiReady || ui.explaining || ui.snapshots < 2}
          title="Plays a sequence first, then explains what the shape did">
          {ui.explaining ? 'Explaining…' : '✨ Explain what happened'}
        </button>
      </div>
      {!props.aiReady && <p className="muted">Playbooks and the decision labels work without the AI.</p>}
      {ui.error && <p className="error">{ui.error}</p>}
      {ui.explanation && <div className="claude"><h4>✨ What the shape did</h4><div className="claude-text">{ui.explanation}</div></div>}
    </Section>
  );
}
