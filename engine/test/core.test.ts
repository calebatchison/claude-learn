import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignExercise, createQuiz, gradeQuiz, resolveSelection, submitExercise } from "../src/core/assess.ts";
import { applyChanges, topoOrder } from "../src/core/graph.ts";
import { inferAncestors, markTaught, record, status } from "../src/core/mastery.ts";
import { next, placementCandidates, planGoal } from "../src/core/plan.ts";
import { renderMap, renderProgress } from "../src/core/render.ts";
import type { AssessState, Evidence } from "../src/core/types.ts";
import { hours, sampleGraph, T0 } from "./helpers.ts";

const pass = (at: Date, check: Evidence["check"], extra: Partial<Evidence> = {}): Evidence => ({
	at: at.toISOString(),
	via: "quiz",
	purpose: "check",
	check,
	result: "correct",
	...extra,
});
const emptyAssess = (): AssessState => ({ counter: { quiz: 0, exercise: 0 }, quizzes: {}, exercises: {} });

describe("graph", () => {
	it("rejects cycles, unknown prereqs and bad ids without touching the original", () => {
		const g = sampleGraph();
		assert.throws(() => applyChanges(g, { add_edges: [{ from: "eigen", to: "vectors" }] }, T0), /cycle/);
		assert.throws(() => applyChanges(g, { nodes: [{ id: "x", title: "X", prereqs: ["nope"] }] }, T0), /unknown prereq "nope"/);
		assert.throws(() => applyChanges(g, { nodes: [{ id: "Bad Id", title: "X" }] }, T0), /kebab-case/);
		assert.throws(() => applyChanges(g, { remove: ["span"] }, T0), /depend on it/);
		assert.equal(g.nodes.vectors!.prereqs.length, 0);
	});

	it("orders prereqs before dependents", () => {
		const order = topoOrder(sampleGraph());
		for (const [a, b] of [
			["vectors", "span"],
			["span", "basis"],
			["linear-maps", "eigen"],
			["basis", "eigen"],
		]) {
			assert.ok(order.indexOf(a!) < order.indexOf(b!), `${a} before ${b}`);
		}
	});
});

describe("mastery", () => {
	it("walks unseen → taught → passing → solid only with 2 check kinds and a delayed re-check", () => {
		const n = sampleGraph().nodes.vectors!;
		assert.equal(status(n), "unseen");
		markTaught(n, T0);
		assert.equal(status(n), "taught");
		record(n, pass(T0, "recall"), T0);
		assert.equal(status(n), "passing");
		record(n, pass(hours(T0, 1), "transfer"), hours(T0, 1));
		assert.equal(status(n), "passing", "same-day passes aren't enough");
		record(n, pass(hours(T0, 26), "recall"), hours(T0, 26));
		assert.equal(status(n), "passing", "multiple choice alone never reaches solid");
		record(n, pass(hours(T0, 27), "recall", { via: "exercise" }), hours(T0, 27));
		assert.equal(status(n), "solid");
	});

	it("a single kind of check never reaches solid, however many days", () => {
		const n = sampleGraph().nodes.vectors!;
		for (let d = 0; d < 5; d++) record(n, pass(hours(T0, 24 * d), "recall"), hours(T0, 24 * d));
		assert.equal(status(n), "passing");
	});

	it("heavily hinted passes don't count toward mastery", () => {
		const n = sampleGraph().nodes.vectors!;
		record(n, pass(T0, "recall"), T0);
		record(n, pass(hours(T0, 30), "worked", { hints: 2 }), hours(T0, 30));
		assert.equal(status(n), "passing");
	});

	it("a miss resets the run; a named misconception is its own status", () => {
		const n = sampleGraph().nodes.vectors!;
		record(n, pass(T0, "recall"), T0);
		record(n, pass(hours(T0, 30), "transfer", { via: "exercise" }), hours(T0, 30));
		assert.equal(status(n), "solid");
		record(n, { ...pass(hours(T0, 60), "transfer"), result: "wrong", misconception: "thinks vectors are arrows only" }, hours(T0, 60));
		assert.equal(status(n), "misconception");
		record(n, pass(hours(T0, 61), "recall"), hours(T0, 61));
		assert.equal(status(n), "passing", "earlier passes before the miss don't carry over");
	});

	it("failing a placement probe on something never taught means unseen, not shaky", () => {
		const n = sampleGraph().nodes.basis!;
		record(n, { ...pass(T0, "recall"), purpose: "probe", result: "wrong" }, T0);
		assert.equal(status(n), "unseen");
	});

	it("review intervals grow only when the node was due", () => {
		const n = sampleGraph().nodes.vectors!;
		record(n, pass(T0, "recall"), T0);
		assert.equal(n.review!.interval, 1);
		record(n, pass(hours(T0, 1), "transfer"), hours(T0, 1));
		assert.equal(n.review!.interval, 1, "second check same session doesn't inflate");
		record(n, pass(hours(T0, 25), "recall"), hours(T0, 25));
		assert.equal(n.review!.interval, 3);
		record(n, { ...pass(hours(T0, 100), "recall"), result: "wrong" }, hours(T0, 100));
		assert.equal(n.review!.interval, 0);
	});

	it("a correct probe credits unchecked ancestors as assumed", () => {
		const g = sampleGraph();
		const credited = inferAncestors(g, "basis", T0);
		assert.deepEqual(credited.sort(), ["span", "vectors"]);
		assert.equal(status(g.nodes.span!), "assumed");
	});
});

