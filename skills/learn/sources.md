# Ingesting course material

New files in `sources/` extend the map; they never rebuild it. Existing nodes and all mastery history stay intact.

1. `sources_scan` — lists each file as new / changed / partial / ingested.
2. **Read** each new file with `Read`.
   - PDFs: read the table of contents / first pages first (`pages: "1-5"`), then the relevant chapters in chunks of up to 20 pages. For a textbook, don't ingest it all at once: ingest the chapters relevant to the current goal and mark the source `partial` with `progress` (e.g. "ch 1–4 of 12"). Pick the rest up when the course gets there.
   - Slides, notes, problem sets, past exams: read fully. Past exams and problem sets are gold for writing realistic `transfer` / `worked` checks and for knowing what's emphasised.
3. **Extract**: concepts and definitions (→ nodes), dependencies (→ edges), worked examples and exercises (→ practice nodes or exercise material), and the course's own notation and conventions.
4. **Diff against the map.** For each concept: already a node (add a source citation), a new node (where does it attach?), or a refinement (split or rename a node — keep ids stable where you can). Watch for definitions that differ from standard usage — note them in `CLASS.md` and teach the course's version, naming the difference.
5. **Preview** with `graph_apply({..., dry_run: true})`, show the learner a concise list of additions and the preview diagram, and apply after they agree. Small additions mid-session (one or two nodes) can just be applied and mentioned.
6. Mark each file with `graph_apply({sources: [{file, status: "ingested" | "partial", progress}]})`.

Cite pages on nodes (`sources: [{file: "sources/lec03.pdf", page: "4-6"}]`) — when verifying a fact, the course's own source is the first place to look.
