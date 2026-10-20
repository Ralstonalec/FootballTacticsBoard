import { FORMATIONS, buildTeam } from './formations';
import type { Team } from './types';

export interface IdeaResult {
  matched: string[];
  feedback: string[];
  risks: string[];
  apply?: (team: Team) => Team;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Keyword-based interpreter for tactical ideas. Handles common concepts offline;
 * free-form critique is delegated to Claude (see ai.ts) when an API key is set.
 */
export function interpretIdea(text: string): IdeaResult | null {
  const s = text.toLowerCase();
  const matched: string[] = [];
  const feedback: string[] = [];
  const risks: string[] = [];
  const patches: ((t: Team) => void)[] = [];
  const has = (re: RegExp) => re.test(s);

  if (has(/high press|gegenpress|counter.?press|press (them )?high|press hard/)) {
    matched.push('High press');
    patches.push((t) => {
      t.tactics.lineHeight = 0.85; t.tactics.compactness = 0.8; t.tactics.tempo = 0.75;
      t.players.forEach((p) => { if (p.role !== 'GK') p.inst.press = clamp01(Math.max(p.inst.press, 0.8)); });
    });
    feedback.push('A high press wins the ball near their goal and shortens the pitch, but only works if the whole team moves together: high line, compact block, front players closing passing lanes.');
    risks.push('Stamina drains and one line of beaten pressers leaves huge space; a good long ball over the top punishes you. Your goalkeeper needs to sweep.');
  }
  if (has(/low block|park the bus|sit deep|defend deep|deep block/)) {
    matched.push('Low block');
    patches.push((t) => {
      t.tactics.lineHeight = 0.15; t.tactics.compactness = 0.9; t.tactics.tempo = 0.4;
      t.players.forEach((p) => { if (p.role !== 'GK') { p.inst.press = 0.2; p.inst.runs = Math.min(p.inst.runs, 0.4); } });
    });
    feedback.push('A deep compact block denies space behind and through the middle, forcing the opponent to shoot from range or cross.');
    risks.push('You cede territory and possession; crosses and second balls become dangerous. Keep one fast outlet for counters or you will be pinned back all game.');
  }
  if (has(/counter.?attack|on the break|break quickly|direct(ly)?\b|long ball/)) {
    matched.push('Counter-attacking / direct play');
    patches.push((t) => {
      t.tactics.lineHeight = Math.min(t.tactics.lineHeight, 0.4); t.tactics.tempo = 0.9;
      t.players.forEach((p) => {
        if (p.role === 'ST' || p.role === 'W' || p.role === 'AM') { p.inst.runs = clamp01(p.inst.runs + 0.15); p.inst.passing = 'direct'; }
        if (p.role === 'CM' || p.role === 'DM') p.inst.passing = 'direct';
      });
    });
    feedback.push('Counters need two things: deep compact defending to win the ball, and fast forwards who run into the space left behind.');
    risks.push('If your forwards are not quicker than their back line, direct passes just give possession away; pass accuracy will drop.');
  }
  if (has(/possession|tiki|build.?up|short pass|patient|control the ball|play out/)) {
    matched.push('Possession / patient build-up');
    patches.push((t) => {
      t.tactics.tempo = 0.25; t.tactics.compactness = 0.65;
      t.players.forEach((p) => { p.inst.passing = p.role === 'ST' ? 'mixed' : 'safe'; });
    });
    feedback.push('Short, safe passing keeps the ball and tires the opponent, and it needs support angles: a DM to receive, full-backs providing width, and a runner stretching the back line.');
    risks.push('Without runners in behind, possession becomes sterile. Mistakes in your own third are punished by a high press.');
  }
  if (has(/false (9|nine)/)) {
    matched.push('False 9');
    patches.push((t) => {
      const st = t.players.find((p) => p.role === 'ST');
      if (st) { st.inst.roam = 0.9; st.inst.runs = 0.25; st.inst.passing = 'safe'; st.inst.dribble = 0.55; st.inst.shoot = 0.5; }
    });
    feedback.push('A false 9 drops into midfield to drag a centre-back out and create a 4v3 in the middle. It only pays off if others run into the space they vacate (wingers cutting inside, AM/CM making late runs).');
    risks.push('No one occupies the centre-backs; if the wingers stay wide there is nobody to score.');
  }
  if (has(/invert(ed)? (full|wing)?.?back|tuck(ing)? in (the )?(full|wing)/)) {
    matched.push('Inverted full-backs');
    patches.push((t) => t.players.forEach((p) => { if (p.role === 'FB' || p.role === 'WB') { p.inst.width = -0.9; p.inst.roam = 0.5; } }));
    feedback.push('Inverted full-backs add a body in midfield for control and protect against counters through the middle.');
    risks.push('You lose width; make sure the wingers stay wide so the pitch is still stretched.');
  }
  if (has(/wing.?backs?|overlap|stretch|play wide|use the wings|use width/)) {
    matched.push('Width / overlapping');
    patches.push((t) => {
      t.tactics.width = 0.85;
      t.players.forEach((p) => { if (p.role === 'FB' || p.role === 'WB' || p.role === 'W') { p.inst.width = Math.max(p.inst.width, 0.6); p.inst.runs = clamp01(p.inst.runs + 0.1); } });
    });
    feedback.push('Using the full width pulls the opponent apart and creates gaps between their full-backs and centre-backs.');
    risks.push('When both flank players attack together you need a holding midfielder or a third centre-back behind them.');
  }
  const ov = s.match(/overload (the )?(left|right)/);
  if (ov) {
    const side = ov[2] as 'left' | 'right';
    matched.push(`Overload ${side}`);
    patches.push((t) => t.players.forEach((p) => {
      if (p.role === 'GK') return;
      const target = side === 'left' ? 0.15 : 0.85;
      if (p.x > 0.3 && p.x < 0.8) { p.y = p.y + (target - p.y) * 0.45; }
    }));
    feedback.push(`Shifting midfielders and forwards toward the ${side} creates a local numerical advantage so you can combine quickly and break the line there.`);
    risks.push(`The opposite flank is left thin: the opponent's switch of play is your weakness. Keep one wide player on the far side.`);
  }
  if (has(/man.?mark|mark (him|their|tight)/)) {
    matched.push('Man-marking (use the Marking dropdown for specific assignments)');
    feedback.push('Man-marking removes a specific threat but drags your shape around and can leave space for others. Assign it to your best defender against their best creator, not to everyone.');
  }
  if (has(/offside trap/)) {
    matched.push('Offside trap');
    patches.push((t) => { t.tactics.lineHeight = 0.8; t.tactics.compactness = 0.9; t.players.forEach((p) => { if (p.role === 'CB') p.inst.roam = 0; }); });
    feedback.push('An offside trap needs a flat, compact back line stepping up as one with no one lagging behind.');
    risks.push('One mistimed step releases a striker 1-on-1. High risk, high reward.');
  }
  const back = s.match(/(3|5) at the back|back (3|5)|(3|5) ?cbs?|three at the back|five at the back/);
  if (back) {
    const three = /3|three/.test(back[0]);
    const f = three ? '3-5-2' : '5-3-2';
    matched.push(`Back ${three ? 'three' : 'five'}`);
    patches.push((t) => { const n = buildTeam(t.name, f, 0); t.players = n.players; });
    feedback.push(three ? 'A back three gives numerical superiority against two strikers and lets wing-backs push on, but needs wing-backs with huge stamina.' : 'A back five is solid defensively, particularly against wide threats, but strikers can be isolated.');
  }

  if (!matched.length) return null;
  return {
    matched,
    feedback,
    risks,
    apply: (team) => {
      const copy = structuredClone(team);
      patches.forEach((fn) => fn(copy));
      return copy;
    },
  };
}

export const FORMATION_NAMES = Object.keys(FORMATIONS);
