# A workshop

One sitting, one Obsidian note, no long-term plan. "I want an overview of how integration works." Same teaching method, lighter machinery.

1. `session_start({workshop_topic})` — creates `workshops/<date>-<topic>.md` in the current folder and starts mirroring the lesson into it. (If they want it somewhere else, e.g. inside their vault, call `learn_status({root})` with that folder first.)
2. **Goal** — one or two `AskUserQuestion`s: what do they want to walk away with? Overview vs. working skill, how deep, why.
3. **Probe** — lightly, following [probing.md](probing.md): a few `quiz_ask` probes to bracket the edge on the strands the goal rests on. Proportionate — minutes, not a placement exam.
4. **Plan** — a small map, 3–10 nodes: `graph_apply({phase: "active", nodes: [...]})` with roots marked `foundational`. Present the approach in a few sentences and the map as a ```mermaid diagram in chat (it lands in the note). Wait for a go-ahead.
5. **Teach** — the `teach` skill's loop for each node, in `next` order, with `quiz_ask` checks (pass `node`). Exercises in `chat` mode work well here.
6. **Close** — a short recap section in the note: the few generating ideas everything collapsed into, as a compact list or diagram. Then `session_end({summary})`.
7. **Offer to promote**: "Want to turn this into a class so it's tracked and re-checked over time?" If yes, `workshop_promote({folder})` — the new class starts with this map and today's results — and tell them to open Claude Code in that folder and run `/learn`.
