import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pitch, HeatMode } from './components/Pitch';
import { TeamPanel } from './components/TeamPanel';
import { PlayerPanel } from './components/PlayerPanel';
import { SimPanel } from './components/SimPanel';
import { FeedbackPanel } from './components/FeedbackPanel';
import { buildTeam } from './engine/formations';
import { Instructions, PlayerSpec, Role, Team, makePlayer } from './engine/types';
import { Match } from './engine/sim';
import { toWorld } from './engine/geometry';
import { Aggregate, runBatch } from './engine/batch';
import { Finding, simFindings, staticFindings } from './engine/analysis';
import { IdeaResult, interpretIdea } from './engine/ideas';
import { askCoach, askDecisions, askExplain, askFeedback, askScenario, probeServer, BrowserKey, Scenario, ServerInfo, ShapeSnapshot } from './engine/ai';
import { DecisionPanel, DecisionLogEntry, DecisionOpts } from './components/DecisionPanel';
import { ORDERS } from './engine/sim';
import { ShapeLabPanel, LabUI } from './components/ShapeLabPanel';
import { PLAYBOOKS } from './engine/playbooks';
import { snapshotTeam } from './engine/shape';
import { CoachPanel, CoachLogEntry } from './components/CoachPanel';

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
  const savedAI = (): { key?: string; textModel?: string; decisionModel?: string; model?: string } => { try { return JSON.parse(localStorage.getItem(AI_KEY) ?? '{}'); } catch { return {}; } };
  const [apiKey, setApiKey] = useState(() => savedAI().key ?? '');
  const [textModel, setTextModel] = useState(() => savedAI().textModel ?? savedAI().model ?? 'anthropic/claude-sonnet-4.5');
  const [decisionModel, setDecisionModel] = useState(() => savedAI().decisionModel ?? 'anthropic/claude-haiku-4.5');
  const [dynamicFindings, setDynamicFindings] = useState(0);
  const [serverInfo, setServerInfo] = useState<ServerInfo>({ configured: false });
  const serverAI = serverInfo.configured;
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachLog, setCoachLog] = useState<CoachLogEntry[]>([]);
  useEffect(() => { void probeServer().then(setServerInfo); }, []);

  // AI decision model (players' in-match decisions)
  const [decOpts, setDecOpts] = useState<DecisionOpts>({ home: false, away: false, every: 20, wait: true, cap: 80 });
  const [decLog, setDecLog] = useState<DecisionLogEntry[]>([]);
  const [decCalls, setDecCalls] = useState(0);
  const [decThinking, setDecThinking] = useState(false);
  const dec = useRef({ opts: decOpts, key: undefined as BrowserKey | undefined, inflight: false, calls: 0, errors: 0, lastT: [-1e9, -1e9] as [number, number], lastPoss: [-1, -1] as [number, number], lastScore: 0 });
  dec.current.opts = decOpts;

  const runDecision = async (m: Match, side: 0 | 1) => {
    const D = dec.current;
    D.inflight = true;
    setDecThinking(true);
    D.lastT[side] = m.t;
    try {
      const res = await askDecisions({ match: m, side, browserKey: D.key });
      if (matchRef.current !== m) return;
      D.calls++; D.errors = 0;
      const lines: string[] = [];
      for (const o of res.orders) {
        if (!m.giveOrder(o.playerId, o.order, o.seconds, o.why, o.markId)) continue;
        const idx = m.teams[side].players.findIndex((p) => p.id === o.playerId);
        const text = `#${idx + 1} ${m.teams[side].players[idx].role} → ${ORDERS[o.order].label}${o.why ? ` (${o.why})` : ''}`;
        lines.push(text);
        m.log(side, `AI: ${text}`, 'ai');
      }
      setDecLog((l) => [...l, { clock: m.clock, team: side, say: res.say || (lines.length ? '' : 'No changes needed.'), orders: lines }].slice(-30));
      setDecCalls(D.calls);
    } catch (e) {
      D.errors++;
      setDecLog((l) => [...l, { clock: m.clock, team: side, say: `⚠️ ${e instanceof Error ? e.message : String(e)}`, orders: [], error: true }].slice(-30));
      if (D.errors >= 3) { setDecOpts((o) => ({ ...o, home: false, away: false })); }
    } finally {
      D.inflight = false;
      setDecThinking(false);
    }
  };
  // called every frame from the match loop: decides whether the model should be consulted now
  const maybeDecide = (m: Match) => {
    const D = dec.current;
    if (D.inflight || m.finished || D.calls >= D.opts.cap) return;
    const owner = m.ball.owner;
    const poss = owner ? owner.team : m.ball.lastTeam;
    const goals = m.score[0] + m.score[1];
    for (const side of [0, 1] as const) {
      if (!(side === 0 ? D.opts.home : D.opts.away)) continue;
      const since = m.t - D.lastT[side];
      const turnover = poss !== D.lastPoss[side] && since >= 6;
      const goal = goals !== D.lastScore && since >= 3;
      if (since >= D.opts.every || turnover || goal) {
        D.lastPoss[side] = poss;
        D.lastScore = goals;
        void runDecision(m, side);
        return;
      }
    }
  };

  // shape lab
  const [lab, setLab] = useState(false);
  const [labUI, setLabUI] = useState<LabUI>({
    playing: false, speed: 1, poss: 0, title: '', step: 0, steps: 0, caption: '', shape: true, labels: 'selected',
    explaining: false, generating: false, explanation: '', error: '', snapshots: 0,
  });
  const labRef = useRef({
    scenario: null as Scenario | null, step: 0, t: 0, hold: 0, phase: 'idle' as 'idle' | 'move' | 'hold',
    bx: 52.5, by: 34, fx: 52.5, fy: 34, tx: 52.5, ty: 34, poss: 0 as 0 | 1, playing: false, speed: 1,
    trail: [] as [number, number][], snaps: [] as ShapeSnapshot[],
  });
  const patchLab = (p: Partial<LabUI>) => setLabUI((u) => ({ ...u, ...p }));
  const aiReady = serverAI || apiKey.trim().length > 0;
  const browserKey: BrowserKey | undefined = serverAI || !apiKey.trim() ? undefined : { apiKey: apiKey.trim(), textModel, decisionModel };
  dec.current.key = browserKey;
  const activeDecisionModel = serverAI ? serverInfo.decisionModel ?? '' : decisionModel;

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
    try { localStorage.setItem(AI_KEY, JSON.stringify({ key: apiKey, textModel, decisionModel })); } catch { /* ignore */ }
  }, [apiKey, textModel, decisionModel]);

  // Live coaching: any change to instructions or tactics reaches the running match immediately
  useEffect(() => {
    const m = matchRef.current;
    if (!m) return;
    ([home, away] as Team[]).forEach((team, ti) => {
      Object.assign(m.teams[ti].tactics, team.tactics);
      for (const spec of team.players) {
        const sp = m.findPlayer(spec.id);
        if (sp) Object.assign(sp.spec.inst, spec.inst);
      }
    });
  }, [home, away]);

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

  const coachNote = (teamIdx: 0 | 1, text: string) => matchRef.current?.log(teamIdx, `Coach: ${text}`);
  const quickCoach = (fn: (i: Instructions) => Partial<Instructions>, label: string) => {
    if (!sel) return;
    patchPlayer(sel.team, sel.player.id, (p) => ({ ...p, inst: { ...p.inst, ...fn(p.inst) } }));
    coachNote(sel.team, `#${sel.index + 1} ${sel.player.role} → ${label}`);
    setTick((t) => t + 1);
  };
  const markNearest = () => {
    if (!sel) return;
    const m = matchRef.current;
    const opp = teams[1 - sel.team];
    const live = m?.findPlayer(sel.player.id);
    const [mx, my] = live ? [live.x, live.y] : toWorld(sel.team, sel.player.x, sel.player.y);
    let best: PlayerSpec | null = null;
    let bd = 1e9;
    for (const o of opp.players) {
      if (o.role === 'GK') continue;
      const lo = m?.findPlayer(o.id);
      const [ox, oy] = lo ? [lo.x, lo.y] : toWorld((1 - sel.team) as 0 | 1, o.x, o.y);
      const d = Math.hypot(ox - mx, oy - my);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return;
    const b = best;
    patchPlayer(sel.team, sel.player.id, (p) => ({ ...p, inst: { ...p.inst, mark: b.id } }));
    coachNote(sel.team, `#${sel.index + 1} ${sel.player.role} now marks opp #${opp.players.indexOf(b) + 1} ${b.role}`);
    setTick((t) => t + 1);
  };
  const sendCoach = async (command: string) => {
    setCoachBusy(true);
    setCoachLog((l) => [...l, { from: 'you', text: command }]);
    try {
      const res = await askCoach({
        command, team: sideTeam, opp: oppTeam, side, match: matchRef.current,
        selectedNumber: sel && sel.team === side ? sel.index + 1 : undefined, browserKey,
      });
      for (const c of res.changes) {
        patchPlayer(side, c.playerId, (p) => ({ ...p, inst: { ...p.inst, ...c.patch } }));
        coachNote(side, c.label);
      }
      if (Object.keys(res.team).length) {
        setTeam(side, (t) => ({ ...t, tactics: { ...t.tactics, ...res.team } }));
        coachNote(side, `team: ${Object.entries(res.team).map(([k, v]) => `${k} ${Math.round((v as number) * 100)}%`).join(', ')}`);
      }
      setCoachLog((l) => [...l, { from: 'coach', text: res.say, changes: [...res.changes.map((c) => c.label), ...(Object.keys(res.team).length ? ['team tactics adjusted'] : [])] }]);
      setTick((t) => t + 1);
    } catch (e) {
      setCoachLog((l) => [...l, { from: 'coach', text: `⚠️ ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setCoachBusy(false);
    }
  };

  // ---- shape lab
  const startLab = () => {
    const m = new Match(structuredClone(home), structuredClone(away), 1, 0.1);
    m.resetShape();
    m.scriptBall(52.5, 34, 0);
    matchRef.current = m;
    Object.assign(labRef.current, { scenario: null, step: 0, phase: 'idle', playing: false, bx: 52.5, by: 34, tx: 52.5, ty: 34, trail: [], snaps: [], poss: 0 });
    setLabUI((u) => ({ ...u, playing: false, steps: 0, step: 0, caption: '', title: '', poss: 0, explanation: '', error: '', snapshots: 0 }));
    setLab(true);
    setHeat('off');
    setTick((t) => t + 1);
  };
  const exitLab = () => {
    matchRef.current = null;
    labRef.current.playing = false;
    setLab(false);
    setTick((t) => t + 1);
  };
  const beginStep = (i: number) => {
    const L = labRef.current;
    const st = L.scenario!.steps[i];
    L.step = i; L.t = 0; L.phase = 'move';
    L.fx = L.bx; L.fy = L.by; L.tx = st.x; L.ty = st.y; L.poss = st.poss;
    patchLab({ step: i, caption: st.caption, poss: st.poss });
  };
  const loadScenario = (sc: Scenario, autoplay = true) => {
    const L = labRef.current;
    const m = matchRef.current;
    if (!m) return;
    L.scenario = sc; L.snaps = []; L.trail = [];
    L.bx = L.fx = sc.steps[0].x; L.by = L.fy = sc.steps[0].y;
    m.resetShape();
    L.playing = autoplay; L.speed = labUI.speed;
    patchLab({ title: sc.title, steps: sc.steps.length, playing: autoplay, explanation: '', error: '', snapshots: 0 });
    beginStep(0);
  };
  const generateScenario = async (prompt: string) => {
    patchLab({ generating: true, error: '' });
    try {
      loadScenario(await askScenario({ prompt, home, away, browserKey }));
    } catch (e) {
      patchLab({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      patchLab({ generating: false });
    }
  };
  const explainScenario = async () => {
    patchLab({ explaining: true, error: '' });
    try {
      patchLab({ explanation: await askExplain({ title: labRef.current.scenario?.title ?? 'sequence', snapshots: labRef.current.snaps, browserKey }) });
    } catch (e) {
      patchLab({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      patchLab({ explaining: false });
    }
  };

  // shape lab driver: glides the ball and advances the playbook
  useEffect(() => {
    if (!lab) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastUi = 0;
    const loop = (now: number) => {
      const m = matchRef.current;
      if (!m) return;
      const L = labRef.current;
      const dtReal = Math.min(0.1, (now - last) / 1000);
      last = now;
      const dtSim = dtReal * L.speed;
      const sc = L.scenario;
      if (L.playing && sc) {
        const st = sc.steps[L.step];
        if (L.phase === 'move') {
          L.t += dtSim;
          const u = st.seconds <= 0 ? 1 : Math.min(1, L.t / st.seconds);
          const e = u * u * (3 - 2 * u);
          L.bx = L.fx + (L.tx - L.fx) * e;
          L.by = L.fy + (L.ty - L.fy) * e;
          if (u >= 1) { L.phase = 'hold'; L.hold = 0; }
        } else if (L.phase === 'hold') {
          L.hold += dtSim;
          if (L.hold >= 2) {
            L.snaps.push({
              caption: st.caption, ball: [Math.round(L.bx), Math.round(L.by)], possession: L.poss === 0 ? 'home' : 'away',
              home: snapshotTeam(m, 0), away: snapshotTeam(m, 1),
            });
            patchLab({ snapshots: L.snaps.length });
            if (L.step + 1 < sc.steps.length) beginStep(L.step + 1);
            else { L.playing = false; L.phase = 'idle'; patchLab({ playing: false }); }
          }
        }
      } else {
        // free mode: ball glides toward where you last clicked
        const dx = L.tx - L.bx, dy = L.ty - L.by, d = Math.hypot(dx, dy);
        const stepLen = Math.min(d, 24 * dtReal);
        if (d > 0.01) { L.bx += (dx / d) * stepLen; L.by += (dy / d) * stepLen; }
      }
      m.scriptBall(L.bx, L.by, L.poss);
      acc += dtSim;
      let guard = 0;
      while (acc >= 0.1 && guard++ < 80) { m.step(0.1); acc -= 0.1; }
      const tr = L.trail;
      if (!tr.length || Math.hypot(tr[tr.length - 1][0] - L.bx, tr[tr.length - 1][1] - L.by) > 1.2) { tr.push([L.bx, L.by]); if (tr.length > 70) tr.shift(); }
      if (now - lastUi > 100) { lastUi = now; setTick((t) => t + 1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [lab]);

  // ---- simulation control
  const startMatch = () => {
    matchRef.current = new Match(structuredClone(home), structuredClone(away), Math.floor(Math.random() * 1e9), 0.1);
    Object.assign(dec.current, { calls: 0, errors: 0, lastT: [-1e9, -1e9], lastPoss: [-1, -1], lastScore: 0, inflight: false });
    setDecCalls(0); setDecLog([]);
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
      const waiting = dec.current.inflight && dec.current.opts.wait;
      acc += waiting ? 0 : Math.min(0.1, (now - last) / 1000) * speed;
      last = now;
      let guard = 0;
      while (acc >= m.dt && !m.finished && guard++ < 1500) {
        m.step(m.dt);
        acc -= m.dt;
      }
      maybeDecide(m);
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
      setClaudeText(await askFeedback({ idea: text, team: sideTeam, opp: oppTeam, agg: aggStale ? null : agg, side, browserKey }));
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
          <button className={lab ? 'on' : ''} onClick={lab ? exitLab : startLab} disabled={locked && !lab} title="Animated diagram of how both formations move with the ball">
            {lab ? '✕ Exit Shape Lab' : '🎞 Shape Lab'}
          </button>
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
            onQuick={quickCoach}
            onMarkNearest={markNearest}
            live={locked}
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
            labMode={lab}
            shape={lab && labUI.shape}
            labels={lab ? labUI.labels : 'off'}
            trail={lab ? labRef.current.trail : undefined}
            onBallSet={(x, y) => {
              const L = labRef.current;
              L.playing = false; L.phase = 'idle'; L.tx = x; L.ty = y;
              patchLab({ playing: false });
            }}
          />
          <p className="hint">
            Home 🔵 attacks right, Away 🔴 attacks left. Drag the {editing === 0 ? 'blue' : 'red'} players to build any formation; click anyone to edit their instructions.
            {locked && ' Editing is locked during a live match — press "Back to edit".'}
          </p>
        </section>

        <aside className="col">
          {lab && matchRef.current ? (
            <ShapeLabPanel
              match={matchRef.current}
              tick={tick}
              ui={labUI}
              aiReady={aiReady}
              selected={(() => {
                const sp = selectedId ? matchRef.current.findPlayer(selectedId) : null;
                const f = find(selectedId);
                return sp && f ? { label: `#${f.index + 1} ${f.player.role} (${f.team === 0 ? 'home' : 'away'})`, intent: sp.intent } : null;
              })()}
              onPlaybook={(i) => loadScenario(PLAYBOOKS[i])}
              onPlay={() => {
                const L = labRef.current;
                if (!L.scenario) return;
                if (L.phase === 'idle') beginStep(L.step >= L.scenario.steps.length - 1 ? 0 : L.step);
                L.playing = !L.playing;
                patchLab({ playing: L.playing });
              }}
              onRestart={() => { const L = labRef.current; if (L.scenario) { loadScenario(L.scenario); } }}
              onSpeed={(v) => { labRef.current.speed = v; patchLab({ speed: v }); }}
              onPoss={(p) => { labRef.current.poss = p; patchLab({ poss: p }); }}
              onShape={(v) => patchLab({ shape: v })}
              onLabels={(v) => patchLab({ labels: v })}
              onGenerate={generateScenario}
              onExplain={explainScenario}
              onExit={exitLab}
            />
          ) : (
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
          )}
          {!lab && matchRef.current && (
            <DecisionPanel
              opts={decOpts}
              onOpts={(o) => setDecOpts((d) => ({ ...d, ...o }))}
              aiReady={aiReady}
              model={activeDecisionModel}
              calls={decCalls}
              thinking={decThinking}
              log={decLog}
            />
          )}
          <CoachPanel
            aiReady={aiReady}
            busy={coachBusy}
            live={locked}
            log={coachLog}
            selectedLabel={sel && sel.team === side ? `#${sel.index + 1} ${sel.player.role}` : null}
            onSend={sendCoach}
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
            aiReady={aiReady}
            serverAI={serverAI}
            apiKey={apiKey}
            textModel={serverAI ? serverInfo.textModel ?? '' : textModel}
            decisionModel={serverAI ? serverInfo.decisionModel ?? '' : decisionModel}
            onApiKey={setApiKey}
            onTextModel={setTextModel}
            onDecisionModel={setDecisionModel}
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

