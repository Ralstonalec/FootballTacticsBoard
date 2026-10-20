import type { Instructions, PlayerSpec, Role, Team } from '../engine/types';
import { ROLES, ROLE_LABEL, defaultInstructions } from '../engine/types';
import { Section, Slider } from './ui';

export function PlayerPanel(props: {
  player: PlayerSpec | null; number: number; opp: Team; disabled: boolean;
  onChange: (patch: Partial<PlayerSpec>) => void;
  onInst: (patch: Partial<Instructions>) => void;
  onApplyRole: () => void;
  onRemove: () => void;
}) {
  const { player: p, disabled } = props;
  if (!p)
    return (
      <Section title="Player instructions">
        <p className="muted">Click a player on the pitch to give them individual instructions. Drag players to reposition them.</p>
      </Section>
    );
  const i = p.inst;
  const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
  return (
    <Section title={`#${props.number} ${p.role}`} right={<button className="danger" onClick={props.onRemove} disabled={disabled}>Remove</button>}>
      <div className="row">
        <input className="text" value={p.name} onChange={(e) => props.onChange({ name: e.target.value })} disabled={disabled} />
        <select
          value={p.role}
          disabled={disabled}
          onChange={(e) => props.onChange({ role: e.target.value as Role, inst: defaultInstructions(e.target.value as Role) })}
          title="Changing the role resets this player's instructions to that role's defaults"
        >
          {ROLES.map((r) => <option key={r} value={r}>{r} · {ROLE_LABEL[r]}</option>)}
        </select>
      </div>
      <Slider label="Roam" value={i.roam} onChange={(v) => props.onInst({ roam: v })} hint="Freedom to leave their position to follow the ball / find space. 0 = holds position." />
      <Slider label="Press" value={i.press} onChange={(v) => props.onInst({ press: v })} hint="How aggressively they close down the ball carrier when you don't have the ball." />
      <Slider label="Forward runs" value={i.runs} onChange={(v) => props.onInst({ runs: v })} hint="How far beyond their spot they push when you have the ball. Also shown as the arrow on the board." />
      <Slider label="Dribble" value={i.dribble} onChange={(v) => props.onInst({ dribble: v })} hint="Willingness to carry the ball rather than pass." />
      <Slider label="Shoot" value={i.shoot} onChange={(v) => props.onInst({ shoot: v })} hint="Willingness to shoot, including from range." />
      <Slider label="Width" value={i.width} min={-1} max={1} format={pct} onChange={(v) => props.onInst({ width: v })} hint="-100% drifts inside (inverted), +100% hugs the touchline." />
      <label className="field">
        Passing style
        <select value={i.passing} onChange={(e) => props.onInst({ passing: e.target.value as Instructions['passing'] })} disabled={disabled}>
          <option value="safe">Safe (keep the ball)</option>
          <option value="mixed">Mixed</option>
          <option value="direct">Direct (forward, riskier)</option>
        </select>
      </label>
      <label className="field">
        Marking
        <select value={i.mark ?? ''} onChange={(e) => props.onInst({ mark: e.target.value || null })} disabled={disabled}>
          <option value="">Zonal (no man-marking)</option>
          {props.opp.players.map((o, idx) => (
            <option key={o.id} value={o.id}>Man-mark opp #{idx + 1} {o.role}</option>
          ))}
        </select>
      </label>
      <button onClick={props.onApplyRole} disabled={disabled}>Copy to all {p.role}s</button>
    </Section>
  );
}
