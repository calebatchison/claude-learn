# Breadth mode: covering a lot of ground

Status: implemented on top of [mastery v2](mastery-v2.md).

## Why

Mastery v2 is built for deep understanding: two kinds of check, a delayed re-check, a free-response pass, a derive pass, and spaced reviews forever. That is right for material everything else rests on, and far too much for goals like "get exposure to 40 LeetCode patterns" or "survey a field". Breadth mode relaxes what counts as *known* for those nodes, while still catching what's actually wrong.

Evidence is stored the same way in both modes and status is always recomputed from it, so a node can switch modes at any time without losing anything.

## Depth is per node, chosen at setup

- **Class style** (`style` on the graph): `depth`, `breadth` or `mix`. At setup Claude reads the learner's goal and proposes one; the learner approves it with the map. No style means `depth`.
- **Each node resolves to `deep` or `breadth`:**
  - `depth` class: every node is deep.
  - `breadth` class: every node is breadth.
  - `mix` class: deep for foundational nodes and for nodes that two or more other nodes build on directly; breadth for the outer topics.
- **Overrides:** Claude (or the learner) can set a node's depth with a mandatory reason (`depth` + `depth_reason` on the node). Every override is kept in the node's history, like derive rules.
- **Deep pulls its base deep.** Every ancestor of a deep node is deep too, all the way down: going deep on a shallow base is fragile. The map shows these as "deep because X builds on it".
- **Switching a node to breadth** is refused while a deep node builds on it.
- **Promoting a node to deep** is one override. Its evidence stays and is simply judged against the deep bar.

## The breadth bar

| | Deep (unchanged) | Breadth |
|---|---|---|
| Done | solid: 2 kinds, delayed re-check, generative pass, derive if required | **covered**: the last direct check was a clean pass (at most one hint) |
| Right + unsure | tentative: no credit, review at half the interval | **counts as a pass**, flagged, with **one follow-up check** in 3 days |
| Reviews | spaced (SM-2-like), forever | **only after a miss** (or an unsure pass): one follow-up check, then none |
| Misses, misconceptions | remediated first | remediated first (unchanged) |
| Placement | a sure correct probe credits ancestors as assumed; they get a verification review | same credit, but breadth ancestors get **no** verification review: assumed counts as covered |
| Implicit review credit | pushes back prereq reviews | breadth prereqs are skipped (their only reviews are follow-ups, which exist to catch luck) |

Internally a covered breadth node has status `solid`, so planning, goals and "done" work unchanged; the map and progress note label it **covered ☑️** instead.

## Variety: problem count per node

Breadth is about seeing many problems, so the engine tracks, per node, how many exercises were attempted and at which difficulty (`difficulty: easy | medium | hard` on an exercise, copied onto its evidence).

- In a class with breadth nodes, after remediation, reviews and new material, the planner suggests **practice** on covered breadth nodes, fewest problems first, naming a difficulty not yet tried ("2 problems so far (easy) — try a medium one").
- New material still comes first: untouched nodes beat more practice on covered ones.
- Mixed practice sets (problems from several nodes without naming the technique) are left for a follow-up.

## Migration

None needed. Graphs without `style` behave exactly as before.
