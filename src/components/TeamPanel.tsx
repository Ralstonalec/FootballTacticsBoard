import { useRef, useState } from 'react';
import type { Team } from '../engine/types';
import { FORMATIONS } from '../engine/formations';
import { shapeString } from '../engine/analysis';
import { Section, Slider } from './ui';

const KEY = 'ftb.saved';
function loadSaved(): Record<string, Team> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}

export function TeamPanel(props: {
  team: Team; teamIdx: 0 | 1; disabled: boolean;
  onFormation: (f: string) => void;
  onTactics: (patch: Partial<Team['tactics']>) => void;
  onRename: (n: string) => void;
  onMirror: () => void;
  onReplace: (t: Team) => void;
}) {
  const { team, disabled } = props;
  const [saved, setSaved] = useState(loadSaved);
  const [pick, setPick] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const t = team.tactics;

  const save = () => {
    const name = prompt('Name for this setup?', `${shapeString(team)} custom`);
    if (!name) return;
    const next = { ...saved, [name]: team };
    setSaved(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  const load = () => {
    const s = saved[pick];
    if (s) props.onReplace(structuredClone(s));
  };
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(team, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${team.name.replace(/\W+/g, '_')}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (f: File) => {
    try {
      const parsed = JSON.parse(await f.text()) as Team;
      if (!Array.isArray(parsed.players) || !parsed.tactics) throw new Error('bad file');
      props.onReplace(parsed);
    } catch { alert('That file is not a valid team export.'); }
  };

  return (
    <Section title={`${props.teamIdx === 0 ? 'Home' : 'Away'} team`} right={<span className="tag">{shapeString(team)}</span>}>
      <input className="text" value={team.name} onChange={(e) => props.onRename(e.target.value)} disabled={disabled} aria-label="Team name" />
      <h4>Formation</h4>
      <div className="row">
        <select className="full" value="" onChange={(e) => e.target.value && props.onFormation(e.target.value)} disabled={disabled}>
          <option value="">Preset formation…</option>
          {Object.keys(FORMATIONS).map((f) => <option key={f}>{f}</option>)}
        </select>
        <button className="fit" onClick={props.onMirror} disabled={disabled} title="Flip left/right">⇆ Mirror</button>
      </div>
      <h4>Saved setups</h4>
      <div className="row">
        <select className="full" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{Object.keys(saved).length ? 'Choose a saved setup…' : 'Nothing saved yet'}</option>
          {Object.keys(saved).map((k) => <option key={k}>{k}</option>)}
        </select>
        <button className="fit" onClick={load} disabled={disabled || !pick}>Load</button>
      </div>
      <div className="row">
        <button onClick={save}>💾 Save</button>
        <button onClick={exportJson}>⬇ Export</button>
        <button onClick={() => fileRef.current?.click()} disabled={disabled}>⬆ Import</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
      </div>
      <h4>Team instructions</h4>
      <div className="sliders">
      <Slider label="Defensive line" value={t.lineHeight} onChange={(v) => props.onTactics({ lineHeight: v })} hint="Low = deep block. High = high line and pressing further up the pitch." />
      <Slider label="Compactness" value={t.compactness} onChange={(v) => props.onTactics({ compactness: v })} hint="How tightly the team shifts toward the ball." />
      <Slider label="Tempo" value={t.tempo} onChange={(v) => props.onTactics({ tempo: v })} hint="Low = patient, holds the ball. High = quick decisions." />
      <Slider label="Width" value={t.width} onChange={(v) => props.onTactics({ width: v })} hint="Stretch or squeeze the shape across the pitch." />
      </div>
    </Section>
  );
}
