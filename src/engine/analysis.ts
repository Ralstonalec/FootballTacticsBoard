import type { Aggregate } from './batch';
import type { PlayerSpec, Team } from './types';
import { PH, PW } from './geometry';

export type Severity = 'good' | 'info' | 'warn' | 'risk';
export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
  playerIds?: string[];
}

const outfield = (t: Team) => t.players.filter((p) => p.role !== 'GK');
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const SIDE = ['left', 'centre', 'right'] as const;

/** Group outfield players into lines by depth. */
export function detectLines(team: Team): PlayerSpec[][] {
  const ps = [...outfield(team)].sort((a, b) => a.x - b.x);
  const lines: PlayerSpec[][] = [];
  for (const p of ps) {
    const last = lines[lines.length - 1];
    if (last && p.x - last[last.length - 1].x < 0.1) last.push(p);
    else lines.push([p]);
  }
  return lines;
}

export const shapeString = (team: Team) => detectLines(team).map((l) => l.length).join('-');

const channel = (y: number) => (y < 0.33 ? 0 : y > 0.67 ? 2 : 1);

/** Structural feedback straight from the board: no simulation required. */
export function staticFindings(team: Team, opp?: Team): Finding[] {
  const out: Finding[] = [];
  const of = outfield(team);
  const t = team.tactics;
  const lines = detectLines(team);

  out.push({
    severity: 'info',
    title: `Shape reads as ${shapeString(team) || 'empty'}`,
    detail: `${team.players.length} players on the board, arranged in ${lines.length} lines. Line depths (own goal → opponent goal): ${lines
      .map((l) => (avg(l.map((p) => p.x)) * 100).toFixed(0) + '%')
      .join(', ')}.`,
  });

  if (!team.players.some((p) => p.role === 'GK'))
    out.push({ severity: 'risk', title: 'No goalkeeper', detail: 'Every shot on target is far more likely to score. Add a GK unless this is deliberate.' });
  if (team.players.length < 11)
    out.push({ severity: 'warn', title: `Playing with ${team.players.length} players`, detail: 'You are a man down on the pitch. Fine for experiments, but expect gaps.' });

  // overlaps
  const crowded: string[] = [];
  for (let i = 0; i < of.length; i++)
    for (let j = i + 1; j < of.length; j++)
      if (Math.hypot((of[i].x - of[j].x) * PW, (of[i].y - of[j].y) * PH) < 6) crowded.push(of[i].id, of[j].id);
  if (crowded.length)
    out.push({ severity: 'warn', title: 'Players stacked on top of each other', detail: 'Some players start less than 6m apart, which wastes coverage and clogs passing lanes.', playerIds: [...new Set(crowded)] });

  // gaps between lines
  for (let i = 1; i < lines.length; i++) {
    const gap = avg(lines[i].map((p) => p.x)) - avg(lines[i - 1].map((p) => p.x));
    if (gap > 0.28)
      out.push({
        severity: 'warn',
        title: 'Big gap between lines',
        detail: `About ${(gap * PW).toFixed(0)}m between line ${i} and line ${i + 1}. Opponents can receive between the lines and turn. Compress the lines or add a link player (DM/AM).`,
        playerIds: [...lines[i - 1], ...lines[i]].map((p) => p.id),
      });
  }

  // flank coverage
  const defenders = of.filter((p) => p.x < 0.38);
  for (const [name, lo, hi] of [['left', 0, 0.28], ['right', 0.72, 1]] as const) {
    const strip = of.filter((p) => p.y >= lo && p.y <= hi);
    const defStrip = defenders.filter((p) => p.y >= lo - 0.05 && p.y <= hi + 0.05);
    if (!strip.length)
      out.push({ severity: 'warn', title: `No width on the ${name}`, detail: `Nobody occupies the ${name} channel, so you can't stretch the opponent and your ${name} side is exposed.` });
    else if (!defStrip.length)
      out.push({
        severity: 'risk',
        title: `Exposed ${name} flank`,
        detail: `No defender covers the ${name} channel. Opposing wide players get free crosses and runs behind. Add a full-back/wing-back or have a wide midfielder track back (higher Press, lower Runs).`,
        playerIds: strip.map((p) => p.id),
      });
  }

  // central midfield
  const centralMid = of.filter((p) => p.x >= 0.33 && p.x <= 0.68 && p.y >= 0.27 && p.y <= 0.73);
  if (!centralMid.length)
    out.push({ severity: 'risk', title: 'Empty centre of midfield', detail: 'Nobody holds the middle. The opponent can play through you, and you will struggle to link defence to attack.' });
  else if (centralMid.length === 1)
    out.push({ severity: 'info', title: 'Lone central midfielder', detail: 'One player covers the centre. Works only if the wide players tuck in (width -) or your press is very high.', playerIds: centralMid.map((p) => p.id) });

  // counter-attack exposure
  const cbs = of.filter((p) => p.role === 'CB');
  const holders = of.filter((p) => p.role === 'DM');
  const highFbs = of.filter((p) => (p.role === 'FB' || p.role === 'WB') && p.inst.runs > 0.65);
  if (highFbs.length >= 2 && cbs.length <= 2 && !holders.length)
    out.push({
      severity: 'risk',
      title: 'Both flank defenders push high with no cover',
      detail: 'Two high-running full/wing-backs, only two centre-backs and no holding midfielder: one lost ball and you are facing a 3v2 counter. Add a DM, drop one full-back\'s Runs, or add a third centre-back.',
      playerIds: [...highFbs, ...cbs].map((p) => p.id),
    });

  // line vs press
  const avgPress = avg(of.map((p) => p.inst.press));
  if (t.lineHeight > 0.65 && avgPress < 0.4)
    out.push({ severity: 'warn', title: 'High line without pressure on the ball', detail: 'A high defensive line only works when the ball carrier is pressured; otherwise a simple long ball behind you beats the whole team. Raise Press or drop the line.' });
  if (t.lineHeight < 0.35 && avgPress > 0.65)
    out.push({ severity: 'warn', title: 'Deep line but aggressive pressing', detail: 'Players sprint out of position while the back line sits deep, which opens large gaps between lines. Pick one: press high with a high line, or sit deep with low Press.' });
  if (t.lineHeight > 0.65 && t.compactness < 0.4)
    out.push({ severity: 'warn', title: 'High line and spread out', detail: 'A high line needs a compact team; with low compactness the space between your lines is huge.' });
  if (t.lineHeight > 0.7 && avgPress > 0.6 && t.compactness > 0.6)
    out.push({ severity: 'good', title: 'Coherent high-press structure', detail: 'High line, aggressive pressing and a compact block all pull in the same direction. Watch fatigue and balls over the top.' });
  if (t.lineHeight < 0.35 && avgPress < 0.4 && t.compactness > 0.6)
    out.push({ severity: 'good', title: 'Coherent low block', detail: 'Deep, compact and patient. You concede territory but little space in behind or centrally. Make sure you have a counter-attacking outlet.' });

  // forwards / attacking plan
  const forwards = of.filter((p) => p.x > 0.7);
  if (!forwards.length)
    out.push({ severity: 'warn', title: 'No forward focal point', detail: 'Nobody starts high up the pitch, so there is no target for direct play and little threat to the back line.' });
  const directCount = of.filter((p) => p.inst.passing === 'direct').length;
  if (directCount >= 4 && forwards.length < 2)
    out.push({ severity: 'warn', title: 'Direct passing with too few forwards', detail: `${directCount} players play direct, but only ${forwards.length} are high up the pitch to receive. Expect lots of lost long balls.` });
  if (of.length && of.every((p) => p.inst.shoot < 0.25))
    out.push({ severity: 'warn', title: 'Nobody wants to shoot', detail: 'Every outfield player has a low Shoot setting. Raise it for your strikers and attacking midfielders.' });
  const roamers = of.filter((p) => p.inst.roam > 0.7);
  if (roamers.length >= 3)
    out.push({ severity: 'warn', title: 'Too many free roamers', detail: `${roamers.length} players have Roam above 70%. Structure collapses when too many leave their position at once. Keep 1-2 free players.`, playerIds: roamers.map((p) => p.id) });

  // man marking sanity
  if (opp) {
    const counts = new Map<string, number>();
    for (const p of team.players) if (p.inst.mark) counts.set(p.inst.mark, (counts.get(p.inst.mark) ?? 0) + 1);
    for (const [id, n] of counts) {
      const target = opp.players.find((p) => p.id === id);
      if (!target) {
        out.push({ severity: 'warn', title: 'Marking a player who is not there', detail: 'A man-marking instruction points to an opponent that no longer exists. Clear it.', playerIds: team.players.filter((p) => p.inst.mark === id).map((p) => p.id) });
      } else if (n > 1)
        out.push({ severity: 'info', title: `Double-marking ${target.name}`, detail: 'Two players are assigned to one opponent, which leaves someone else free.', playerIds: team.players.filter((p) => p.inst.mark === id).map((p) => p.id) });
    }

    // numerical comparison in our frame (their attacking team is mirrored)
    const theirs = outfield(opp).map((p) => ({ x: 1 - p.x, y: 1 - p.y }));
    const centreUs = of.filter((p) => p.x > 0.28 && p.x < 0.72 && channel(p.y) === 1).length;
    const centreThem = theirs.filter((p) => p.x > 0.28 && p.x < 0.72 && channel(p.y) === 1).length;
    if (centreThem - centreUs >= 2)
      out.push({ severity: 'warn', title: 'Outnumbered in central midfield', detail: `${centreUs} of yours vs ${centreThem} of theirs in the middle third's central channel. They can keep the ball and overload you.` });
    for (const c of [0, 2] as const) {
      const ours = of.filter((p) => p.x < 0.45 && channel(p.y) === c).length;
      const them = theirs.filter((p) => p.x < 0.55 && channel(p.y) === c).length;
      if (them - ours >= 2)
        out.push({ severity: 'warn', title: `Overload against your ${SIDE[c]} side`, detail: `Their formation puts ${them} players against your ${ours} in the ${SIDE[c]} channel of your half. Consider a wing-back, a tucking winger or a DM shift to that side.` });
    }
  }

  if (out.filter((f) => f.severity === 'warn' || f.severity === 'risk').length === 0)
    out.push({ severity: 'good', title: 'No structural problems detected', detail: 'Lines are connected, both flanks are covered and the instructions are consistent. Run simulations to test it against an opponent.' });
  return out;
}

