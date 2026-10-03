# Mastery v2: testing connections, confidence, graph-aware reviews

Status: implemented in three commits (derive checks, confidence and generative recall, graph-aware reviews).

## Why

The teaching method says understanding lives in the **edges** of the knowledge graph: a fact is understood when it can be derived from foundations the learner already holds. The v1 engine recorded evidence only on nodes, mostly through multiple choice, and scheduled every node's reviews in isolation. Three consequences:

1. Nothing tested whether the learner could rebuild an idea from its prerequisites, so memorised and understood knowledge looked the same.
2. "Solid" could be reached on recognition alone, and a single lucky guess on a placement probe could mark a whole subtree as known.
3. Passing a hard idea, which necessarily exercises the ideas under it, gave those ideas no credit, so the review load grew with the size of the map.

## 1. Derive checks

- New check kind **`derive`**: "starting from A and B, show why C must hold". Always free response (an exercise in `chat` or `paper` mode), graded by Claude against a solution and rubric stored before the learner answers. Multiple choice can't be a derive check.
- **One check covers every link.** A derive exercise must list all of the node's prerequisites (`links`); the server rejects one that doesn't. Grading records, per prerequisite, whether that link held: `links: [{from: "a", ok: true}, {from: "b", ok: false}]`. A derive result can't be `correct` while a link failed.
- **Whether a node requires one is decided at map time, not at grading time**, so the grader can't quietly lower the bar for a node the learner is struggling with.
  - Default: required for concept nodes with prerequisites that aren't foundational; not required for foundational and practice nodes.
  - Claude can override per node (`requires_derive` + a mandatory `derive_reason`). Every override is kept in the node's history, and it shows up in the map the learner approves.
- A derive pass also counts as one of the two kinds of check the mastery bar asks for.
- A derive pass only satisfies the requirement if it covered the node's **current** prerequisites. Adding a prerequisite later re-opens the requirement.

## 2. Confidence and generative recall

- **Confidence** (Sure / Unsure) is asked after answering **placement probes and cold reviews** only; checks right after teaching skip it to keep the flow.

| | Right | Wrong |
|---|---|---|
| **Sure** | Clean pass | Misconception, even if the distractor wasn't tagged; remediated first |
| **Unsure** | **Tentative** | Ordinary miss |

- **Tentative** = a weak pass, not a failure: the node keeps its status, the result doesn't count toward mastery (and doesn't break a run), the interval holds and the next review comes at half of it. A tentative probe gives no "assumed" credit to the ideas underneath.
- **At least one generative pass for solid.** Every node needs one clean pass where the learner produced the answer: an exercise of any kind (a derive pass counts; practice nodes satisfy it by solving). Foundational nodes typically get a "state it precisely in your own words" exercise.

The new solid bar, counted over the clean passes since the last miss:

1. two different kinds of check,
2. a pass at least ~a day after the first,
3. at least one generative (exercise) pass,
4. a derive pass covering every current prerequisite, if the node requires one.

## 3. Graph-aware reviews

- **Implicit credit.** A clean, **cold** pass on a node pushes back the next review of the ideas under it. Cold = a review, or any non-probe pass on a later calendar day than the node was last taught (the check right after teaching doesn't count: the prerequisites were just recalled during the lesson).
- It moves due dates only; it never adds evidence, so a prerequisite still needs direct checks to become solid.
- Amount: 50% of the prerequisite's current interval for direct prerequisites, 25% two levels down, 12.5% three levels down, then nothing. With several routes, the shortest wins. A push never moves a review later than a fresh full interval from now would.
- Skipped: assumed nodes (they still need their first direct check), nodes needing remediation, nodes that aren't satisfied.
- **On a miss** nothing is enforced. The remediation item lists the node's prerequisites so Claude can decide whether to check one first.
- **On a derive miss** the remediation item names the broken link(s) ("couldn't get from A to C"), so the re-teach targets that connection.

## Migration

None: there is no existing class data. Status is always recomputed from evidence, so old graphs would simply show the stricter bar.
