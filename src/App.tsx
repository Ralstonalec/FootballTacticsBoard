import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pitch, HeatMode } from './components/Pitch';
import { TeamPanel } from './components/TeamPanel';
import { PlayerPanel } from './components/PlayerPanel';
import { SimPanel } from './components/SimPanel';
import { FeedbackPanel } from './components/FeedbackPanel';
import { buildTeam } from './engine/formations';
import { Instructions, PlayerSpec, Role, Team, makePlayer } from './engine/types';
import { Match } from './engine/sim';
import { Aggregate, runBatch } from './engine/batch';
import { Finding, simFindings, staticFindings } from './engine/analysis';
import { IdeaResult, interpretIdea } from './engine/ideas';
import { askClaude } from './engine/ai';

const STATE_KEY = 'ftb.board.v1';
const AI_KEY = 'ftb.ai.v1';

function loadBoard(): { home: Team; away: Team } {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s.home?.players && s.away?.players) return s;
    }
  } catch { /* ignore */ }
  return { home: buildTeam('Home', '4-3-3', 0), away: buildTeam('Away', '4-4-2', 1) };
}

export function App() {
  const initial = useMemo(loadBoard, []);
  const [home, setHome] = useState<Team>(initial.home);
  const [away, setAway] = useState<Team>(initial.away);
  const [editing, setEditing] = useState<0 | 1>(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [addMode, setAddMode] = useState(false);
  const [addRole, setAddRole] = useState<Role>('CM');
  const [snap, setSnap] = useState(true);
  const [showRuns, setShowRuns] = useState(true);

  // simulation
  const matchRef = useRef<Match | null>(null);
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(15);
  const [heat, setHeat] = useState<HeatMode>('off');
  const [batchN, setBatchN] = useState(25);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchDone, setBatchDone] = useState(0);
  const [agg, setAgg] = useState<Aggregate | null>(null);
  const [aggStale, setAggStale] = useState(false);

  // feedback
  const [idea, setIdea] = useState<IdeaResult | null>(null);
  const [ideaMiss, setIdeaMiss] = useState(false);
  const [claudeText, setClaudeText] = useState('');
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeError, setClaudeError] = useState('');
  const [apiKey, setApiKey] = useState(() => { try { return JSON.parse(localStorage.getItem(AI_KEY) ?? '{}').key ?? ''; } catch { return ''; } });
  const [model, setModel] = useState(() => { try { return JSON.parse(localStorage.getItem(AI_KEY) ?? '{}').model ?? 'claude-sonnet-5-5'; } catch { return 'claude-sonnet-5-5'; } });
  const [dynamicFindings, setDynamicFindings] = useState(0);

  const locked = matchRef.current !== null;
  const teams: [Team, Team] = [home, away];
  const setTeam = useCallback((idx: 0 | 1, fn: (t: Team) => Team) => {
    (idx === 0 ? setHome : setAway)(fn);
    setAggStale(true);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ home, away })); } catch { /* ignore */ }
  }, [home, away]);
  useEffect(() => {
    try { localStorage.setItem(AI_KEY, JSON.stringify({ key: apiKey, model })); } catch { /* ignore */ }
  }, [apiKey, model]);

  // ---- selection helpers
  const find = (id: string | null): { team: 0 | 1; player: PlayerSpec; index: number } | null => {
    if (!id) return null;
    for (const t of [0, 1] as const) {
      const index = teams[t].players.findIndex((p) => p.id === id);
      if (index >= 0) return { team: t, player: teams[t].players[index], index };
    }
    return null;
  };
  const sel = find(selectedId);

  const patchPlayer = (teamIdx: 0 | 1, id: string, fn: (p: PlayerSpec) => PlayerSpec) =>
    setTeam(teamIdx, (t) => ({ ...t, players: t.players.map((p) => (p.id === id ? fn(p) : p)) }));

  // ---- simulation control
  const startMatch = () => {
    matchRef.current = new Match(structuredClone(home), structuredClone(away), Math.floor(Math.random() * 1e9), 0.1);
    setPlaying(true);
    setTick((t) => t + 1);
  };
  const stopMatch = () => {
    matchRef.current = null;
    setPlaying(false);
    setHeat('off');
    setTick((t) => t + 1);
  };

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastUi = 0;
    const loop = (now: number) => {
      const m = matchRef.current;
      if (!m) return;
      acc += Math.min(0.1, (now - last) / 1000) * speed;
      last = now;
      let guard = 0;
      while (acc >= m.dt && !m.finished && guard++ < 1500) {
        m.step(m.dt);
        acc -= m.dt;
      }
      if (m.finished) setPlaying(false);
      if (now - lastUi > 200 || m.finished) {
        lastUi = now;
        setTick((t) => t + 1);
      }
      if (!m.finished) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const finishMatch = () => {
    const m = matchRef.current;
    if (!m) return;
    m.runToEnd();
    setPlaying(false);
    setTick((t) => t + 1);
  };

  const runBatchNow = async () => {
    setBatchBusy(true);
    setBatchDone(0);
    try {
      const res = await runBatch(home, away, batchN, Math.floor(Math.random() * 1e6), (d) => setBatchDone(d));
      setAgg(res);
      setAggStale(false);
    } finally {
      setBatchBusy(false);
    }
  };

  // ---- board editing
  const addPlayer = (nx: number, ny: number) => {
    const team = teams[editing];
    if (team.players.length >= 11) { alert('A team can have at most 11 players.'); setAddMode(false); return; }
    const p = makePlayer(editing === 0 ? 'h' : 'a', addRole, nx, ny);
    setTeam(editing, (t) => ({ ...t, players: [...t.players, p] }));
    setSelectedId(p.id);
  };
  const removePlayer = (id: string) => {
    const f = find(id);
    if (!f) return;
    setTeam(f.team, (t) => ({ ...t, players: t.players.filter((p) => p.id !== id) }));
    // drop dangling marking references on the other team
    setTeam((1 - f.team) as 0 | 1, (t) => ({
      ...t,
      players: t.players.map((p) => (p.inst.mark === id ? { ...p, inst: { ...p.inst, mark: null } } : p)),
    }));
    setSelectedId(null);
  };

  // ---- feedback
  const side = editing;
  const sideTeam = teams[side];
  const oppTeam = teams[1 - side];
  const staticF = useMemo(() => staticFindings(sideTeam, oppTeam), [sideTeam, oppTeam]);
  const simF: Finding[] = useMemo(() => (agg && !aggStale ? simFindings(agg, side, sideTeam) : []), [agg, aggStale, side, sideTeam]);
  void dynamicFindings;

  const analyze = (text: string) => {
    setClaudeError('');
    if (text.trim()) {
      const r = interpretIdea(text);
      setIdea(r);
      setIdeaMiss(!r);
    } else { setIdea(null); setIdeaMiss(false); }
    setDynamicFindings((n) => n + 1);
    if (!agg || aggStale) void runBatchNow();
  };
  const ask = async (text: string) => {
    setClaudeBusy(true);
    setClaudeError('');
    try {
      const res = await askClaude({ apiKey, model, idea: text, team: sideTeam, opp: oppTeam, agg: aggStale ? null : agg, side });
      setClaudeText(res);
    } catch (e) {
      setClaudeError(e instanceof Error ? e.message : String(e));
    } finally {
      setClaudeBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>⚽ Tactics Board</h1>
        <div className="seg" role="group" aria-label="Team being edited">
          <button className={editing === 0 ? 'on home' : 'home'} onClick={() => { setEditing(0); setSelectedId(null); }}>Edit Home</button>
          <button className={editing === 1 ? 'on away' : 'away'} onClick={() => { setEditing(1); setSelectedId(null); }}>Edit Away</button>
        </div>
        <div className="tools">
          <select value={addRole} onChange={(e) => setAddRole(e.target.value as Role)} disabled={locked} title="Role of the next player you add">
            {(['GK', 'CB', 'FB', 'WB', 'DM', 'CM', 'AM', 'W', 'ST'] as Role[]).map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className={addMode ? 'on' : ''} onClick={() => setAddMode(!addMode)} disabled={locked}>{addMode ? 'Click pitch to place…' : '＋ Add player'}</button>
          <label><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> snap</label>
          <label><input type="checkbox" checked={showRuns} onChange={(e) => setShowRuns(e.target.checked)} /> run arrows</label>
        </div>
      </header>

      <main className="layout">
        <aside className="col">
          <TeamPanel
            key={editing}
            team={sideTeam}
            teamIdx={editing}
            disabled={locked}
            onFormation={(f) => { setTeam(editing, (t) => ({ ...buildTeam(t.name, f, editing), tactics: t.tactics })); setSelectedId(null); }}
            onTactics={(patch) => setTeam(editing, (t) => ({ ...t, tactics: { ...t.tactics, ...patch } }))}
            onRename={(name) => setTeam(editing, (t) => ({ ...t, name }))}
            onMirror={() => setTeam(editing, (t) => ({ ...t, players: t.players.map((p) => ({ ...p, y: 1 - p.y })) }))}
            onReplace={(t) => { setTeam(editing, () => t); setSelectedId(null); }}
          />
          <PlayerPanel
            player={sel?.player ?? null}
            number={(sel?.index ?? 0) + 1}
            opp={sel ? teams[1 - sel.team] : oppTeam}
            disabled={locked}
            onChange={(patch) => sel && patchPlayer(sel.team, sel.player.id, (p) => ({ ...p, ...patch }))}
            onInst={(patch: Partial<Instructions>) => sel && patchPlayer(sel.team, sel.player.id, (p) => ({ ...p, inst: { ...p.inst, ...patch } }))}
            onApplyRole={() => sel && setTeam(sel.team, (t) => ({
              ...t,
              players: t.players.map((p) => (p.role === sel.player.role ? { ...p, inst: { ...sel.player.inst, mark: null } } : p)),
            }))}
            onRemove={() => sel && removePlayer(sel.player.id)}
          />
        </aside>

        <section className="center">
          <Pitch
            home={home}
            away={away}
            editing={editing}
            selectedId={selectedId}
            highlightIds={highlight}
            match={matchRef.current}
            heat={heat}
            locked={locked}
            addMode={addMode}
            snap={snap}
            showRuns={showRuns}
            onSelect={(id) => { setSelectedId(id); setHighlight([]); }}
            onMove={(t, id, nx, ny) => patchPlayer(t, id, (p) => ({ ...p, x: nx, y: ny }))}
            onAdd={(nx, ny) => { addPlayer(nx, ny); setAddMode(false); }}
          />
          <p className="hint">
            Home 🔵 attacks right, Away 🔴 attacks left. Drag the {editing === 0 ? 'blue' : 'red'} players to build any formation; click anyone to edit their instructions.
            {locked && ' Editing is locked during a live match — press "Back to edit".'}
          </p>
        </section>

        <aside className="col">
          <SimPanel
            match={matchRef.current}
            tick={tick}
            playing={playing}
            speed={speed}
            heat={heat}
            batchN={batchN}
            batchBusy={batchBusy}
            batchDone={batchDone}
            agg={agg}
            onStart={startMatch}
            onPlayPause={() => setPlaying((p) => !p)}
            onStop={stopMatch}
            onSpeed={setSpeed}
            onHeat={setHeat}
            onBatchN={setBatchN}
            onBatch={runBatchNow}
            onFinish={finishMatch}
          />
          <FeedbackPanel
            sideName={sideTeam.name}
            findings={staticF}
            simFindings={simF}
            idea={idea}
            ideaMiss={ideaMiss}
            claudeText={claudeText}
            claudeBusy={claudeBusy}
            claudeError={claudeError}
            hasKey={apiKey.trim().length > 0}
            apiKey={apiKey}
            model={model}
            onApiKey={setApiKey}
            onModel={setModel}
            onAnalyze={analyze}
            onApplyIdea={() => idea?.apply && setTeam(editing, (t) => idea.apply!(t))}
            onAsk={ask}
            onHighlight={setHighlight}
          />
          {aggStale && agg && <p className="muted">Batch results are out of date: you changed the board since they ran.</p>}
        </aside>
      </main>
    </div>
  );
}