describe("plan", () => {
	it("starts with foundations, then unlocks dependents as they pass", () => {
		const g = sampleGraph();
		assert.deepEqual(
			next(g, T0).map((r) => r.node),
			["vectors"],
		);
		record(g.nodes.vectors!, pass(T0, "recall"), T0);
		assert.deepEqual(
			next(g, T0).map((r) => r.node),
			["span"],
		);
	});

	it("remediation comes before reviews, reviews before new material", () => {
		const g = sampleGraph();
		record(g.nodes.vectors!, pass(T0, "recall"), T0);
		record(g.nodes.span!, pass(T0, "recall"), T0);
		markTaught(g.nodes.basis!, T0);
		record(g.nodes.basis!, { ...pass(T0, "recall"), result: "wrong" }, T0);
		const later = hours(T0, 30);
		const recs = next(g, later);
		assert.equal(recs[0]!.action, "remediate");
		assert.equal(recs[0]!.node, "basis");
		assert.ok(recs.slice(1).some((r) => r.action === "review"));
		const firstTeach = recs.findIndex((r) => r.action === "teach");
		const lastReview = recs.map((r) => r.action).lastIndexOf("review");
		assert.ok(firstTeach === -1 || firstTeach > lastReview);
	});

	it("an active goal restricts new material to the goal's path", () => {
		const g = sampleGraph();
		for (const id of ["vectors", "span", "basis"]) record(g.nodes[id]!, pass(T0, "recall"), T0);
		// Without a goal, dimension (unit 1) comes before linear-maps (unit 2).
		assert.equal(next(g, T0).find((r) => r.action === "teach")!.node, "dimension");
		g.goals.push({ id: "g1", targets: ["eigen"], by: "2026-10-03", created: T0.toISOString() });
		const teach = next(g, T0).filter((r) => r.action === "teach");
		assert.equal(teach[0]!.node, "linear-maps");
		assert.ok(!teach.some((r) => r.node === "dimension"));
	});

	it("goal plans spread the closure over the days left", () => {
		const g = sampleGraph();
		const p = planGoal(g, { id: "g", targets: ["eigen"], by: "2026-10-02", created: T0.toISOString() }, T0);
		assert.equal(p.days, 2);
		assert.deepEqual(p.closure, ["vectors", "span", "basis", "linear-maps", "eigen"]);
		assert.equal(p.schedule.flatMap((d) => d.nodes).length, 5);
	});

	it("placement probes the middle of the unknown region first", () => {
		const g = sampleGraph();
		g.phase = "placement";
		const first = placementCandidates(g, 1)[0]!.node!;
		assert.ok(["span", "basis", "linear-maps"].includes(first), `got ${first}`);
	});
});

