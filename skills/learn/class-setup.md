# Setting up a class

A class is long-term: the map you build now is the spine of every future session, so take setup seriously. Resume from whichever step `learn_status` shows (`phase: setup` with no nodes → step 1–3; nodes but `setup` → step 4; `placement` → step 5).

## 1. The goal

Interview with `AskUserQuestion` until the goal is concrete: what course or skill, what they need to be able to do at the end (pass a grad exam? solve medium LeetCode problems in 25 minutes? read papers in the field?), any deadlines, how they like to learn. Then `class_init` with a name, goal, scope and preferences.

Tell them the folder layout once: drop course files (syllabus, lecture notes, slides, problem sets, past exams) into `sources/`; open the folder as (or inside) an Obsidian vault to read `map.md`, `progress.md` and `sessions/`.

## 2. Scope the field

- If there are files in `sources/`, run `sources_scan` and follow [sources.md](sources.md) to read them — a syllabus or table of contents first; it's the best skeleton for the map. Course materials are ground truth for scope, notation and definitions.
- Dispatch the `learn:researcher` subagent to map the subject: core concepts, the genuine first principles, standard teaching order, common misconceptions. Give it the goal and anything you learned from the sources. This keeps the map from being built on half-remembered structure.

## 3. Draft the map

The map is a DAG of **nodes** (one teachable idea each) grouped into **units** (chapters / weeks / topics, in teaching order).

- **Granularity:** a node is one idea you could motivate, establish, connect and check in roughly 5–15 minutes. A semester course is typically 40–150 nodes; a LeetCode track ~15–30 concept nodes plus practice problems. Too coarse ("Eigenvalues") can't be checked meaningfully; too fine ("the 2 in $2\times2$") is noise.
- **Edges** point from prerequisite to dependent. Only add an edge if the dependent genuinely can't be understood without the prereq — over-connecting blocks progress for no reason.
- **Roots** are unconditional truths or real definitions (`foundational: true`). **Stress-test every root**: is it genuinely something this learner can accept at face value, or a disguised theorem that derives from something simpler? If it derives, push it down and extend the map. A wrong root corrupts everything hung off it.
- **Practice nodes** (`kind: practice`) are problems that exercise concepts — e.g. one per LeetCode problem, with the URL in `links` and the pattern concepts as prereqs. They're mastered by solving, not by multiple choice.
- **Cite sources**: `sources: [{file, page}]` on nodes drawn from course material.
- **Ids** are permanent kebab-case (`eigen-decomposition`); titles are short.

Preview with `graph_apply({..., dry_run: true})`. Build big maps in several calls (one per unit is fine), all with `phase: "setup"` until approved.

## 4. Present and get approval

Show the learner, in chat:

1. **The approach, in prose** — what the course covers, in what order, and why this way given their goal.
2. **The map** — paste the single diagram `graph_apply`'s dry-run `preview` returns (the unit overview, or the whole map if it's small). Don't hand-draw the full graph — `map.md` has the per-unit detail.

Then **stop and wait for their go-ahead.** A wrong root or scope is cheap to fix now and expensive mid-course. Apply any changes they ask for.

## 5. Placement

Once approved, `graph_apply({phase: "placement"})` and find what they already know, following [probing.md](probing.md):

- Loop: `next` returns `probe` candidates chosen to split the unknown region → probe one or two with `quiz_ask` (`purpose: "probe"`, `node`, usually `check: "transfer"`) → repeat.
- Characterise misses (slip / gap / misconception) with follow-up probes before moving on.
- Keep it proportionate: for a subject that's entirely new, a handful of probes confirming the roots are untouched is enough. The learner can also ask to stop early — unprobed nodes simply get taught normally, and the teaching loop's checks catch anything they already know.

When `next` says placement is complete (or you've bracketed every strand), `graph_apply({phase: "active"})`.

## 6. Hand off

Summarise what placement found, point them at `map.md` / `progress.md`, say what the first lesson will be (from `next`), and ask whether to start now. If yes, continue with [session.md](session.md).
