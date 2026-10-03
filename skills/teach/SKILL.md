---
name: teach
description: The teaching method for learn sessions — how to explain anything so it is understood, not memorized. Use whenever you are teaching inside a /learn class or workshop, or when the user explicitly asks to be taught or to understand a topic. Not for routine explanations while coding.
user-invocable: false
---

# Teaching

Two principles. They are not tips — they are how you teach, every time. Apply them to any explanation, from a one-liner to a deep dive.

The goal is never "they can recite the fact." The goal is **understanding**: the fact is derivable from foundations the learner already accepts, connected into their mental model, and therefore self-preserving. Memorized facts rot. Understood facts don't.

If no learn session is running (no class in this folder and no workshop started), start one first via the `learn` skill — quizzes and progress need it.

## The philosophy (why this works — internalize it)

Two brains can hold the same propositions and look identical from the outside (same answers to the same questions). But one holds a pile of **disconnected lone facts** (A). The other holds a few **core truths** from which all those facts are derivable (B), so to it the facts are obviously connected. That connection *is* understanding.

- Connected knowledge > disconnected knowledge
- A graph of dependencies > disjoint lonely nodes
- Understanding > memorizing

Understanding preserves knowledge (it's held in place by its connections), compresses it, and is just plain better. Every teaching move below exists to build that dependency graph in the learner's head: **nodes** (Principle i) and **edges** (Principle ii). The class map (`graph.json`, rendered in `map.md`) is the external mirror of that graph — keep them in sync.

The felt goal is **the click**: the moment a pile of lonely facts collapses (compresses) into a few generating ideas — same information, far fewer moving parts. When teaching lands, that collapse is what it feels like from the inside; aim for it.

A key mechanism: **the brain won't fully commit to a fact it isn't sure is safe to lock in.** If something more fundamental might later contradict it, committing is risky — it'd force an expensive update. So the brain hedges, and the fact never really lands. Both principles below remove that risk in different ways.

## Principle i — Unconditional truths first

Start from the ground. Lock in the core, **always-true** unconditional truths before anything built on top of them.

Why start here? **Not** because bottom-up is the logically "correct" order — because unconditional truths are simply the *easiest* thing for the brain to accept and lock in. They're safe, so they commit instantly, and they give the first solid ground to stand on and build from. Especially valuable when the subject is entirely new and there's little to connect to yet.

**Terminology — keep these distinct, and don't overuse "axiom."** An *unconditional truth* is a fact the learner can accept **as-is, at face value, with no caveats or nuance** — that's a property of *how the fact is held*. An *axiom* is a fact that **follows from nothing else** — a property of *where it sits in the graph* (a root node with no incoming edges). They overlap but are not synonyms: an axiom that's also caveat-free is one kind of unconditional truth, but plenty of unconditional truths *do* derive from deeper things — they simply don't need that derivation to be safely accepted. Default to saying **"unconditional truth"**; reserve **"axiom"** for facts that genuinely bottom out.

- Find the few hard facts they can take at face value — often first principles that don't depend on anything else, though they needn't be true roots. There may be very few. That's fine; small and solid beats large and shaky.
- They must be simple enough to be accepted **as-is, without nuance or caveats**. No "well, usually…". If it needs conditions, it's not an unconditional truth yet — dig down further.
- These can be committed to *instantly and safely*, because nothing more fundamental will come along to contradict them. That safety is what makes them lock in.
- Build everything else up from these, explicitly, so the learner can see each new fact resting on the foundation.

**Confirm the foundation before building on it.** Check that each core truth actually reads as obviously, unconditionally true to them before you add structure on top. If it doesn't feel rock-solid, stop and fix the foundation — don't build on sand.

**Two especially strong forms of unconditional truth to reach for:**
- **Universal statements** — *"all X are Y"* or *"no X is Y"*. Easy for the brain to lock in because they admit no exceptions to hedge against. A clean atomic-unit version (*"ALL X is done through {____}"*, e.g. *"ALL communication between computers is done through {sending packets}"*) is one particularly strong special case — surface it when a domain has one.
- **Real definitions** — a genuine definition is a great place to start, but only if it's an *actual* definition, not a vague list of properties dressed up as one.

Don't force either where there isn't a clean one.

## Principle ii — "How could I have discovered this?"

Facts feel arbitrary when there's no visible reason they *had* to be this way. The brain won't commit to arbitrary-feeling info. The fix: make it feel discovered, not decreed.

Walk the learner through how they **could have discovered the thing themselves**. Every step must be *motivated*:

- Start from square one: **why are we even doing this?** What core problem sends us down this path?
- Motivate every intermediate step too: why try *this* formula? why manipulate the equation *this* way? What could have led someone to this approach in the first place?
- The output is turning **disconnected propositions → connected propositions** — adding the edges to the graph.

3Blue1Brown (Grant Sanderson) is the master reference: nothing appears from nowhere; every move feels like something the learner might have reached for themselves.

### Socratic vs expository — adaptive

Choose per topic and per the learner's apparent energy (and what `CLASS.md` says about how they learn):
- **Socratic** — pose the motivating problem and let them attempt the discovery before you reveal. More effortful, stronger locking-in. Default to this when they can plausibly reason their way there. If the question has a definite right answer, it's gradable — use `quiz_ask` (or a chat-mode `exercise_assign` for open-ended work), never `AskUserQuestion`.
- **Expository** — you narrate the motivated discovery path yourself, no back-and-forth. Use when the topic is beyond cold-reasoning reach, or they're low-energy / want it delivered.

Reserve `AskUserQuestion` for genuine no-right-answer forks: preferences, direction, what they want next.

## Accuracy is non-negotiable

The learner has to be able to trust the teacher completely; one confidently-delivered hallucination poisons that, and a wrong unconditional truth corrupts every node built on it. **The moment you are even slightly unsure of any fact, name, date, formula, definition, or claim, stop and verify before you say it**: check the class's own sources first (they define the notation and conventions this course uses), otherwise dispatch the `learn:researcher` subagent with a precise question. Pausing to verify is always acceptable — accuracy beats flow. If a check corrects what you were about to teach, say so plainly. If the course materials disagree with standard usage, name the difference explicitly rather than silently picking one.

## Assessment — every check is evidence

Every graded interaction is recorded on a node and drives mastery and the review schedule. So:

- **Always pass `node`** when a question tests a map node.
- **Pick the right `check` kind** — mastery ("solid") needs clean passes of **two different kinds**, plus surviving a **re-check on a later day**, plus **at least one exercise** (they produced the answer rather than picked it), plus a **derive** pass on nodes that require one:
  - `recall` — state, recognise, or pick out the idea.
  - `transfer` — apply it in a setting they haven't seen it in.
  - `worked` — carry out a multi-step problem (usually an exercise).
  - `derive` — rebuild the node from **all** of its prerequisites: *"Starting from A and B, show why C must hold."* This is the check that tests the edges, which is what understanding is. See below.
- **Use `quiz_ask`** for multiple choice (at most 4 options), writing math in LaTeX as everywhere else. It returns an `ask` payload: pass it to `AskUserQuestion` **verbatim** — don't reword it; the server has already converted the math to Unicode for the terminal — then call `quiz_answer` with the label they picked. (If `AskUserQuestion` is unavailable, show the same lettered options in chat.)
- **Confidence on probes and reviews.** For `purpose: probe` and `review`, the `ask` payload carries a second question, *How sure were you?* Pass both to `AskUserQuestion` and send the second answer to `quiz_answer` as `confidence`. Right + unsure is **tentative**: it doesn't count toward mastery or credit anything underneath, and the review comes back sooner — treat it as not-yet-known. Wrong + sure is recorded as a misconception even if the distractor wasn't tagged: dig for the wrong model. Checks right after teaching don't ask.
- **Every node needs one generative pass.** Multiple choice is recognition; mastery also needs the learner to produce the answer once. For a derived node the derive check covers it. For a foundation, assign a short `chat` exercise: state it precisely in their own words, or give the definition. Practice nodes get it by solving.
- **"I don't know" beats a guess.** Early on, tell the learner once that they can choose *Other* and say they don't know; pass `selected: []`. A guess that happens to be right pollutes the map, especially during probes.
- **Use `exercise_assign`** for anything that should be worked out rather than picked from a list:
  - `mode: chat` — a short free-response answer typed in chat.
  - `mode: paper` — derivations, proofs, hand computation. They can paste a photo or drop it into `submissions/`; `Read` the image and grade the *work*, step by step, not just the final answer.
  - `mode: external` — e.g. a LeetCode problem (put the URL in `link`). Grade the code they bring back for correctness, complexity, and edge cases.
  Grade with `exercise_list({id})` (it returns your stored solution and rubric, even in a later session), then `exercise_submit` with `result`, `hints` (be honest — 2+ means substantial help and won't count toward mastery), any `misconception` the work revealed, and specific `feedback` (which step went wrong and why).
- **Derive checks** are always free response: `exercise_assign` with `check: "derive"`, `mode: chat` or `paper`, `covers` = every prerequisite of the node, and a rubric that says how each prerequisite is used. Write the solution and rubric *before* they answer. Grade with `exercise_submit` and `links` — for every prerequisite, did their derivation actually use that link correctly? A result can't be `correct` while a link failed. A broken link is named in the next remediation, so be precise about which one broke. Give the derive check when the node has had time to settle (typically its second check, or a later review), not as the very first question after teaching.
- **After a miss, characterise it before moving on** — a careless slip, a narrow gap, or a misconception? Misconceptions matter most: a confidently-held wrong model has to be dislodged, not topped up. Tag distractors with the `misconception` they represent, so a wrong pick is diagnostic and gets recorded.

### Writing quiz options — a construction procedure (every `quiz_ask`)

Evenness can't be audited in afterwards; build it in:

1. **Every option is a bare claim — no justification anywhere.** The number-one giveaway is the correct option carrying its own reasoning ("…, because it preserves X") while the distractors are bare. All reasoning goes in `explanation`, which only appears after they answer.
2. **Write the correct claim first, then mutate it into each distractor.** Take one specific misconception or easily-confused neighbour and state what someone holding it would claim — in the *same* skeleton, grain size, and register as the correct claim. Parallelism falls out by construction.
3. Each distractor must be a real error they might actually make (so the pick is diagnostic), yet unambiguously wrong on the intended reading — tempting, not tricky.
4. **No asymmetric bolding.** Bold nothing, or bold the parallel term in every option.
5. **Vary the position of the correct answer.**

If, reading the finished set cold, you can still tell which is right without knowing the material, regenerate — don't patch.

## The teaching loop — one node at a time

**The lesson is the text of your reply.** Write each step out for the learner, in full, before calling `node_taught` or `quiz_ask`. A lesson that only happened in your reasoning didn't happen — the learner (and the session note) only sees what you write.

Every node — a foundational unconditional truth or a derived step — gets the same treatment:

1. **Motivate.** Why do we need this node right now — what problem does it solve, what gap does it close? This applies to unconditional truths too: not just "it's true" but why *this* truth, *now*.
2. **Establish.**
   - Foundational: state it plainly, at face value, no caveats. Surface an atomic unit if one fits.
   - Derived: build it from what's already established via a motivated move (Socratic or expository), answering "how could I have discovered this?"
3. **Connect.** Make the dependency edge explicit — show exactly how this node hangs off the ones already in place.
4. **Mark it taught** with `node_taught`.
5. **Check.** Confirm it landed with a `quiz_ask` (`purpose: check`). If they miss, that node isn't solid: stop and fix it before building anything on top of it. Where it fits, follow with a second check of a different kind (a `transfer` question, or an exercise) — that's what moves a node toward solid.

Don't front-load all the foundations and stop checking. If you catch yourself asserting a fact they'd have to take on faith, stop: motivate it and confirm it lands, or ground it in something already established. If teaching reveals a missing prerequisite, add it to the map (`graph_apply`) and teach it first — tell the learner you've done so.

## Visuals

When an idea is genuinely clearer as a picture — a structure, a flow, a geometry — use the `visualize` skill. When in doubt, don't: a missing visual is cheaper than a false one.

## Formatting — the lesson is read in Obsidian

Everything you write is mirrored into the session note and read rendered in Obsidian. So:

- Math in LaTeX, always: inline `$f(x)$`, display math in `$$` fenced on their own lines. Write $f(x) = x^2$, not `f(x) = x^2`. This includes quiz questions, options, and explanations.
- Diagrams as ```mermaid blocks (Obsidian renders them) or embedded PNGs from `visualize`. Obsidian draws mermaid at natural size in a narrow note, so keep every diagram **small**: at most ~10 nodes, short labels, no `subgraph` blocks (they blow up the layout), `graph TD` unless it's much wider than deep (then `LR`). Need more? Split it into several diagrams, or use a list.
- Headings for major stretches of a lesson help the note read like notes later.
