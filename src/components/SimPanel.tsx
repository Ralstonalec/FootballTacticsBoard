import type { Match } from '../engine/sim';
import type { Aggregate } from '../engine/batch';
import type { HeatMode } from './Pitch';
import { Section } from './ui';

export function SimPanel(props: {
  match: Match | null; tick: number; playing: boolean; speed: number; heat: HeatMode;
  batchN: number; batchBusy: boolean; batchDone: number; agg: Aggregate | null;
  onStart: () => void; onPlayPause: () => void; onStop: () => void; onSpeed: (s: number) => void;
  onHeat: (h: HeatMode) => void; onBatchN: (n: number) => void; onBatch: () => void; onFinish: () => void;
}) {
  const { match: m } = props;
  const pct = (a: number, b: number) => (a + b > 0 ? Math.round((a / (a + b)) * 100) : 50);
  return (
    <Section title="Live simulation">
      {!m ? (
        <button className="primary" onClick={props.onStart}>▶ Start match</button>
      ) : (
        <>
          <div className="scoreboard">
            <span className="home">{m.teams[0].name}</span>
            <b>{m.score[0]} – {m.score[1]}</b>
            <span className="away">{m.teams[1].name}</span>
          </div>
          <div className="clock">{m.clock}{m.finished ? ' · full time' : ''}</div>
          <div className="row">
            <button onClick={props.onPlayPause} disabled={m.finished}>{props.playing ? '⏸ Pause' : '▶ Play'}</button>
            <select value={props.speed} onChange={(e) => props.onSpeed(Number(e.target.value))}>
              {[1, 5, 15, 30, 60, 120].map((s) => <option key={s} value={s}>{s}× speed</option>)}
            </select>
            <button onClick={props.onFinish} disabled={m.finished} title="Simulate to full time instantly">⏭ Finish</button>
          </div>
          <div className="row">
            <select value={props.heat} onChange={(e) => props.onHeat(e.target.value as HeatMode)}>
              <option value="off">Heat map: off</option>
              <option value="home">Heat map: home ball activity</option>
              <option value="away">Heat map: away ball activity</option>
            </select>
            <button onClick={props.onStop}>✕ Back to edit</button>
          </div>
          <table className="stats" data-tick={props.tick}>
            <tbody>
              {([
                ['Possession', pct(m.stats[0].possessionT, m.stats[1].possessionT) + '%', pct(m.stats[1].possessionT, m.stats[0].possessionT) + '%'],
                ['Shots (on target)', `${m.stats[0].shots} (${m.stats[0].onTarget})`, `${m.stats[1].shots} (${m.stats[1].onTarget})`],
                ['xG', m.stats[0].xg.toFixed(2), m.stats[1].xg.toFixed(2)],
                ['Passes (completed)', `${m.stats[0].passes} (${m.stats[0].passesDone})`, `${m.stats[1].passes} (${m.stats[1].passesDone})`],
                ['Interceptions', m.stats[0].interceptions, m.stats[1].interceptions],
                ['Duels won', m.stats[0].tackles, m.stats[1].tackles],
                ['Won back in opp. half', m.stats[0].highRecoveries, m.stats[1].highRecoveries],
                ['Final-third entries', m.stats[0].finalThirdEntries, m.stats[1].finalThirdEntries],
              ] as [string, string | number, string | number][]).map(([k, a, b]) => (
                <tr key={k}><td className="home">{a}</td><th>{k}</th><td className="away">{b}</td></tr>
              ))}
            </tbody>
          </table>
          <ul className="events">
            {m.events.slice(-6).reverse().map((e, i) => (
              <li key={i} className={e.kind}>{Math.floor(e.t / 60)}′ {e.team === 0 ? '🔵' : '🔴'} {e.text}</li>
            ))}
          </ul>
        </>
      )}
      <h4>Batch test</h4>
      <p className="muted">Plays many full matches at once to find patterns. The feedback panel then reports on the results.</p>
      <div className="row">
        <select value={props.batchN} onChange={(e) => props.onBatchN(Number(e.target.value))} disabled={props.batchBusy}>
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} matches</option>)}
        </select>
        <button className="primary" onClick={props.onBatch} disabled={props.batchBusy}>
          {props.batchBusy ? `Running ${props.batchDone}/${props.batchN}…` : 'Run batch'}
        </button>
      </div>
      {props.agg && props.agg.n > 0 && (
        <div className="batch-result">
          <b>{props.agg.wins[0]}W {props.agg.draws}D {props.agg.wins[1]}L</b> (home) · avg score{' '}
          {(props.agg.goals[0] / props.agg.n).toFixed(2)} – {(props.agg.goals[1] / props.agg.n).toFixed(2)} · avg xG{' '}
          {(props.agg.stats[0].xg / props.agg.n).toFixed(2)} – {(props.agg.stats[1].xg / props.agg.n).toFixed(2)}
        </div>
      )}
    </Section>
  );
}
