# Football Tactics Board

An interactive tactics board with a live match simulator and a tactical feedback engine.
Everything runs in the browser; there is no backend.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
npm run simtest -- 30 4-3-3 4-4-2 42   # headless calibration: matches, home formation, away formation, seed
```

## What you can do

- **Fully custom formations**: drag any player anywhere, add/remove players (1–11 per side), change roles, mirror,
  load presets (4-4-2, 4-3-3, 4-2-3-1, 4-1-4-1, 3-5-2, 3-4-3, 5-3-2), save/load named setups, import/export JSON.
  Both teams are editable (Edit Home / Edit Away). The board auto-saves to localStorage.
- **Per-player instructions** (click a player): roam, press, forward runs, dribble, shoot, width (inverted ↔ touchline),
  passing style (safe/mixed/direct) and man-marking of a specific opponent. "Copy to all <role>s" applies it across a role.
- **Team instructions**: defensive line height, compactness, tempo, width.
- **Live simulation**: 22 agents play a 90-minute match (1×–120× speed) with passing lanes, interceptions, duels, pressing,
  offside, shots with an xG model, goalkeepers, stamina. Heat maps show where each team's possession happens.
- **Batch testing**: run 10–100 full matches in seconds and get statistics (W/D/L, xG, shots, transitions, which channel you concede from…).
- **Feedback**:
  - *Structure & instructions* – instant rules-based critique (gaps between lines, exposed flanks, empty midfield, conflicting
    press/line settings, unprotected full-backs, stacking, marking mistakes, numerical overloads vs. the opponent).
  - *From simulation* – findings derived from the batch results (exposed channel, counter-attack vulnerability, predictable attacks, build-up losses…).
    Click a finding to highlight the players involved.
  - *Your idea* – type an idea ("high press with a back three and a false 9") and the offline interpreter explains the pros/risks
    and can apply it to the board.
  - *Ask Claude* – with an Anthropic API key (⚙ in the feedback panel, stored only in your browser) Claude critiques free-form
    ideas using your exact setup and the latest simulation results.

## Layout

```
src/engine/types.ts       data model (players, instructions, team tactics)
src/engine/formations.ts  presets
src/engine/sim.ts         the match simulator (agent movement, passing, pressing, shots, xG)
src/engine/batch.ts       multi-match runner and aggregation
src/engine/analysis.ts    structural + simulation-based feedback rules
src/engine/ideas.ts       offline interpreter for typed ideas
src/engine/ai.ts          Claude API client (browser, user-supplied key)
src/components/           Pitch canvas and the side panels
scripts/simtest.ts        headless calibration harness
```

## Simulation notes / limitations

This is a stylised simulation, tuned to produce plausible totals (~2.5–3.5 goals and ~12 shots per team per match), not a
physics engine. No set pieces, fouls, cards, substitutions or ball height; the ball cannot leave the pitch. Use it to compare
setups against each other (relative effects), not to predict real matches. All tuning constants are at the top of `sim.ts`.