/** Feedback derived from batch simulation results, from `side`'s perspective. */
export function simFindings(agg: Aggregate, side: 0 | 1, team: Team): Finding[] {
  const out: Finding[] = [];
  if (!agg.n) return out;
  const o = (1 - side) as 0 | 1;
  const n = agg.n;
  const me = agg.stats[side];
  const them = agg.stats[o];
  const pm = (v: number) => v / n;
  const f1 = (v: number) => v.toFixed(1);

  const xgd = pm(me.xg) - pm(them.xg);
  out.push({
    severity: xgd > 0.4 ? 'good' : xgd < -0.4 ? 'risk' : 'info',
    title: `Over ${n} matches: ${agg.wins[side]}W ${agg.draws}D ${agg.wins[o]}L, ${f1(pm(agg.goals[side]))}-${f1(pm(agg.goals[o]))} goals`,
    detail: `Chance quality (xG) ${pm(me.xg).toFixed(2)} for vs ${pm(them.xg).toFixed(2)} against per match (${xgd >= 0 ? '+' : ''}${xgd.toFixed(2)}). ${
      xgd > 0.4 ? 'You create clearly better chances than you allow.' : xgd < -0.4 ? 'The opponent creates clearly better chances than you. Fix defence before attack.' : 'Evenly matched on chance quality.'
    }`,
  });

  const poss = me.possessionT / (me.possessionT + them.possessionT);
  const acc = me.passes ? me.passesDone / me.passes : 0;
  out.push({
    severity: 'info',
    title: `Possession ${(poss * 100).toFixed(0)}%, pass accuracy ${(acc * 100).toFixed(0)}%`,
    detail: `${f1(pm(me.shots))} shots (${f1(pm(me.onTarget))} on target) per match. Ball won in the opponent half: ${f1(pm(me.highRecoveries))} times; ball lost in your own third: ${f1(pm(me.ownThirdLosses))} times.`,
  });

  // exposed channel: opponent's attacking-left is our right
  const conceded: [number, number, number] = [them.xgByChannel[2], them.xgByChannel[1], them.xgByChannel[0]];
  const concTotal = conceded[0] + conceded[1] + conceded[2];
  if (concTotal > 0 && pm(concTotal) > 0.8) {
    const mx = conceded.indexOf(Math.max(...conceded)) as 0 | 1 | 2;
    const share = conceded[mx] / concTotal;
    if (share > 0.45) {
      const ids = team.players.filter((p) => p.role !== 'GK' && channel(p.y) === mx && p.x < 0.6).map((p) => p.id);
      out.push({
        severity: 'risk',
        title: `${Math.round(share * 100)}% of chances you concede come down your ${SIDE[mx]}`,
        detail: `The opponent keeps finding space on your ${SIDE[mx]} (${pm(conceded[mx]).toFixed(2)} xG per match from that route). Check the players there: reduce their Runs, add cover from the nearest midfielder (higher Press), or shift the team's width/compactness toward that side.`,
        playerIds: ids,
      });
    }
  }

  const attEntries = me.entriesByChannel;
  const entTotal = attEntries[0] + attEntries[1] + attEntries[2];
  if (entTotal > 0) {
    const mx = attEntries.indexOf(Math.max(...attEntries)) as 0 | 1 | 2;
    const share = attEntries[mx] / entTotal;
    if (share > 0.55)
      out.push({ severity: 'info', title: `Your attacks are predictable: ${Math.round(share * 100)}% come through the ${SIDE[mx]}`, detail: 'The opponent can shift its block to that side. Add a second route (width settings, an overlapping runner, a switch of play).' });
    else if (share < 0.45)
      out.push({ severity: 'good', title: 'Balanced attacking routes', detail: 'You enter the final third through several channels, which is hard to defend.' });
  }

  const counterAgainst = pm(them.counterShots);
  if (counterAgainst > Math.max(2, pm(me.counterShots) * 1.6))
    out.push({ severity: 'risk', title: `You are being counter-attacked (${counterAgainst.toFixed(1)} counter shots per match)`, detail: 'Shots within ~10 seconds of the opponent winning the ball. Keep a holding midfielder behind the ball, cut full-back Runs, or use a lower line so the opponent has less space to run into.' });
  else if (pm(me.counterShots) > counterAgainst * 1.6 && pm(me.counterShots) > 2)
    out.push({ severity: 'good', title: 'Your transitions are dangerous', detail: `${pm(me.counterShots).toFixed(1)} counter-attack shots per match, more than the opponent. Fast, direct outlets are working.` });

  if (pm(me.ownThirdLosses) > pm(them.ownThirdLosses) * 1.4 && pm(me.ownThirdLosses) > 10)
    out.push({ severity: 'warn', title: 'Losing the ball in your own third too often', detail: `${pm(me.ownThirdLosses).toFixed(0)} per match vs ${pm(them.ownThirdLosses).toFixed(0)} for the opponent. Set your back line and goalkeeper to Safe passing, give them closer short options, or reduce the opponent's pressing angle by dropping a midfielder deeper.` });
  if (acc < 0.65)
    out.push({ severity: 'warn', title: 'Low pass accuracy', detail: 'Too many risky or long passes into traffic. Switch some players from Direct to Mixed/Safe or slow the tempo.' });
  if (me.shots / n < 7 && pm(me.xg) < 1.0)
    out.push({ severity: 'warn', title: 'Not creating enough', detail: `Only ${f1(pm(me.shots))} shots and ${pm(me.xg).toFixed(2)} xG per match. Raise Runs and Shoot for your forwards, or add a player between the lines.` });
  if (pm(me.shots) > 6 && pm(me.xg) / pm(me.shots) < 0.09)
    out.push({ severity: 'info', title: 'Many low-quality shots', detail: 'Shots are mostly from range. Add runners into the box, or lower Shoot on midfielders.' });

  return out;
}
