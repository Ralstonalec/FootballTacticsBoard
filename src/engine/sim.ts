import type { PlayerSpec, Role, Team } from './types';
import { RNG } from './rng';
import { GOAL_W, PH, PW, clamp, dist, distToSegment, lerp, toWorld } from './geometry';

export const GX = 21;
export const GY = 14;
export const MATCH_SECONDS = 90 * 60;

const MAX_SPEED: Record<Role, number> = {
  GK: 5.5, CB: 7.0, FB: 7.8, WB: 8.0, DM: 7.2, CM: 7.4, AM: 7.6, W: 8.2, ST: 7.9,
};

// Tuning knobs (see scripts/simtest.ts to re-calibrate)
const SHOOT_K = 0.012;
const DECIDE_BASE = 2.0; // seconds a carrier holds the ball before the next decision (tempo scales it)
const DUEL_K = 1.0;
const INTERCEPT_K = 0.5;

export type TeamIdx = 0 | 1;

export interface SimPlayer {
  spec: PlayerSpec;
  team: TeamIdx;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  sprint: boolean;
  stamina: number;
  decideT: number;
  rank: number; // distance rank to ball within own team (outfield)
}

interface Flight {
  fx: number; fy: number; tx: number; ty: number;
  t: number; dur: number;
  passer: SimPlayer;
  receiver: SimPlayer | null;
  kind: 'pass' | 'shot';
  outcome?: 'goal' | 'save' | 'miss' | 'blocked';
}

export interface Ball {
  x: number; y: number; vx: number; vy: number;
  owner: SimPlayer | null;
  flight: Flight | null;
  lastTeam: TeamIdx;
}

export interface TeamStats {
  possessionT: number;
  passes: number;
  passesDone: number;
  shots: number;
  onTarget: number;
  goals: number;
  xg: number;
  tackles: number;
  interceptions: number;
  highRecoveries: number;
  ownThirdLosses: number;
  finalThirdEntries: number;
  counterShots: number;
  entriesByChannel: [number, number, number]; // final-third entries by route: attacking-perspective left / centre / right
  xgByChannel: [number, number, number]; // xG by the route the attack came in on
  touchGrid: number[];
}

export const emptyStats = (): TeamStats => ({
  possessionT: 0, passes: 0, passesDone: 0, shots: 0, onTarget: 0, goals: 0, xg: 0,
  tackles: 0, interceptions: 0, highRecoveries: 0, ownThirdLosses: 0, finalThirdEntries: 0,
  counterShots: 0, entriesByChannel: [0, 0, 0], xgByChannel: [0, 0, 0], touchGrid: new Array(GX * GY).fill(0),
});

export interface MatchEvent { t: number; team: TeamIdx; text: string; kind: 'goal' | 'shot' }

const attDir = (team: TeamIdx) => (team === 0 ? 1 : -1);
const progress = (team: TeamIdx, x: number) => (team === 0 ? x / PW : 1 - x / PW);

export function xgAt(team: TeamIdx, x: number, y: number): number {
  const gx = team === 0 ? PW : 0;
  const dx = Math.max(0.5, Math.abs(gx - x));
  const dy = y - PH / 2;
  const d = Math.hypot(dx, dy);
  let a = Math.atan2(GOAL_W * dx, dx * dx + dy * dy - (GOAL_W / 2) ** 2);
  if (a < 0) a += Math.PI;
  const logit = -1.5 - 0.15 * d + 1.3 * a;
  return 1 / (1 + Math.exp(-logit));
}

export class Match {
  t = 0;
  finished = false;
  score: [number, number] = [0, 0];
  players: SimPlayer[] = [];
  byTeam: [SimPlayer[], SimPlayer[]] = [[], []];
  teams: [Team, Team];
  ball: Ball;
  stats: [TeamStats, TeamStats] = [emptyStats(), emptyStats()];
  events: MatchEvent[] = [];
  readonly rng: RNG;
  readonly dt: number;
  private offLimit: [number, number] = [PW, 0];
  private pressSlots: [number, number] = [2, 2];
  private lastWinT: [number, number] = [-99, -99];
  private inFinal: [boolean, boolean] = [false, false];
  private landingDefender: SimPlayer | null = null;
  private lastOwnerTeam: TeamIdx = 0;
  private entryChannel: [0 | 1 | 2, 0 | 1 | 2] = [1, 1];

