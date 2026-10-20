import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pitch, HeatMode } from './components/Pitch';
import { Tabs } from './components/ui';
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
import { askCoach, askDecisions, askRole, askExplain, askFeedback, askScenario, probeServer, BrowserKey, Scenario, ServerInfo, ShapeSnapshot } from './engine/ai';
import { BatchPanel } from './components/SimPanel';
import { AISettings } from './components/AISettings';
import type { BriefReport } from './components/PlayerPanel';
import { ROLE_TEMPLATES, applyBriefToPlayer, describeChanges, interpretBrief } from './engine/roles';
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

  const [aiOpen, setAiOpen] = useState(false);
  const [leftTab, setLeftTab] = useState<'team' | 'player'>('team');
  const [rightTab, setRightTab] = useState<'match' | 'coach' | 'insights'>('match');
  const locked = matchRef.current !== null;
  const mode: 'board' | 'match' | 'lab' = lab ? 'lab' : locked ? 'match' : 'board';
  const goMode = (m: 'board' | 'match' | 'lab') => {
    if (m === mode) return;
    if (lab) exitLab();
    else if (matchRef.current) stopMatch();
    if (m === 'match') startMatch();
    if (m === 'lab') startLab();
    if (m !== 'board') setRightTab('match');
  };
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
  // ---- per-player role & free-text instructions
  const [briefReport, setBriefReport] = useState<{ id: string; report: BriefReport } | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const commitRole = (r: { role?: Role; roleName?: string; inst: Partial<Instructions> }, brief: string, source: BriefReport['source'], notes: string[]) => {
    if (!sel) return;
    const before = sel.player;
    const opp = teams[1 - sel.team];
    const next = applyBriefToPlayer(before, r, brief, !locked, source === 'template');
    patchPlayer(sel.team, before.id, () => next);
    const label = (id: string) => { const k = opp.players.findIndex((q) => q.id === id); return k >= 0 ? `man-marks their #${k + 1} ${opp.players[k].role}` : 'man-marking'; };
    const changes = describeChanges(before.inst, next.inst, label);
    if (!locked && r.role && r.role !== before.role) changes.unshift(`Position: ${before.role} → ${r.role}`);
    if (locked && r.role && r.role !== before.role) notes = [...notes, `(Base position stays ${before.role} during a match; the behaviours were applied.)`];
    setBriefReport({ id: before.id, report: { source, notes, changes } });
    coachNote(sel.team, `#${sel.index + 1} ${before.role} → ${r.roleName ?? 'new instructions'}`);
    setTick((t) => t + 1);
  };
  const applyBrief = async (text: string, useAI: boolean) => {
    const t = text.trim();
    if (!sel || !t) return;
    const id = sel.player.id;
    const opp = teams[1 - sel.team];
    if (!useAI) {
      const r = interpretBrief(t, sel.player, opp);
      if (r.unmatched) { patchPlayer(sel.team, id, (p) => ({ ...p, brief: t })); setBriefReport({ id, report: { source: 'offline', notes: [], changes: [], unmatched: true } }); return; }
      commitRole(r, t, 'offline', r.notes);
      return;
    }
    setBriefBusy(true);
    try {
      const r = await askRole({ text: t, player: sel.player, number: sel.index + 1, team: teams[sel.team], opp, browserKey });
      commitRole(r, t, 'ai', [r.summary || 'Applied the AI’s interpretation.']);
    } catch (e) {
      setBriefReport({ id, report: { source: 'ai', notes: [], changes: [], error: e instanceof Error ? e.message : String(e) } });
    } finally {
      setBriefBusy(false);
    }
  };
  const applyTemplate = (name: string) => {
    const tpl = ROLE_TEMPLATES.find((x) => x.name === name);
    if (!tpl || !sel) return;
    commitRole({ role: tpl.role, roleName: tpl.name, inst: tpl.inst }, sel.player.brief ?? '', 'template', [`${tpl.name}: ${tpl.blurb}`]);
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

  const m = matchRef.current;
  const rightTabs = [
    { id: 'match' as const, label: mode === 'lab' ? '🎞 Lab' : '▶ Match' },
    { id: 'coach' as const, label: '🎙 Coach' },
    { id: 'insights' as const, label: '💡 Insights', badge: staticF.filter((f) => f.severity === 'warn' || f.severity === 'risk').length || undefined },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <rect x="1" y="5" width="30" height="22" rx="4" fill="#16a34a" />
            <path d="M16 5v22M1 16h0M31 16h0" stroke="#fff" strokeWidth="1.5" opacity=".8" />
            <circle cx="16" cy="16" r="4.5" fill="none" stroke="#fff" strokeWidth="1.5" opacity=".8" />
            <circle cx="9" cy="12" r="2" fill="#3b82f6" /><circle cx="23" cy="20" r="2" fill="#ef4444" />
          </svg>
          <div><h1>Tactics Board</h1><span>design · simulate · coach</span></div>
        </div>
        <nav className="modes" aria-label="Mode">
          <button className={mode === 'board' ? 'on' : ''} onClick={() => goMode('board')}><b>✎</b> Board</button>
          <button className={mode === 'match' ? 'on' : ''} onClick={() => goMode('match')}><b>▶</b> Live match</button>
          <button className={mode === 'lab' ? 'on' : ''} onClick={() => goMode('lab')}><b>🎞</b> Shape lab</button>
        </nav>
        <button className={`aistatus ${serverAI ? 'ok' : apiKey.trim() ? 'dev' : 'bad'}`} onClick={() => setAiOpen(true)} title="AI settings and connection test">
          <i /> {serverAI ? 'AI ready' : apiKey.trim() ? 'AI: local key' : 'AI not set up'}
        </button>
        <div className="whose"><span>Your team</span>
        <div className="seg" role="group" aria-label="Team being edited">
          <button className={editing === 0 ? 'on home' : 'home'} onClick={() => { setEditing(0); setSelectedId(null); }}>● {home.name || 'Home'}</button>
          <button className={editing === 1 ? 'on away' : 'away'} onClick={() => { setEditing(1); setSelectedId(null); }}>● {away.name || 'Away'}</button>
        </div></div>
      </header>

      <main className="layout">
        <aside className="col left">
          <Tabs
            value={leftTab}
            onChange={setLeftTab}
            tabs={[
              { id: 'team', label: '👥 Team' },
              { id: 'player', label: '🎯 Player', badge: sel ? `#${sel.index + 1}` : undefined },
            ]}
          />
          {leftTab === 'team' ? (
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
          ) : (
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
              aiReady={aiReady}
              briefBusy={briefBusy}
              report={briefReport && sel && briefReport.id === sel.player.id ? briefReport.report : null}
              onApplyBrief={applyBrief}
              onTemplate={applyTemplate}
            />
          )}
        </aside>

        <section className="center">
          {m && !lab ? (
            <div className="hud" data-tick={tick}>
              <span className="side home">{m.teams[0].name}</span>
              <div className="score"><b>{m.score[0]}</b><i>–</i><b>{m.score[1]}</b></div>
              <span className="side away">{m.teams[1].name}</span>
              <div className="clockpill">{m.clock}{m.finished ? ' · FT' : ''}</div>
              <button className="icon" onClick={() => setPlaying((p) => !p)} disabled={m.finished} title={playing ? 'Pause' : 'Play'}>{playing ? '⏸' : '▶'}</button>
              {decThinking && <span className="thinking">🧠 thinking…</span>}
            </div>
          ) : (
            <div className="toolbar">
              {mode === 'board' ? (
                <>
                  <select value={addRole} onChange={(e) => setAddRole(e.target.value as Role)} title="Role of the next player you add">
                    {(['GK', 'CB', 'FB', 'WB', 'DM', 'CM', 'AM', 'W', 'ST'] as Role[]).map((r) => <option key={r}>{r}</option>)}
                  </select>
                  <button className={addMode ? 'on' : ''} onClick={() => setAddMode(!addMode)}>{addMode ? 'Click the pitch to place…' : '＋ Add player'}</button>
                  <label className="toggle"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to grid</label>
                  <label className="toggle"><input type="checkbox" checked={showRuns} onChange={(e) => setShowRuns(e.target.checked)} /> Run arrows</label>
                </>
              ) : (
                <span className="muted">Click or drag the pitch to move the ball · labels show each player's current decision</span>
              )}
            </div>
          )}
          <div className="pitch-frame">
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
              onSelect={(id) => { setSelectedId(id); setHighlight([]); if (id) setLeftTab('player'); }}
              onMove={(t, id, nx, ny) => patchPlayer(t, id, (p) => ({ ...p, x: nx, y: ny }))}
              onAdd={(nx, ny) => { addPlayer(nx, ny); setAddMode(false); setLeftTab('player'); }}
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
          </div>
          <div className="legend">
            <span><i className="dot home" /> {home.name} attacks →</span>
            <span><i className="dot away" /> ← {away.name} attacks</span>
            {mode === 'board' && <span className="muted">Drag the {editing === 0 ? 'blue' : 'red'} players · click anyone to edit</span>}
            {mode === 'match' && <span className="muted">Select any player to coach them live</span>}
          </div>
          {m && !lab ? (
            <div className="strip" data-tick={tick}>
              <h4>Match feed</h4>
              <ul>
                {m.events.length === 0 && <li className="shot">Kick-off…</li>}
                {m.events.slice(-7).reverse().map((e, i) => (
                  <li key={i} className={e.kind}>
                    <span>{e.team === 0 ? '🔵' : '🔴'} {e.text}</span>
                    <small>{Math.floor(e.t / 60)}′</small>
                  </li>
                ))}
              </ul>
            </div>
          ) : mode === 'board' ? (
            <div className="strip">
              <h4>{sideTeam.name}: top issues</h4>
              <ul>
                {staticF.filter((f) => f.severity === 'risk' || f.severity === 'warn').slice(0, 3).map((f, i) => (
                  <li key={i} className={`finding ${f.severity}`} onClick={() => setHighlight(f.playerIds ?? [])}>
                    <span>{f.severity === 'risk' ? '🛑' : '⚠️'} {f.title}</span>
                    {f.playerIds?.length ? <small>click to highlight</small> : null}
                  </li>
                ))}
                {!staticF.some((f) => f.severity === 'risk' || f.severity === 'warn') && <li className="finding good"><span>✅ No structural problems detected</span></li>}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="col right">
          <Tabs value={rightTab} onChange={setRightTab} tabs={rightTabs} />
          {rightTab === 'match' && (
            <>
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
                  onExit={() => goMode('board')}
                />
              ) : (
                <SimPanel
                  match={matchRef.current}
                  tick={tick}
                  playing={playing}
                  speed={speed}
                  heat={heat}
                  onStart={() => goMode('match')}
                  onPlayPause={() => setPlaying((p) => !p)}
                  onStop={() => goMode('board')}
                  onSpeed={setSpeed}
                  onHeat={setHeat}
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
            </>
          )}
          {rightTab === 'coach' && (
            <CoachPanel
              aiReady={aiReady}
              busy={coachBusy}
              live={locked}
              log={coachLog}
              selectedLabel={sel && sel.team === side ? `#${sel.index + 1} ${sel.player.role}` : null}
              onSend={sendCoach}
            />
          )}
          {rightTab === 'insights' && (
            <>
              <BatchPanel batchN={batchN} batchBusy={batchBusy} batchDone={batchDone} agg={agg} stale={aggStale} onBatchN={setBatchN} onBatch={runBatchNow} />
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
                onOpenSettings={() => setAiOpen(true)}
                onAnalyze={analyze}
                onApplyIdea={() => idea?.apply && setTeam(editing, (t) => idea.apply!(t))}
                onAsk={ask}
                onHighlight={setHighlight}
              />
            </>
          )}
        </aside>
      </main>
      <AISettings
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        serverInfo={serverInfo}
        apiKey={apiKey}
        textModel={textModel}
        decisionModel={decisionModel}
        onApiKey={setApiKey}
        onTextModel={setTextModel}
        onDecisionModel={setDecisionModel}
      />
    </div>
  );
}
