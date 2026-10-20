import { useState } from 'react';
import type { Instructions, PlayerSpec, Role, Team } from '../engine/types';
import { ROLES, ROLE_LABEL, defaultInstructions } from '../engine/types';
import { Section, Slider } from './ui';
import { ROLE_TEMPLATES } from '../engine/roles';

const FINE_KEY = 'ftb.fineOpen';
const readFine = () => { try { return localStorage.getItem(FINE_KEY) === '1'; } catch { return false; } };

const c01 = (v: number) => Math.max(0, Math.min(1, v));
const QUICK: [string, (i: Instructions) => Partial<Instructions>][] = [
  ['Push up', (i) => ({ runs: c01(i.runs + 0.3), press: c01(i.press + 0.1) })],
  ['Drop deeper', (i) => ({ runs: c01(i.runs - 0.3), press: c01(i.press - 0.2) })],
  ['Press hard', () => ({ press: 1 })],
  ['Hold position', () => ({ roam: 0, runs: 0.1 })],
  ['Go wide', (i) => ({ width: Math.min(1, i.width + 0.6) })],
  ['Cut inside', (i) => ({ width: Math.max(-1, i.width - 0.8) })],
  ['Shoot more', () => ({ shoot: 0.95 })],
  ['Play safe', () => ({ passing: 'safe', dribble: 0.1, shoot: 0.1 })],
  ['Be direct', () => ({ passing: 'direct', runs: 0.9 })],
  ['Free role', () => ({ roam: 0.9 })],
  ['Zonal', () => ({ mark: null })],
];

export interface BriefReport { source: 'offline' | 'ai' | 'template'; notes: string[]; changes: string[]; unmatched?: boolean; error?: string; notice?: string; summary?: string; unsupported?: string[] }

const EXAMPLES = [
  'Drop deep between the centre-backs, play safe passes, never shoot',
  'Stay wide, beat his man and cross at every chance',
  'Sit in front of the back four and break up attacks',
  'Make late runs into the box and shoot on sight',
  'Cut inside from the left and press their full-back',
];

const LANES: [string, number | null][] = [
  ['Formation default', null], ['Left wing', 0.12], ['Left half-space', 0.3], ['Centre', 0.5], ['Right half-space', 0.7], ['Right wing', 0.88],
];

