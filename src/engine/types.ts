export type Role = 'GK' | 'CB' | 'FB' | 'WB' | 'DM' | 'CM' | 'AM' | 'W' | 'ST';
export const ROLES: Role[] = ['GK', 'CB', 'FB', 'WB', 'DM', 'CM', 'AM', 'W', 'ST'];
export const ROLE_LABEL: Record<Role, string> = {
  GK: 'Goalkeeper',
  CB: 'Centre-back',
  FB: 'Full-back',
  WB: 'Wing-back',
  DM: 'Holding midfielder',
  CM: 'Central midfielder',
  AM: 'Attacking midfielder',
  W: 'Winger / wide mid',
  ST: 'Striker',
};

export type PassStyle = 'safe' | 'mixed' | 'direct';

/** Per-player instructions. All sliders are 0..1 except width (-1..1). */
export interface Instructions {
  roam: number; // freedom to leave the assigned spot and follow the ball / find space
  press: number; // how aggressively they close down when the team is out of possession
  runs: number; // how far they push beyond their spot when the team has the ball
  dribble: number; // willingness to carry the ball rather than pass
  shoot: number; // willingness to shoot
  width: number; // -1 drift inside .. +1 hug the touchline
  passing: PassStyle;
  mark: string | null; // opponent player id to man-mark (null = zonal)
  // Role behaviours (optional so older saved boards keep working; defaults give the classic behaviour)
  depth?: number; // -1 drop deep to link play .. +1 stay high / on the last line (default 0)
  lane?: number | null; // preferred channel, 0 = team's left .. 1 = right (null = wherever the formation puts them)
  track?: number; // 0 stay up the pitch .. 1 recover and track back hard when the opponent has the ball (default 0.5)
  cross?: number; // 0 never deliver early/wide balls .. 1 cross at every chance (default 0.5)
}

/**
 * Positions are normalised from the team's own perspective:
 * x: 0 = own goal line, 1 = opponent goal line; y: 0 = the team's left, 1 = right.
 */
export interface PlayerSpec {
  id: string;
  name: string;
  role: Role;
  x: number;
  y: number;
  inst: Instructions;
  roleName?: string; // custom label, e.g. 'Deep-lying playmaker'
  brief?: string; // the coach's own words about what this player should do
}

export interface TeamTactics {
  lineHeight: number; // 0 deep block .. 1 very high line / high press zone
  compactness: number; // 0 spread .. 1 tight
  tempo: number; // 0 slow, patient .. 1 fast, quick decisions
  width: number; // 0 narrow .. 1 stretch the pitch
}

export interface Team {
  name: string;
  players: PlayerSpec[];
  tactics: TeamTactics;
}

export const defaultTactics = (): TeamTactics => ({
  lineHeight: 0.5,
  compactness: 0.5,
  tempo: 0.5,
  width: 0.5,
});

export function defaultInstructions(role: Role): Instructions {
  const base: Instructions = {
    roam: 0.3,
    press: 0.5,
    runs: 0.5,
    dribble: 0.4,
    shoot: 0.4,
    width: 0,
    passing: 'mixed',
    mark: null,
    depth: 0,
    lane: null,
    track: 0.5,
    cross: 0.5,
  };
  switch (role) {
    case 'GK':
      return { ...base, roam: 0.1, press: 0, runs: 0, dribble: 0.05, shoot: 0, passing: 'safe' };
    case 'CB':
      return { ...base, roam: 0.1, press: 0.4, runs: 0.1, dribble: 0.1, shoot: 0.05, passing: 'safe' };
    case 'FB':
      return { ...base, roam: 0.3, press: 0.5, runs: 0.5, dribble: 0.3, shoot: 0.1, width: 0.3 };
    case 'WB':
      return { ...base, roam: 0.4, press: 0.5, runs: 0.75, dribble: 0.4, shoot: 0.15, width: 0.6 };
    case 'DM':
      return { ...base, roam: 0.25, press: 0.6, runs: 0.25, dribble: 0.2, shoot: 0.1, passing: 'safe' };
    case 'CM':
      return { ...base, roam: 0.45, press: 0.6, runs: 0.5, dribble: 0.35, shoot: 0.3 };
    case 'AM':
      return { ...base, roam: 0.6, press: 0.5, runs: 0.65, dribble: 0.5, shoot: 0.55 };
    case 'W':
      return { ...base, roam: 0.4, press: 0.5, runs: 0.75, dribble: 0.7, shoot: 0.55, width: 0.5 };
    case 'ST':
      return { ...base, roam: 0.35, press: 0.55, runs: 0.85, dribble: 0.4, shoot: 0.8, passing: 'direct' };
  }
}

let counter = 0;
export const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function makePlayer(prefix: string, role: Role, x: number, y: number): PlayerSpec {
  return { id: uid(prefix), name: role, role, x, y, inst: defaultInstructions(role) };
}
