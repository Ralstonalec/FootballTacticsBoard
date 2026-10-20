import type { Team } from './types';
import type { Aggregate } from './batch';

const SYSTEM = `You are an elite football (soccer) tactical analyst helping a coach refine a tactic on an interactive board.
You will receive the coach's idea, both teams as JSON, and (optionally) results from the board's match simulator.

Board conventions:
- Player x: 0 = own goal line, 1 = opponent goal line. y: 0 = the team's left, 1 = its right.
- Instruction sliders are 0..1: roam (freedom to leave position), press (closing down off the ball), runs (pushing beyond their spot in possession), dribble, shoot. width is -1 (drift inside) to +1 (hug touchline). passing is safe|mixed|direct. mark is an opponent player id to man-mark.
- Team tactics 0..1: lineHeight, compactness, tempo, width.

Give feedback the way a good coach would: concrete and specific, referring to players by role and number (index in the players array + 1).
Structure: (1) what works, (2) the biggest weaknesses or conflicts in instructions, (3) 3-5 specific changes with exact settings, (4) how the opponent would likely exploit it.
Be honest: say when an idea is flawed. Keep it under 350 words. Use short bullet lists.`;

function compact(team: Team) {
  return {
    name: team.name,
    tactics: team.tactics,
    players: team.players.map((p, i) => ({
      n: i + 1, id: p.id, role: p.role, x: +p.x.toFixed(2), y: +p.y.toFixed(2),
      roam: p.inst.roam, press: p.inst.press, runs: p.inst.runs, dribble: p.inst.dribble,
      shoot: p.inst.shoot, width: p.inst.width, passing: p.inst.passing, mark: p.inst.mark,
    })),
  };
}

export async function askClaude(opts: {
  apiKey: string; model: string; idea: string; team: Team; opp: Team; agg?: Aggregate | null; side: 0 | 1;
}): Promise<string> {
  const { apiKey, model, idea, team, opp, agg, side } = opts;
  let sim = '';
  if (agg && agg.n) {
    const me = agg.stats[side], them = agg.stats[1 - side];
    const pm = (v: number) => +(v / agg.n).toFixed(2);
    sim = `\n\nSimulation over ${agg.n} matches (your team vs opponent): W${agg.wins[side]} D${agg.draws} L${agg.wins[1 - side]}; goals ${pm(agg.goals[side])}-${pm(agg.goals[1 - side])};
xG ${pm(me.xg)}-${pm(them.xg)}; shots ${pm(me.shots)}-${pm(them.shots)}; counter-attack shots ${pm(me.counterShots)}-${pm(them.counterShots)};
final-third entries by route (left/centre/right) ${me.entriesByChannel.map(pm).join('/')}; xG conceded by route into your (left/centre/right): ${[them.xgByChannel[2], them.xgByChannel[1], them.xgByChannel[0]].map(pm).join('/')}.`;
  }
  const content = `Coach's idea: ${idea || '(no specific idea; review the setup)'}\n\nMy team:\n${JSON.stringify(compact(team))}\n\nOpponent:\n${JSON.stringify(compact(opp))}${sim}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 1200, system: SYSTEM, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg += ' ' + ((await res.json()).error?.message ?? ''); } catch { /* ignore */ }
    throw new Error(`Claude API error: ${msg}`);
  }
  const data = await res.json();
  return (data.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n');
}
