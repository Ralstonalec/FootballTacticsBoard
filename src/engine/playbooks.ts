import type { Scenario } from './ai';

const s = (x: number, y: number, poss: 0 | 1, seconds: number, caption: string) => ({ x, y, poss, seconds, caption });

/** Offline ball sequences (home attacks toward x=105). */
export const PLAYBOOKS: Scenario[] = [
  {
    title: 'Build-up down the left, then switch',
    steps: [
      s(10, 34, 0, 0, 'Goalkeeper has the ball'),
      s(24, 12, 0, 2.5, 'Short pass to the left side'),
      s(44, 9, 0, 3, 'Progress down the left'),
      s(52, 34, 0, 2.5, 'Recycle through the middle'),
      s(64, 58, 0, 2.8, 'Switch of play to the right'),
      s(88, 52, 0, 3, 'Attack the final third'),
    ],
  },
  {
    title: 'Lose the ball, then counter-attack',
    steps: [
      s(72, 34, 0, 0, 'Home attack in the opponent half'),
      s(84, 42, 0, 2.5, 'Attack stalls near the box'),
      s(80, 40, 1, 1.2, 'Away wins the ball'),
      s(56, 30, 1, 3.2, 'Away counter-attack begins'),
      s(34, 36, 1, 3.2, 'Running at the home back line'),
      s(14, 32, 1, 3, 'Chance created'),
    ],
  },
  {
    title: 'Opponent builds against our press',
    steps: [
      s(96, 34, 1, 0, 'Away goalkeeper has the ball'),
      s(82, 14, 1, 2.5, 'Pass to the full-back'),
      s(70, 10, 1, 3, 'Away try to play out wide'),
      s(62, 34, 1, 3, 'Move inside to the midfield'),
      s(48, 52, 1, 3, 'Switch across the pitch'),
    ],
  },
  {
    title: 'Long ball over the top',
    steps: [
      s(22, 34, 0, 0, 'Centre-back on the ball'),
      s(30, 40, 0, 2, 'Brief hold, looking for options'),
      s(78, 24, 0, 2.4, 'Long ball behind the defence'),
      s(94, 30, 0, 2, 'Striker chases it down'),
    ],
  },
  {
    title: 'Wing overload and cross',
    steps: [
      s(50, 14, 0, 0, 'Ball in the left half-space'),
      s(70, 6, 0, 2.5, 'Winger beats his man'),
      s(88, 6, 0, 2.5, 'Overlap down the touchline'),
      s(94, 20, 0, 1.8, 'Cross into the box'),
      s(100, 34, 0, 1.2, 'Delivery attacked in the middle'),
    ],
  },
];