export function PlayerPanel(props: {
  player: PlayerSpec | null; number: number; opp: Team; disabled: boolean;
  onChange: (patch: Partial<PlayerSpec>) => void;
  onInst: (patch: Partial<Instructions>) => void;
  onApplyRole: () => void;
  onRemove: () => void;
  onQuick: (fn: (i: Instructions) => Partial<Instructions>, label: string) => void;
  onMarkNearest: () => void;
  live: boolean;
  aiReady: boolean;
  briefBusy: boolean;
  report: BriefReport | null;
  onApplyBrief: (text: string, useAI: boolean) => void;
  onTemplate: (name: string) => void;
}) {
  const { player: p, disabled } = props;
  const [fineOpen, setFineOpen] = useState(readFine); // remembered: people who tweak sliders keep them open
  if (!p)
    return (
      <Section title="Player instructions">
        <p className="muted">Click a player on the pitch to give them individual instructions. Drag players to reposition them.</p>
      </Section>
    );
  const i = p.inst;
  const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
  return (
    <Section title={`#${props.number} ${p.role}${p.roleName ? ' · ' + p.roleName : ''}`} right={<button className="danger" onClick={props.onRemove} disabled={disabled}>Remove</button>}>
      <input className="text" value={p.name} onChange={(e) => props.onChange({ name: e.target.value })} disabled={disabled} aria-label="Player name" />
      <select
        className="full"
        value={p.role}
        disabled={disabled}
        onChange={(e) => props.onChange({ role: e.target.value as Role, inst: defaultInstructions(e.target.value as Role), roleName: undefined })}
        title="Changing the base position resets this player's instructions to that position's defaults"
      >
        {ROLES.map((r) => <option key={r} value={r}>{r} · {ROLE_LABEL[r]}</option>)}
      </select>

      <h4>Describe how this player should play</h4>
      <textarea
        className="brief"
        rows={5}
        value={p.brief ?? ''}
        onChange={(e) => props.onChange({ brief: e.target.value })}
        placeholder="Write as much detail as you like. e.g. “Our pivot. Drops between the centre-backs to start attacks, plays short and safe, never shoots, and screens the back four when we lose it. If their number 10 gets the ball, stick tight to him.”"
        aria-label="Describe how this player should play"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (p.brief ?? '').trim()) props.onApplyBrief(p.brief ?? '', true); }}
      />
      <button className="primary wide" onClick={() => props.onApplyBrief(p.brief ?? '', true)} disabled={props.briefBusy || !(p.brief ?? '').trim()}
        title="The AI reads your description and sets how this player plays (Ctrl/Cmd+Enter)">
        {props.briefBusy ? '✨ Analysing…' : props.aiReady ? '✨ Analyse & apply' : '✨ Analyse & apply (built-in interpreter, AI not set up)'}
      </button>
      <div className="row subtle">
        <select className="full" value="" onChange={(e) => e.target.value && props.onChange({ brief: e.target.value })} aria-label="Insert an example">
          <option value="">Insert an example…</option>
          {EXAMPLES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <button className="fit" onClick={() => props.onApplyBrief(p.brief ?? '', false)} disabled={!(p.brief ?? '').trim()} title="Skip the AI: only understands common football phrases">Offline only</button>
      </div>
      {props.report && (
        <div className={`understood ${props.report.error ? 'bad' : ''}`}>
          <b>{props.report.error ? `⚠️ ${props.report.error}` : props.report.unmatched ? '🤔 Not recognised' : props.report.source === 'ai' ? '✨ Analysis' : props.report.source === 'template' ? '✅ Role applied' : '✅ Understood as'}</b>
          {props.report.summary && <div className="summary">{props.report.summary}</div>}
          {props.report.notes.map((n, k) => <div key={k}>• {n}</div>)}
          {props.report.unmatched && <div className="muted">I didn't recognise any football instructions in that. Use words like “drop deep”, “stay wide”, “press”, “cross”, “mark their number 9”, or set up the AI to analyse free-form descriptions.</div>}
          {props.report.unsupported && props.report.unsupported.length > 0 && <div className="unsupported">⚠️ The simulator can't model: {props.report.unsupported.join('; ')}</div>}
          {props.report.notice && <div className="notice">ℹ️ {props.report.notice}</div>}
          {props.report.changes.length > 0 && <div className="changes">{props.report.changes.map((c, k) => <span key={k}>{c}</span>)}</div>}
        </div>
      )}
      <select
        className="full"
        value=""
        onChange={(e) => e.target.value && props.onTemplate(e.target.value)}
        title="Applies a known role: base position plus a tuned set of behaviours"
      >
        <option value="">…or start from a role template</option>
        {ROLE_TEMPLATES.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.role})</option>)}
      </select>

      <h4>{props.live ? 'Coach now (applies instantly)' : 'Quick coaching'}</h4>
      <div className="quick">
        {QUICK.map(([label, fn]) => <button key={label} onClick={() => props.onQuick(fn, label)}>{label}</button>)}
        <button onClick={props.onMarkNearest}>Mark nearest</button>
      </div>

      <details className="fine" open={fineOpen} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setFineOpen(o); try { localStorage.setItem(FINE_KEY, o ? '1' : '0'); } catch { /* ignore */ } }}>
        <summary>Fine-tune every setting</summary>
        <div className="sliders">
          <Slider label="Roam" value={i.roam} onChange={(v) => props.onInst({ roam: v })} hint="Freedom to leave their position to follow the ball / find space. 0 = holds position." />
          <Slider label="Press" value={i.press} onChange={(v) => props.onInst({ press: v })} hint="How aggressively they close down the ball carrier when you don't have the ball." />
          <Slider label="Runs" value={i.runs} onChange={(v) => props.onInst({ runs: v })} hint="How far beyond their spot they push when you have the ball. Also shown as the arrow on the board." />
          <Slider label="Dribble" value={i.dribble} onChange={(v) => props.onInst({ dribble: v })} hint="Willingness to carry the ball rather than pass." />
          <Slider label="Shoot" value={i.shoot} onChange={(v) => props.onInst({ shoot: v })} hint="Willingness to shoot, including from range." />
          <Slider label="Width" value={i.width} min={-1} max={1} format={pct} onChange={(v) => props.onInst({ width: v })} hint="-100% drifts inside (inverted), +100% hugs the touchline." />
          <Slider label="Depth" value={i.depth ?? 0} min={-1} max={1} format={pct} onChange={(v) => props.onInst({ depth: v })} hint="-100% drops deep to link play (false 9, playmaker, sweeper); +100% stays high on the last line (poacher)." />
          <Slider label="Track back" value={i.track ?? 0.5} onChange={(v) => props.onInst({ track: v })} hint="How hard they recover and track back when the opponent has the ball. 50% is normal." />
          <Slider label="Crossing" value={i.cross ?? 0.5} onChange={(v) => props.onInst({ cross: v })} hint="Wide players in the final third: 0% never deliver early/wide balls, 100% cross at every chance." />
        </div>
        <label className="field">
          Channel
          <select value={String(i.lane ?? '')} onChange={(e) => props.onInst({ lane: e.target.value === '' ? null : Number(e.target.value) })}>
            {LANES.map(([label, v]) => <option key={label} value={v == null ? '' : String(v)}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          Passing style
          <select value={i.passing} onChange={(e) => props.onInst({ passing: e.target.value as Instructions['passing'] })}>
            <option value="safe">Safe (keep the ball)</option>
            <option value="mixed">Mixed</option>
            <option value="direct">Direct (forward, riskier)</option>
          </select>
        </label>
        <label className="field">
          Marking
          <select value={i.mark ?? ''} onChange={(e) => props.onInst({ mark: e.target.value || null })}>
            <option value="">Zonal (no man-marking)</option>
            {props.opp.players.map((o, idx) => (
              <option key={o.id} value={o.id}>Man-mark opp #{idx + 1} {o.role}</option>
            ))}
          </select>
        </label>
      </details>
      <button onClick={props.onApplyRole} disabled={disabled}>Copy to all {p.role}s</button>
    </Section>
  );
}