  constructor(home: Team, away: Team, seed = 1, dt = 0.1) {
    this.teams = [home, away];
    this.rng = new RNG(seed);
    this.dt = dt;
    ([home, away] as Team[]).forEach((team, ti) => {
      for (const spec of team.players) {
        const p: SimPlayer = {
          spec, team: ti as TeamIdx, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0,
          sprint: false, stamina: 1, decideT: 0.5, rank: 0,
        };
        this.players.push(p);
        this.byTeam[ti].push(p);
      }
    });
    this.ball = { x: PW / 2, y: PH / 2, vx: 0, vy: 0, owner: null, flight: null, lastTeam: 0 };
    this.kickoff(this.rng.next() < 0.5 ? 0 : 1);
  }

  get clock(): string {
    const m = Math.floor(this.t / 60);
    const s = Math.floor(this.t % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  findPlayer(id: string): SimPlayer | undefined {
    return this.players.find((p) => p.spec.id === id);
  }

  runToEnd(): void {
    while (!this.finished) this.step(this.dt);
  }

  // ---------------------------------------------------------------- kickoff
  private kickoff(team: TeamIdx): void {
    for (const p of this.players) {
      const nx = Math.min(p.spec.x, 0.47);
      [p.x, p.y] = toWorld(p.team, nx, p.spec.y);
      p.vx = p.vy = 0;
      p.tx = p.x;
      p.ty = p.y;
    }
    const mates = this.byTeam[team];
    if (mates.length === 0) return;
    let taker = mates[0];
    for (const m of mates) if (m.spec.x > taker.spec.x && m.spec.role !== 'GK') taker = m;
    taker.x = PW / 2;
    taker.y = PH / 2;
    this.ball.x = PW / 2;
    this.ball.y = PH / 2;
    this.ball.flight = null;
    this.ball.owner = taker;
    this.ball.lastTeam = team;
    this.lastOwnerTeam = team;
    taker.decideT = 1.2;
    this.inFinal = [false, false];
  }

  // ------------------------------------------------------------------- step
  step(dt: number): void {
    if (this.finished) return;
    this.t += dt;
    if (this.t >= MATCH_SECONDS) {
      this.finished = true;
      return;
    }
    const ball = this.ball;
    this.computeOffsideLimits();
    this.rankPlayers();

    if (ball.flight) this.updateFlight(dt);
    else if (!ball.owner) this.updateLooseBall(dt);

    // The carrier decides first so both teams react to the same ball state this tick
    if (ball.owner) this.carryTarget(ball.owner, dt);
    const possTeam: TeamIdx = ball.owner ? ball.owner.team : ball.lastTeam;
    for (const p of this.players) {
      if (ball.owner !== p) this.setTarget(p, possTeam);
    }
    for (const p of this.players) this.move(p, dt);
    this.separate();

    if (ball.owner) {
      ball.x = ball.owner.x;
      ball.y = ball.owner.y;
      this.duel(ball.owner, dt);
    }

    this.trackStats(possTeam, dt);
  }

  private computeOffsideLimits(): void {
    for (const team of [0, 1] as TeamIdx[]) {
      const defs = this.byTeam[1 - team];
      if (defs.length === 0) {
        this.offLimit[team] = team === 0 ? PW : 0;
        continue;
      }
      const xs = defs.map((d) => d.x).sort((a, b) => (team === 0 ? b - a : a - b));
      const second = xs.length > 1 ? xs[1] : xs[0];
      this.offLimit[team] = team === 0 ? Math.max(second, this.ball.x) : Math.min(second, this.ball.x);
    }
  }

  private isOffside(team: TeamIdx, x: number): boolean {
    return team === 0 ? x > this.offLimit[0] : x < this.offLimit[1];
  }

  private rankPlayers(): void {
    const b = this.ball;
    for (const team of [0, 1] as TeamIdx[]) {
      const outfield = this.byTeam[team].filter((p) => p.spec.role !== 'GK');
      const ds = new Map<SimPlayer, number>();
      for (const p of outfield) ds.set(p, dist(p.x, p.y, b.x, b.y));
      outfield.sort((a, c) => ds.get(a)! - ds.get(c)!);
      outfield.forEach((p, i) => (p.rank = i));
      for (const p of this.byTeam[team]) if (p.spec.role === 'GK') p.rank = 99;
      const avgPress = outfield.length ? outfield.reduce((s, p) => s + p.spec.inst.press, 0) / outfield.length : 0;
      this.pressSlots[team] = 1 + Math.round(2.5 * avgPress);
    }
  }

  // ---------------------------------------------------------- off-ball logic
  private setTarget(p: SimPlayer, possTeam: TeamIdx): void {
    const { spec } = p;
    const inst = spec.inst;
    const tac = this.teams[p.team].tactics;
    const dir = attDir(p.team);
    const ball = this.ball;
    const inPoss = possTeam === p.team;
    p.sprint = false;

    if (spec.role === 'GK') {
      this.goalkeeperTarget(p);
      return;
    }

    // Receiver / interceptor of a pass in flight
    const f = ball.flight;
    if (f && f.kind === 'pass') {
      if (f.receiver === p) {
        p.tx = f.tx; p.ty = f.ty; p.sprint = true;
        return;
      }
      if (this.landingDefender === p) {
        p.tx = f.tx; p.ty = f.ty; p.sprint = true;
        return;
      }
    }
    // Loose ball: nearest two from each team chase
    if (!ball.owner && !f && p.rank < 2) {
      p.tx = ball.x; p.ty = ball.y; p.sprint = true;
      return;
    }

    // Base position from formation + team tactics
    let nx = spec.x;
    let ny = 0.5 + (spec.y - 0.5) * (0.65 + 0.7 * tac.width);
    const side = ny < 0.5 ? -1 : 1;
    ny += inst.width * 0.1 * side;
    nx += (tac.lineHeight - 0.5) * 0.3 * (1 - nx);
    if (inPoss) nx += inst.runs * 0.16;
    else nx -= (1 - inst.runs) * 0.04;
    nx = clamp(nx, 0.02, 0.98);
    ny = clamp(ny, 0.03, 0.97);
    let [wx, wy] = toWorld(p.team, nx, ny);

    // Team shape shifts with the ball
    wx += (ball.x - PW / 2) * 0.3;
    wy += (ball.y - PH / 2) * (0.25 + 0.3 * tac.compactness);

    // Roam toward the ball / support space
    if (inPoss) {
      const sx = ball.x + dir * 10;
      const sy = wy * 0.5 + ball.y * 0.5;
      const w = inst.roam * 0.45;
      wx += (sx - wx) * w;
      wy += (sy - wy) * w;
    } else {
      const w = inst.roam * 0.25;
      wx += (ball.x - dir * 3 - wx) * w;
      wy += (ball.y - wy) * w;
    }

    let pressing = false;
    if (!inPoss) {
      const d = dist(p.x, p.y, ball.x, ball.y);
      const f0 = progress(p.team, ball.x);
      const pressAllowed = f0 < 0.35 + 0.65 * tac.lineHeight;
      const radius = 6 + 26 * inst.press;
      if (pressAllowed && inst.press > 0.15 && p.rank < this.pressSlots[p.team] && d < radius) {
        wx = ball.x - dir * 1.0;
        wy = ball.y;
        p.sprint = true;
        pressing = true;
      } else if (!inst.mark && p.rank >= this.pressSlots[p.team] && p.rank < this.pressSlots[p.team] + 2 && f0 < 0.6) {
        // cover: drop goal-side of the ball to deny the lane to goal
        const ownGx = p.team === 0 ? 0 : PW;
        const k = 0.16 + 0.1 * (p.rank - this.pressSlots[p.team]);
        wx = lerp(wx, ball.x + (ownGx - ball.x) * k, 0.7);
        wy = lerp(wy, ball.y + (PH / 2 - ball.y) * k, 0.7);
      } else if (inst.mark) {
        const opp = this.findPlayer(inst.mark);
        if (opp && opp.team !== p.team) {
          wx = opp.x - dir * 1.5;
          wy = opp.y;
          p.sprint = dist(p.x, p.y, opp.x, opp.y) < 22;
        }
      } else {
        // zonal marking: pick up the nearest attacker in my zone and stay goal-side
        let nearest: SimPlayer | null = null;
        let nd = 14;
        for (const o of this.byTeam[1 - p.team]) {
          if (o.spec.role === 'GK') continue;
          const dd = dist(o.x, o.y, wx, wy);
          if (dd < nd) { nd = dd; nearest = o; }
        }
        if (nearest) {
          const w = 0.7 * clamp(1.2 - nd / 14, 0, 1) * (0.4 + 0.6 * clamp(1 - f0, 0, 1));
          wx = lerp(wx, nearest.x - dir * 2, w);
          wy = lerp(wy, nearest.y, w);
          p.sprint = nd < 8;
        }
      }
    } else if (!ball.owner || ball.owner !== p) {
      // keep attackers onside
      const lim = this.offLimit[p.team];
      wx = p.team === 0 ? Math.min(wx, lim - 0.4) : Math.max(wx, lim + 0.4);
      p.sprint = dist(p.x, p.y, wx, wy) > 6;
    }

    if (!inPoss && !pressing) {
      // recover: stay within a block of the ball instead of waiting up the pitch
      const lead = 14 + 26 * tac.lineHeight;
      wx = dir > 0 ? Math.min(wx, ball.x + lead) : Math.max(wx, ball.x - lead);
    }
    if (!inPoss && p.rank >= this.pressSlots[p.team]) {
      // protect the box: when the ball is in my defensive third, collapse toward the goal-ball line
      const danger = clamp((0.3 - progress(p.team, ball.x)) / 0.3, 0, 1);
      if (danger > 0) {
        const ownGx = p.team === 0 ? 0 : PW;
        wx = lerp(wx, ownGx + (ball.x - ownGx) * 0.55, 0.45 * danger);
        wy = lerp(wy, PH / 2 + (ball.y - PH / 2) * 0.5, 0.45 * danger);
      }
    }
    p.tx = clamp(wx, 0.5, PW - 0.5);
    p.ty = clamp(wy, 0.5, PH - 0.5);
  }

  private goalkeeperTarget(p: SimPlayer): void {
    const tac = this.teams[p.team].tactics;
    const dir = attDir(p.team);
    const ball = this.ball;
    const gx = p.team === 0 ? 0 : PW;
    if (ball.owner === p) {
      p.tx = p.x; p.ty = p.y;
      return;
    }
    const dBall = Math.abs(ball.x - gx);
    const out = 1.5 + clamp(dBall * 0.08, 0, 12) * (0.5 + 0.5 * tac.lineHeight);
    p.tx = gx + dir * out;
    p.ty = PH / 2 + clamp((ball.y - PH / 2) * 0.18, -4.5, 4.5);
    const f = ball.flight;
    if (f && f.kind === 'shot' && f.passer.team !== p.team) {
      p.ty = PH / 2 + clamp(f.ty - PH / 2, -3.5, 3.5);
      p.sprint = true;
    }
  }

  // ------------------------------------------------------------ ball carrier
  private carryTarget(p: SimPlayer, dt: number): void {
    p.decideT -= dt;
    p.sprint = true;
    if (p.spec.role === 'GK') {
      p.tx = p.x; p.ty = p.y;
    }
    if (p.decideT <= 0) this.decide(p);
  }

  private decide(p: SimPlayer): void {
    const team = p.team;
    const dir = attDir(team);
    const inst = p.spec.inst;
    const tac = this.teams[team].tactics;
    const opps = this.byTeam[1 - team];
    const mates = this.byTeam[team];

    let d0 = 99;
    for (const o of opps) d0 = Math.min(d0, dist(o.x, o.y, p.x, p.y));
    const pressure = clamp(1 - d0 / 6, 0, 1);
    p.decideT = (DECIDE_BASE + (1 - tac.tempo) * 2.0) * (0.7 + 0.6 * this.rng.next()) * (pressure > 0.6 ? 0.7 : 1);

    // Shoot?
    if (p.spec.role !== 'GK') {
      const gx = team === 0 ? PW : 0;
      const dg = dist(p.x, p.y, gx, PH / 2);
      if (dg < 28) {
        const xg = xgAt(team, p.x, p.y) * (0.7 + 0.3 * clamp(d0 / 4, 0, 1));
        // closer = more tempting, but even speculative efforts get taken by shooters
        const nearness = clamp((30 - dg) / 22, 0, 1);
        const desire = (nearness * 0.7 + xg * 2) * (0.15 + 1.6 * inst.shoot) * SHOOT_K * 3;
        if (this.rng.next() < Math.min(0.8, desire)) {
          this.shoot(p, xg);
          return;
        }
      }
    }

    // Pass options
    const W =
      inst.passing === 'safe' ? { prog: 0.6, keep: 1.2, dist: 0.4 }
      : inst.passing === 'direct' ? { prog: 1.6, keep: 0.4, dist: 0.0 }
      : { prog: 1.0, keep: 0.8, dist: 0.2 };
    const maxRange = inst.passing === 'direct' ? 55 : 38;
    let best: SimPlayer | null = null;
    let bestS = -1e9;
    for (const m of mates) {
      if (m === p) continue;
      const dm = dist(p.x, p.y, m.x, m.y);
      if (dm < 3.5 || dm > maxRange) continue;
      if (this.isOffside(team, m.x) && (m.x - p.x) * dir > 0) continue;
      const prog = (m.x - p.x) * dir;
      let open = 12;
      let lane = 8;
      for (const o of opps) {
        open = Math.min(open, dist(o.x, o.y, m.x, m.y));
        lane = Math.min(lane, distToSegment(o.x, o.y, p.x, p.y, m.x, m.y));
      }
      // expected completion drives the choice: risky passes are only worth it when they pay off
      const pS = clamp(0.15 + 0.14 * lane + 0.03 * open - 0.004 * dm, 0.05, 0.97);
      let s = pS * ((W.prog * prog) / 25 + W.keep) - (W.dist * dm) / 40;
      s += (this.rng.next() - 0.5) * 0.3;
      if (m.spec.role === 'GK' && p.spec.role !== 'GK') s -= 0.6;
      if (s > bestS) { bestS = s; best = m; }
    }

    // Dribble options
    const gxT = team === 0 ? PW : 0;
    const base = Math.atan2(PH / 2 - p.y, gxT - p.x);
    let dBest = -1e9;
    let dx = 0, dy = 0, dSpace = 0;
    for (const ang of [-0.9, -0.45, 0, 0.45, 0.9]) {
      const ex = clamp(p.x + 9 * Math.cos(base + ang), 1, PW - 1);
      const ey = clamp(p.y + 9 * Math.sin(base + ang), 1, PH - 1);
      let space = 10;
      for (const o of opps) space = Math.min(space, dist(o.x, o.y, ex, ey));
      const fwd = ((ex - p.x) * dir) / 9;
      const s = (space / 10) * 0.8 + fwd * 0.5;
      if (s > dBest) { dBest = s; dx = ex; dy = ey; dSpace = space; }
    }
    const dribbleScore = (0.2 + 1.6 * inst.dribble) * (dSpace / 10) * (1 - 0.5 * pressure) + dBest * 0.3;

    if (best && (bestS >= dribbleScore || p.spec.role === 'GK')) {
      this.pass(p, best, pressure);
    } else if (pressure > 0.75 && best) {
      this.pass(p, best, pressure);
    } else {
      p.tx = dx;
      p.ty = dy;
      p.decideT = Math.min(p.decideT, 1.2);
    }
  }

  private pass(p: SimPlayer, m: SimPlayer, pressure: number): void {
    const ball = this.ball;
    const dm = dist(p.x, p.y, m.x, m.y);
    const lead = Math.min(1.2, dm / 17);
    const sigma = 0.5 + dm * 0.03 + pressure * 1.0;
    const tx = clamp(m.x + m.vx * lead + this.rng.normal() * sigma, 0.5, PW - 0.5);
    const ty = clamp(m.y + m.vy * lead + this.rng.normal() * sigma, 0.5, PH - 0.5);
    const speed = p.spec.inst.passing === 'direct' ? 19 : 15;
    const dur = Math.max(0.3, dist(p.x, p.y, tx, ty) / speed);
    ball.flight = { fx: p.x, fy: p.y, tx, ty, t: 0, dur, passer: p, receiver: m, kind: 'pass' };
    ball.owner = null;
    ball.lastTeam = p.team;
    this.stats[p.team].passes++;
    // nearest opposing defender attempts to cut it out
    let nd: SimPlayer | null = null;
    let ndd = 8;
    for (const o of this.byTeam[1 - p.team]) {
      const d = dist(o.x, o.y, tx, ty);
      if (d < ndd) { ndd = d; nd = o; }
    }
    this.landingDefender = nd;
  }

  private shoot(p: SimPlayer, xg: number): void {
    const team = p.team;
    const ball = this.ball;
    const st = this.stats[team];
    const gx = team === 0 ? PW : 0;
    const ty = PH / 2 + (this.rng.next() - 0.5) * 5;
    st.shots++;
    st.xg += xg;
    st.xgByChannel[this.entryChannel[team]] += xg;
    if (this.t - this.lastWinT[team] < 10) st.counterShots++;

    let blockers = 0;
    let blocker: SimPlayer | null = null;
    for (const o of this.byTeam[1 - team]) {
      if (o.spec.role === 'GK') continue;
      if (distToSegment(o.x, o.y, p.x, p.y, gx, PH / 2) < 2.2) {
        blockers++;
        blocker = o;
      }
    }
    const pBlock = Math.min(0.7, blockers * 0.25);
    let outcome: 'goal' | 'save' | 'miss' | 'blocked';
    let tx = gx;
    let tyy = ty;
    if (blocker && this.rng.next() < pBlock) {
      outcome = 'blocked';
      tx = blocker.x;
      tyy = blocker.y;
    } else {
      const gk = this.byTeam[1 - team].find((q) => q.spec.role === 'GK');
      const r = this.rng.next();
      if (!gk) outcome = r < Math.min(0.9, xg * 2.2 + 0.1) ? 'goal' : 'miss';
      else outcome = r < xg ? 'goal' : r < xg + (1 - xg) * 0.45 ? 'save' : 'miss';
      if (outcome === 'goal' || outcome === 'save') st.onTarget++;
    }
    const dur = Math.max(0.25, dist(p.x, p.y, tx, tyy) / 24);
    ball.flight = { fx: p.x, fy: p.y, tx, ty: tyy, t: 0, dur, passer: p, receiver: null, kind: 'shot', outcome };
    ball.owner = null;
    ball.lastTeam = team;
    this.events.push({ t: this.t, team, kind: 'shot', text: `Shot (xG ${xg.toFixed(2)})` });
    if (this.events.length > 200) this.events.shift();
  }

  /** 0 = attacking left, 1 = centre, 2 = attacking right (from `team`'s perspective). */
  private channelOf(team: TeamIdx, wy: number): 0 | 1 | 2 {
    const ny = team === 0 ? wy / PH : 1 - wy / PH;
    return ny < 0.3 ? 0 : ny > 0.7 ? 2 : 1;
  }

  // ------------------------------------------------------------- ball flight
  private updateFlight(dt: number): void {
    const ball = this.ball;
    const f = ball.flight!;
    f.t += dt;
    const u = Math.min(1, f.t / f.dur);
    ball.x = lerp(f.fx, f.tx, u);
    ball.y = lerp(f.fy, f.ty, u);

    if (f.kind === 'pass' && u > 0.05) {
      for (const o of this.byTeam[1 - f.passer.team]) {
        if (dist(o.x, o.y, ball.x, ball.y) < 2.0) {
          const rate = 3.2 * INTERCEPT_K * (0.4 + 0.6 * o.spec.inst.press);
          if (this.rng.next() < 1 - Math.exp(-dt * rate)) {
            this.stats[o.team].interceptions++;
            this.setOwner(o);
            return;
          }
        }
      }
    }
    if (u < 1) return;

    if (f.kind === 'pass') {
      let win: SimPlayer | null = null;
      let wd = 3;
      for (const q of this.players) {
        let d = dist(q.x, q.y, f.tx, f.ty);
        if (q === f.receiver) d -= 0.6;
        else if (q.team === f.passer.team) d -= 0.2;
        if (d < wd) { wd = d; win = q; }
      }
      let crowd = 0;
      if (win) for (const o of this.players) if (o.team !== win.team && dist(o.x, o.y, win.x, win.y) < 2.5) crowd++;
      if (win && this.rng.next() < 0.95 - 0.1 * crowd) {
        if (win.team === f.passer.team) this.stats[win.team].passesDone++;
        else this.stats[win.team].interceptions++;
        this.setOwner(win);
      } else {
        this.releaseLoose(f.tx, f.ty);
      }
      return;
    }

    // shot resolution
    const att = f.passer.team;
    const def = (1 - att) as TeamIdx;
    const gk = this.byTeam[def].find((q) => q.spec.role === 'GK');
    switch (f.outcome) {
      case 'goal':
        this.score[att]++;
        this.stats[att].goals++;
        this.events.push({ t: this.t, team: att, kind: 'goal', text: `GOAL! ${this.teams[att].name} ${this.score[0]}-${this.score[1]}` });
        this.ball.flight = null;
        this.kickoff(def);
        break;
      case 'blocked':
        this.releaseLoose(f.tx, f.ty);
        break;
      default: {
        const taker = gk ?? this.nearestTo(def, f.tx, f.ty);
        if (taker) {
          this.setOwner(taker);
        } else this.releaseLoose(f.tx, f.ty);
      }
    }
  }

  private nearestTo(team: TeamIdx, x: number, y: number): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bd = 1e9;
    for (const p of this.byTeam[team]) {
      const d = dist(p.x, p.y, x, y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  private releaseLoose(x: number, y: number): void {
    const b = this.ball;
    b.flight = null;
    b.owner = null;
    b.x = clamp(x, 0.5, PW - 0.5);
    b.y = clamp(y, 0.5, PH - 0.5);
    b.vx = (this.rng.next() - 0.5) * 4;
    b.vy = (this.rng.next() - 0.5) * 4;
  }

  private updateLooseBall(dt: number): void {
    const b = this.ball;
    b.x = clamp(b.x + b.vx * dt, 0.5, PW - 0.5);
    b.y = clamp(b.y + b.vy * dt, 0.5, PH - 0.5);
    const k = Math.max(0, 1 - 2 * dt);
    b.vx *= k;
    b.vy *= k;
    let best: SimPlayer | null = null;
    let bd = 1.4;
    for (const p of this.players) {
      const d = dist(p.x, p.y, b.x, b.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best && this.rng.next() < 1 - Math.exp(-dt * 6)) this.setOwner(best);
  }

  private setOwner(p: SimPlayer): void {
    const b = this.ball;
    if (this.lastOwnerTeam !== p.team) {
      this.lastWinT[p.team] = this.t;
      if (progress(p.team, p.x) > 0.5) this.stats[p.team].highRecoveries++;
      if (progress(this.lastOwnerTeam, p.x) < 0.33) this.stats[this.lastOwnerTeam].ownThirdLosses++;
    }
    this.lastOwnerTeam = p.team;
    b.owner = p;
    b.flight = null;
    b.lastTeam = p.team;
    b.x = p.x;
    b.y = p.y;
    p.decideT = 0.3 + this.rng.next() * 0.4;
    // default carry: head goalward until the next decision
    const dir = attDir(p.team);
    p.tx = clamp(p.x + dir * 8, 1, PW - 1);
    p.ty = p.y + (PH / 2 - p.y) * 0.2;
  }

  // ----------------------------------------------------------------- duels
  private duel(c: SimPlayer, dt: number): void {
    for (const o of this.byTeam[1 - c.team]) {
      if (dist(o.x, o.y, c.x, c.y) > 1.6) continue;
      const rate = DUEL_K * (0.5 + 1.4 * o.spec.inst.press) * (1.2 - 0.5 * c.spec.inst.dribble);
      if (this.rng.next() < 1 - Math.exp(-dt * rate)) {
        this.stats[o.team].tackles++;
        if (this.rng.next() < 0.55) this.setOwner(o);
        else {
          this.lastWinT[o.team] = this.t;
          this.ball.owner = null;
          this.ball.lastTeam = o.team;
          this.lastOwnerTeam = c.team;
          this.releaseLoose(c.x + (o.x - c.x) * 0.5, c.y + (o.y - c.y) * 0.5);
        }
        return;
      }
    }
  }

  // -------------------------------------------------------------- movement
  private move(p: SimPlayer, dt: number): void {
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const maxS = MAX_SPEED[p.spec.role] * (0.88 + 0.12 * p.stamina);
    const want = p.sprint ? maxS * (this.ball.owner === p ? 0.88 : 1) : maxS * 0.72;
    const sp = Math.min(want, d * 2.2);
    const dvx = d > 0.05 ? (dx / d) * sp : 0;
    const dvy = d > 0.05 ? (dy / d) * sp : 0;
    const a = Math.min(1, dt * 5);
    p.vx += (dvx - p.vx) * a;
    p.vy += (dvy - p.vy) * a;
    p.x = clamp(p.x + p.vx * dt, 0, PW);
    p.y = clamp(p.y + p.vy * dt, 0, PH);
    const ratio = Math.hypot(p.vx, p.vy) / maxS;
    p.stamina = Math.max(0.6, p.stamina - dt * ratio * ratio * 0.00012);
  }

  private separate(): void {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 0.81 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (0.9 - d) * 0.25;
          const ux = dx / d;
          const uy = dy / d;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
        }
      }
    }
  }

  // ------------------------------------------------------------------ stats
  private trackStats(possTeam: TeamIdx, dt: number): void {
    const st = this.stats[possTeam];
    st.possessionT += dt;
    const gi = clamp(Math.floor((this.ball.x / PW) * GX), 0, GX - 1);
    const gj = clamp(Math.floor((this.ball.y / PH) * GY), 0, GY - 1);
    st.touchGrid[gj * GX + gi] += dt;
    for (const team of [0, 1] as TeamIdx[]) {
      const pr = progress(team, this.ball.x);
      if (possTeam === team) {
        if (pr > 0.667 && !this.inFinal[team]) {
          this.inFinal[team] = true;
          this.stats[team].finalThirdEntries++;
          this.stats[team].entriesByChannel[this.channelOf(team, this.ball.y)]++;
          this.entryChannel[team] = this.channelOf(team, this.ball.y);
        } else if (pr < 0.6) this.inFinal[team] = false;
      } else this.inFinal[team] = false;
    }
  }
}