describe("assess", () => {
	it("grades, records evidence and the picked distractor's misconception", () => {
		const g = sampleGraph();
		const a = emptyAssess();
		const q = createQuiz(
			a,
			g,
			{
				node: "span",
				question: "Span of {(1,0)}?",
				options: [{ label: "A line" }, { label: "The plane", misconception: "confuses span with ambient space" }],
				correct: [0],
			},
			T0,
		);
		assert.deepEqual(resolveSelection(q, ["B"]), [1]);
		assert.deepEqual(resolveSelection(q, ["a line"]), [0]);
		const grade = gradeQuiz(a, g, q.id, [1], T0);
		assert.equal(grade.result, "wrong");
		assert.equal(grade.misconception, "confuses span with ambient space");
		assert.equal(status(g.nodes.span!), "misconception");
		assert.throws(() => gradeQuiz(a, g, q.id, [0], T0), /already-graded/);
	});

	it("multi-select needs the exact set", () => {
		const a = emptyAssess();
		const q = createQuiz(a, undefined, { question: "?", options: [{ label: "a" }, { label: "b" }, { label: "c" }], correct: [0, 2] }, T0);
		assert.equal(gradeQuiz(a, undefined, q.id, [0], T0).result, "wrong");
		const q2 = createQuiz(a, undefined, { question: "?", options: [{ label: "a" }, { label: "b" }, { label: "c" }], correct: [2, 0] }, T0);
		assert.equal(gradeQuiz(a, undefined, q2.id, [0, 2], T0).result, "correct");
	});

	it("exercises store the solution and record a worked check", () => {
		const g = sampleGraph();
		const a = emptyAssess();
		const ex = assignExercise(a, g, { node: "basis", prompt: "Find a basis of …", solution: "…" }, T0);
		const r = submitExercise(a, g, { id: ex.id, result: "partial", hints: 1, feedback: "step 2" }, T0);
		assert.equal(r.status, "shaky");
		assert.equal(g.nodes.basis!.evidence[0]!.check, "worked");
		assert.throws(() => submitExercise(a, g, { id: ex.id, result: "correct", feedback: "" }, T0), /already graded/);
	});
});

describe("render", () => {
	it("escapes labels and marks next up", () => {
		const g = sampleGraph();
		g.nodes.vectors!.title = 'Vectors "arrows" <b>';
		const md = renderMap(g, T0);
		assert.match(md, /n_vectors\["▶ ⚪ Vectors #quot;arrows#quot; b"\]/);
		assert.ok(!md.includes("subgraph"), "no subgraphs: they explode the layout in Obsidian");
		assert.match(md, /class n_vectors next/);
		assert.match(renderProgress(g, [], T0), /## Next up/);
	});

	it("switches to a unit overview for big graphs", () => {
		const g = sampleGraph();
		const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `extra-${i}`, title: `Extra ${i}`, unit: "u2", prereqs: ["eigen"] }));
		const big = applyChanges(g, { nodes }, T0).graph;
		const md = renderMap(big, T0);
		assert.match(md, /## Units/);
		assert.match(md, /## Focus/);
		// Every diagram stays small; the 40-node unit is listed instead of drawn.
		for (const d of md.match(/```mermaid[\s\S]*?```/g)!) {
			assert.ok((d.match(/^  n_\w+\["/gm) ?? []).length <= 14, "diagram too big");
		}
		assert.match(md, /^- ⚪ Extra 0$/m);
	});
});
