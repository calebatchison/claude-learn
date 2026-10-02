# Goals and deadlines

"I have a test on eigenvalues Friday" reshapes the course around a target without losing anything.

1. **Pin the target and the date.** Convert relative dates to `YYYY-MM-DD` from today's date. Ask what the test covers if it isn't clear (a syllabus or past exam in `sources/` helps).
2. **Map the targets to nodes** with `graph_view({scope: "all"})`. If the map lacks something the test covers, add it with `graph_apply` first (attach it properly — the goal's plan follows prerequisites).
3. `goal_set({targets, by, note})` — returns every unmastered prerequisite in teaching order, spread over the days left, plus satisfied-but-not-solid nodes to re-verify before the deadline.
4. **Present the plan** briefly. If there's a warning (too much for the time), be honest and help them choose: the most testable nodes, the ones worth most marks, or skip depth on lower-priority branches.
5. Carry on with [session.md](session.md). `next` now prioritises the goal's path — remediation and reviews on the path first, then new nodes on the path.

When the deadline passes (`learn_status` shows a goal whose `by` is before today) or they say it's done, ask how it went, record anything useful in `CLASS.md`, and `goal_clear`. Pacing returns to the normal frontier. Multiple goals can be active; the earliest deadline wins.
