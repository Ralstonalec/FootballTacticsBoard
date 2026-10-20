import { useEffect, useRef } from 'react';
import type { Team } from '../engine/types';
import type { Match } from '../engine/sim';
import { GX, GY } from '../engine/sim';
import { PH, PW, fromWorld, toWorld } from '../engine/geometry';
import { convexHull, lineClusters } from '../engine/shape';

export type HeatMode = 'off' | 'home' | 'away';

export interface PitchProps {
  home: Team;
  away: Team;
  editing: 0 | 1;
  selectedId: string | null;
  highlightIds: string[];
  match: Match | null;
  heat: HeatMode;
  locked: boolean;
  addMode: boolean;
  snap: boolean;
  showRuns: boolean;
  onSelect: (id: string | null) => void;
  onMove: (team: 0 | 1, id: string, nx: number, ny: number) => void;
  onAdd: (nx: number, ny: number) => void;
  // shape lab
  labMode?: boolean;
  shape?: boolean;
  labels?: 'off' | 'selected' | 'all';
  trail?: [number, number][];
  onBallSet?: (x: number, y: number) => void;
}

const MARGIN = 18;
const COLORS = ['#3b82f6', '#ef4444'];

export function Pitch(props: PitchProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const drag = useRef<{ id: string; team: 0 | 1 } | null>(null);
  const ballDrag = useRef(false);
  const size = useRef({ w: 800, h: 520, dpr: 1 });

  useEffect(() => {
    const el = wrap.current!;
    const resize = () => {
      const w = Math.max(320, el.clientWidth);
      const h = Math.round((w - 2 * MARGIN) * (PH / PW) + 2 * MARGIN);
      const dpr = window.devicePixelRatio || 1;
      size.current = { w, h, dpr };
      const c = canvas.current!;
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let raf = 0;
    const loop = (t: number) => {
      draw(canvas.current!, propsRef.current, size.current, t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const toNorm = (e: React.PointerEvent): { wx: number; wy: number } => {
    const r = canvas.current!.getBoundingClientRect();
    const S = (size.current.w - 2 * MARGIN) / PW;
    return { wx: (e.clientX - r.left - MARGIN) / S, wy: (e.clientY - r.top - MARGIN) / S };
  };

  const hit = (wx: number, wy: number): { id: string; team: 0 | 1 } | null => {
    const p = propsRef.current;
    const S = (size.current.w - 2 * MARGIN) / PW;
    const rad = Math.max(12, S * 1.4) / S;
    let best: { id: string; team: 0 | 1 } | null = null;
    let bd = rad;
    for (const team of [p.editing, (1 - p.editing) as 0 | 1]) {
      for (const pl of (team === 0 ? p.home : p.away).players) {
        const [x, y] = p.match ? simPos(p.match, pl.id) ?? toWorld(team, pl.x, pl.y) : toWorld(team, pl.x, pl.y);
        const d = Math.hypot(x - wx, y - wy);
        if (d < bd) { bd = d; best = { id: pl.id, team }; }
      }
    }
    return best;
  };

  const onDown = (e: React.PointerEvent) => {
    const { wx, wy } = toNorm(e);
    const p = propsRef.current;
    const h = hit(wx, wy);
    if (h) {
      p.onSelect(h.id);
      if (!p.locked && h.team === p.editing) {
        drag.current = h;
        canvas.current!.setPointerCapture(e.pointerId);
      }
    } else if (p.labMode && p.onBallSet) {
      ballDrag.current = true;
      canvas.current!.setPointerCapture(e.pointerId);
      p.onBallSet(Math.min(PW, Math.max(0, wx)), Math.min(PH, Math.max(0, wy)));
    } else if (p.addMode && !p.locked) {
      const [nx, ny] = fromWorld(p.editing, wx, wy);
      if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) p.onAdd(nx, ny);
    } else p.onSelect(null);
  };

  const onMove = (e: React.PointerEvent) => {
    if (ballDrag.current) {
      const { wx, wy } = toNorm(e);
      propsRef.current.onBallSet?.(Math.min(PW, Math.max(0, wx)), Math.min(PH, Math.max(0, wy)));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const p = propsRef.current;
    const { wx, wy } = toNorm(e);
    let [nx, ny] = fromWorld(d.team, Math.min(PW, Math.max(0, wx)), Math.min(PH, Math.max(0, wy)));
    if (p.snap) {
      nx = Math.round(nx / 0.025) * 0.025;
      ny = Math.round(ny / 0.025) * 0.025;
    }
    p.onMove(d.team, d.id, Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny)));
  };

  return (
    <div ref={wrap} className="pitch-wrap">
      <canvas
        ref={canvas}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => { drag.current = null; ballDrag.current = false; }}
        onPointerCancel={() => { drag.current = null; ballDrag.current = false; }}
        style={{ touchAction: 'none', cursor: props.addMode ? 'copy' : props.labMode ? 'crosshair' : 'default' }}
      />
    </div>
  );
}

function simPos(m: Match, id: string): [number, number] | null {
  const p = m.findPlayer(id);
  return p ? [p.x, p.y] : null;
}

function draw(c: HTMLCanvasElement, p: PitchProps, size: { w: number; h: number; dpr: number }, time: number) {
  const ctx = c.getContext('2d')!;
  const { w, h, dpr } = size;
  const S = (w - 2 * MARGIN) / PW;
  const X = (wx: number) => MARGIN + wx * S;
  const Y = (wy: number) => MARGIN + wy * S;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // grass
  ctx.fillStyle = '#15803d';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
    ctx.fillRect(X((i * PW) / 12), Y(0), (PW / 12) * S, PH * S);
  }

  // heat map
  if (p.match && p.heat !== 'off') {
    const grid = p.match.stats[p.heat === 'home' ? 0 : 1].touchGrid;
    const mx = Math.max(1, ...grid);
    const cw = (PW / GX) * S;
    const ch = (PH / GY) * S;
    for (let j = 0; j < GY; j++)
      for (let i = 0; i < GX; i++) {
        const v = grid[j * GX + i] / mx;
        if (v < 0.02) continue;
        ctx.fillStyle = `rgba(250,204,21,${Math.min(0.75, v * 0.8)})`;
        ctx.fillRect(X(0) + i * cw, Y(0) + j * ch, cw, ch);
      }
  }

  // lines
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(X(0), Y(0), PW * S, PH * S);
  ctx.beginPath();
  ctx.moveTo(X(PW / 2), Y(0)); ctx.lineTo(X(PW / 2), Y(PH));
  ctx.stroke();
  ctx.beginPath(); ctx.arc(X(PW / 2), Y(PH / 2), 9.15 * S, 0, Math.PI * 2); ctx.stroke();
  for (const side of [0, 1]) {
    const gx = side === 0 ? 0 : PW;
    const sgn = side === 0 ? 1 : -1;
    ctx.strokeRect(side === 0 ? X(0) : X(PW - 16.5), Y((PH - 40.3) / 2), 16.5 * S, 40.3 * S);
    ctx.strokeRect(side === 0 ? X(0) : X(PW - 5.5), Y((PH - 18.3) / 2), 5.5 * S, 18.3 * S);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(X(gx) - (side === 0 ? 5 : 0), Y((PH - 7.32) / 2), 5, 7.32 * S);
    ctx.beginPath(); ctx.arc(X(gx + sgn * 11), Y(PH / 2), 2, 0, Math.PI * 2); ctx.fill();
  }

  const m = p.match;
  const r = Math.max(9, S * 1.15);
  const teams = [p.home, p.away];
  const sel = p.selectedId;

  // run arrows & marking lines in edit mode
  if (!m && p.showRuns) {
    for (const ti of [0, 1] as const) {
      ctx.globalAlpha = ti === p.editing ? 0.9 : 0.35;
      for (const pl of teams[ti].players) {
        const [x, y] = toWorld(ti, pl.x, pl.y);
        const dir = ti === 0 ? 1 : -1;
        if (pl.role !== 'GK') {
          const len = pl.inst.runs * 0.16 * PW * S;
          if (len > 6) {
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(X(x) + dir * r, Y(y));
            ctx.lineTo(X(x) + dir * (r + len), Y(y));
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(X(x) + dir * (r + len), Y(y));
            ctx.lineTo(X(x) + dir * (r + len - 6), Y(y) - 4);
            ctx.lineTo(X(x) + dir * (r + len - 6), Y(y) + 4);
            ctx.closePath();
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fill();
          }
        }
        if (pl.inst.mark) {
          const oppIdx = (1 - ti) as 0 | 1;
          const o = teams[oppIdx].players.find((q) => q.id === pl.inst.mark);
          if (o) {
            const [ox, oy] = toWorld(oppIdx, o.x, o.y);
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = '#fde047';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(X(x), Y(y)); ctx.lineTo(X(ox), Y(oy)); ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // shape diagram: lines between players of the same line, team hull, ball trail
  if (m && p.shape) {
    for (const ti of [0, 1] as const) {
      const outfield = m.byTeam[ti].filter((q) => q.spec.role !== 'GK');
      if (outfield.length >= 3) {
        const hull = convexHull(outfield.map((q) => [q.x, q.y] as [number, number]));
        ctx.beginPath();
        hull.forEach(([hx, hy], i) => (i ? ctx.lineTo(X(hx), Y(hy)) : ctx.moveTo(X(hx), Y(hy))));
        ctx.closePath();
        ctx.fillStyle = ti === 0 ? 'rgba(59,130,246,0.14)' : 'rgba(239,68,68,0.14)';
        ctx.fill();
        ctx.strokeStyle = ti === 0 ? 'rgba(147,197,253,0.7)' : 'rgba(252,165,165,0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = ti === 0 ? 'rgba(191,219,254,0.95)' : 'rgba(254,202,202,0.95)';
      ctx.lineWidth = 2.5;
      for (const line of lineClusters(m, ti as 0 | 1)) {
        if (line.length < 2) continue;
        const sorted = [...line].sort((a, b) => a.y - b.y);
        ctx.beginPath();
        sorted.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
        ctx.stroke();
      }
    }
  }
  if (m && p.trail && p.trail.length > 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    p.trail.forEach(([tx, ty], i) => (i ? ctx.lineTo(X(tx), Y(ty)) : ctx.moveTo(X(tx), Y(ty))));
    ctx.stroke();
  }

  // players
  for (const ti of [0, 1] as const) {
    teams[ti].players.forEach((pl, idx) => {
      let x: number, y: number;
      const sp = m?.findPlayer(pl.id);
      if (sp) { x = sp.x; y = sp.y; } else [x, y] = toWorld(ti, pl.x, pl.y);
      const dim = !m && ti !== p.editing ? 0.55 : 1;
      ctx.globalAlpha = dim;
      const hl = p.highlightIds.includes(pl.id);
      if (hl) {
        ctx.strokeStyle = '#fb923c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(X(x), Y(y), r + 4 + Math.sin(time / 180) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = COLORS[ti];
      ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = pl.id === sel ? 3 : 1.5;
      ctx.strokeStyle = pl.id === sel ? '#fde047' : 'rgba(255,255,255,0.9)';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 0.95)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(idx + 1), X(x), Y(y) + 0.5);
      ctx.font = `${Math.max(9, Math.round(r * 0.7))}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(pl.role, X(x), Y(y) + r + 8);
      ctx.globalAlpha = 1;
    });
  }

  // intent labels (what each player is currently doing)
  if (m && p.labels && p.labels !== 'off') {
    for (const ti of [0, 1] as const) {
      teams[ti].players.forEach((pl, idx) => {
        const sp = m.findPlayer(pl.id);
        if (!sp) return;
        if (p.labels === 'selected' && pl.id !== sel) return;
        const text = sp.intent;
        ctx.font = `${Math.max(9, Math.round(r * 0.72))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(text).width + 8;
        const lx = X(sp.x);
        const ly = Y(sp.y) - r - 11;
        ctx.fillStyle = 'rgba(15,23,42,0.82)';
        ctx.fillRect(lx - tw / 2, ly - 8, tw, 16);
        ctx.fillStyle = ti === 0 ? '#bfdbfe' : '#fecaca';
        ctx.fillText(text, lx, ly + 0.5);
        void idx;
      });
    }
  }

  // ball
  if (m) {
    const b = m.ball;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), Math.max(4, S * 0.45), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}
