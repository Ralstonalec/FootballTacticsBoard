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
  - *Ask AI* – with an OpenRouter key (server-side on Vercel, or ⚙ for local dev) the model critiques free-form
    ideas using your exact setup and the latest simulation results.

## Shape Lab (animated formation diagram)

Top bar → **🎞 Shape Lab**. Both teams' formations react to the ball using the same decision logic as the match simulator:

- **Move the ball yourself**: click or drag on the pitch and watch both blocks shift, compress, press and recover.
- **Playbooks**: build-up and switch, lose it and counter, opponent builds against your press, long ball, wing overload.
- **AI writes the sequence**: describe what to test ("away win it in midfield and break down our right") and the AI
  choreographs the ball movement; **Explain what happened** has the AI narrate how the shape responded.
- **Diagram**: lines through each rank, a hull around each block, ball trail, and a live *decision label* per player
  (Pressing the ball, Covering the press, Man-marking #9, Protecting the box, Recovering shape, Overlapping…).
  Live metrics give block depth/width, gaps between lines and back-line height. Coach instructions still apply instantly.

## Player roles & individual instructions

Click any player → **Player** tab → **Role & instructions**:

- **Describe the player in your own words** (as much detail as you like) and press **✨ Analyse & apply**. The AI reads it, sets how
  the player plays, shows which words became which settings, and lists any detail the simulator can't model (e.g. "weak left foot").
  If the AI isn't set up or the call fails, it falls back to a built-in interpreter for common football phrases (negations,
  left/right, half-spaces, "mark their number 9") and tells you so. **Offline only** skips the AI.
- **Role templates:** or start from a known role (ball-playing centre-back, sweeper, anchor man, deep-lying playmaker, box-to-box,
  half-space runner, number 10, traditional winger, inside forward, target man, poacher, false 9, pressing forward, overlapping /
  inverted full-back, attacking wing-back…).
- **What the simulator actually does with it:** besides roam / press / runs / dribble / shoot / width / passing / marking, players now
  have **depth** (drop deep to link play ↔ stay on the last line), **channel** (occupy the left wing, half-space, centre…),
  **track back** and **crossing**. All are in *Fine-tune every setting* and can be changed mid-match.
- Defaults reproduce the previous behaviour exactly; only players you instruct behave differently.
- Tests: `npx tsx scripts/roletest.ts` (phrase understanding, AI-reply validation, and that each behaviour measurably changes play).

## AI decision model

During a live match, switch on **🧠 AI decision model** for Home and/or Away. The engine still plays every moment; every
N seconds of match time (and on turnovers and goals) the decision model reads the situation and issues short-lived
per-player *orders*: press, counter-press, cover, drop, overlap, stay wide, cut inside, run in behind, support short,
go direct, take on, shoot, recycle, free role, man-mark. Orders expire on their own, show with a ★ in the labels, and
are logged with the model's reason. The match can pause while the model thinks. A call cap limits cost, and it switches
itself off after three consecutive errors.

Two models, both through OpenRouter:

| Env var | Used for | Suggestion |
|---|---|---|
| `OPENROUTER_TEXT_MODEL` | coach commands, feedback, shape-lab scenarios and explanations | a strong model |
| `OPENROUTER_DECISION_MODEL` | in-match player decisions (called often) | a fast, cheap model that reliably returns JSON |

(`OPENROUTER_MODEL` still works as the text-model fallback. Model ids must exist on OpenRouter; the defaults are
`anthropic/claude-sonnet-4.5` and `anthropic/claude-haiku-4.5`, so confirm or change them.) Batch tests do not call the AI.

Test with the real API: `OPENROUTER_API_KEY=sk-or-... npm run livetest` calls both models and checks the replies parse.

## AI won't connect? Troubleshooting

Open **Insights → ⚙ → 🔌 Test AI connection**. The server checks each link and tells you which one fails:
key present → key well-formed → OpenRouter accepts it → models exist → each model answers.

Most common causes:
- `OPENROUTER_API_KEY` is not set for the environment you are visiting (**Production vs Preview**), or you added it but did **not redeploy**; Vercel applies variables only to new deployments.
- The key was pasted with quotes, spaces or a trailing newline, or it is not an `sk-or-…` OpenRouter key.
- The model ids are wrong: use the exact ids from openrouter.ai/models in `OPENROUTER_TEXT_MODEL` / `OPENROUTER_DECISION_MODEL`.
- No credits or the key's spend limit is used up (HTTP 402), or the model is blocked by your OpenRouter privacy/data-policy settings (HTTP 404).
- Running plain `npm run dev`: there is no `/api` there. Use `npx vercel dev`, or paste a key into the local-dev field.
- Check the Vercel deployment's Functions/Runtime logs for `api/claude` for the raw upstream error.

## Live coaching

Select any player at any moment, including mid-match, and change what they do:

- **Quick-coach buttons** (Push up, Press hard, Hold position, Go wide, Cut inside, Mark nearest, …) and every slider
  apply to the running simulation instantly. Team tactics too. Pause, adjust, resume.
- **Coach the team in words**: type "left back overlap, both strikers press, number 10 stays central" and the assistant
  manager AI turns it into per-player changes (it sees the live clock, score, stats and positions). Every change is
  listed in the coach log and the match feed. Replies are validated and clamped before they reach the simulator.
- Coaching also updates the board, so what you learn mid-match carries into the next run.

## Deploying to Vercel (AI with a server-side key)

The AI calls go through `api/claude.ts`, a Vercel serverless function, so your OpenRouter key never reaches the browser.

1. Push this repo to GitHub and import it in Vercel (framework preset: Vite; defaults are fine).
2. Project → Settings → Environment Variables:
   - `OPENROUTER_API_KEY` = your key (Production + Preview)
   - `OPENROUTER_MODEL` = optional OpenRouter model id, defaults to `anthropic/claude-sonnet-4.5`
3. Redeploy. The ⚙ panel shows "Server-side AI is configured" and the coach/Ask AI buttons enable.

The function only accepts two fixed modes (`feedback`, `coach`) with server-owned system prompts, caps request size and
output tokens, and has a best-effort per-instance rate limit. It does **not** authenticate users, so anyone who finds the
URL can spend your credits. Before sharing it publicly add Vercel Firewall rate limiting or password protection.

Local dev: `npm run dev` has no `/api`; either use `npx vercel dev` (reads `.env.local`) or paste a key into ⚙ (browser-only, dev use).
Tests: `npx tsx scripts/apitest.ts` (function + reply sanitising), `npx tsx scripts/livecoach.ts` (mid-match changes affect the sim).

## Layout

```
src/engine/types.ts       data model (players, instructions, team tactics)
src/engine/formations.ts  presets
src/engine/sim.ts         the match simulator (agent movement, passing, pressing, shots, xG)
src/engine/batch.ts       multi-match runner and aggregation
src/engine/analysis.ts    structural + simulation-based feedback rules
src/engine/ideas.ts       offline interpreter for typed ideas
src/engine/ai.ts          AI client: feedback + live-coach commands (validated/clamped)
api/claude.ts             Vercel serverless proxy holding the API key
api/_prompts.ts           system prompts (server-owned)
src/components/           Pitch canvas and the side panels
scripts/simtest.ts        headless calibration harness
```

## Simulation notes / limitations

This is a stylised simulation, tuned to produce plausible totals (~2.5–3.5 goals and ~12 shots per team per match), not a
physics engine. No set pieces, fouls, cards, substitutions or ball height; the ball cannot leave the pitch. Use it to compare
setups against each other (relative effects), not to predict real matches. All tuning constants are at the top of `sim.ts`.
