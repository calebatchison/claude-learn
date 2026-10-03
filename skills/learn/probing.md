# Probing — finding the edge of what they know

You can't teach into someone's zone of proximal development without knowing where its edges are. Probing is a **mapping job, not a spot-check**: locate the frontier where what they reliably know turns into what they don't, along every strand the teaching will depend on. It gets as long as it needs to. There is no rush.

Use `quiz_ask` with `purpose: "probe"` and the `node` being probed. Pass on their *Sure / Unsure* answer as `confidence`. A correct, sure probe automatically credits the node's unchecked prerequisites as *assumed* (you can't do the hard thing without the easy things under it); they get a light verification review later. A correct but unsure probe credits nothing — treat it as an edge, not a floor.

## The edge is only located when it's bracketed

For each relevant strand you need **both**: something they get **right** (a floor) and something they get **wrong** or genuinely don't know (a ceiling). The edge sits between them. One side alone tells you almost nothing.

- **All-correct is not "done" — the questions were too easy.** A run of right answers is a floor with no ceiling. Escalate until something breaks.
- **Binary-search.** When they nail one, jump the difficulty up *sharply*. When they miss, narrow back in. In a class, `next` during placement proposes the nodes that split the unknown region best — use them.
- **One wrong answer is not "done" either, and it is not a cue to start teaching.** A single miss is one coordinate, and you don't know its kind: a careless slip, a narrow gap, or a systematic misconception. Probe *around* it. When you catch a misconception, dig into its extent; tag it via the distractor's `misconception` field so it's recorded.
- **Map every strand the goal rests on**, bounded by relevance: probe every corner the teaching will depend on, and none it won't.
- **Prefer `transfer` probes** for anything they claim to know — recognition is cheap; application is the real test.

Stop when, for each goal-relevant strand, you can state concretely what they have and where it ends. Tell them what you found, briefly and honestly — it's useful to them too.

## Their goal is a separate unknown

What they *want* is not gradable — ask it with `AskUserQuestion`, never `quiz_ask`. With a subject they don't know yet, the goal is often hard to articulate: "understand LLMs" can mean ten different things, and which one completely changes what you teach. Interrogate the vision until it's concrete.
