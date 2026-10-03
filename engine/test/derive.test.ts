import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignExercise, createQuiz, submitExercise } from "../src/core/assess.ts";
import { applyChanges } from "../src/core/graph.ts";
import { masteryGap, record, requiresDerive, status } from "../src/core/mastery.ts";
import { next } from "../src/core/plan.ts";
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

describe("derive requirement", () => {
	it("defaults to required for derived concepts, not for foundations or practice", () => {
		const g = sampleGraph();
		assert.equal(requiresDerive(g.nodes.vectors!), false, "foundational");
		assert.equal(requiresDerive(g.nodes.span!), true);
		const g2 = applyChanges(g, { nodes: [{ id: "two-sum", title: "Two Sum", kind: "practice", prereqs: ["span"] }] }, T0).graph;
		assert.equal(requiresDerive(g2.nodes["two-sum"]!), false, "practice");
	});

	it("overrides need a reason and are logged", () => {
		const g = sampleGraph();
		assert.throws(() => applyChanges(g, { nodes: [{ id: "span", requires_derive: false }] }, T0), /needs a derive_reason/);
		let g2 = applyChanges(g, { nodes: [{ id: "span", requires_derive: false, derive_reason: "pure notation" }] }, T0).graph;
		assert.equal(requiresDerive(g2.nodes.span!), false);
		g2 = applyChanges(g2, { nodes: [{ id: "span", requires_derive: true, derive_reason: "turned out conceptual" }] }, hours(T0, 5)).graph;
		assert.equal(requiresDerive(g2.nodes.span!), true);
		assert.equal(g2.nodes.span!.deriveRules!.length, 2);
	});

	it("a derived node isn't solid on two kinds and a delay alone — it needs a derive pass covering every prereq", () => {
		const g = sampleGraph();
		const n = g.nodes.eigen!;
		record(n, pass(T0, "recall"), T0);
		record(n, pass(hours(T0, 30), "transfer"), hours(T0, 30));
		assert.equal(status(n), "passing");
		assert.match(masteryGap(n)!, /derive check rebuilding it from linear-maps, basis/);
		record(n, pass(hours(T0, 31), "derive", { via: "exercise", links: [{ from: "linear-maps", ok: true }, { from: "basis", ok: true }] }), hours(T0, 31));
		assert.equal(status(n), "solid");
	});

	it("adding a prereq later re-opens the derive requirement", () => {
		const g = sampleGraph();
		const n = g.nodes.span!;
		record(n, pass(T0, "recall"), T0);
		record(n, pass(hours(T0, 30), "derive", { via: "exercise", links: [{ from: "vectors", ok: true }] }), hours(T0, 30));
		assert.equal(status(n), "solid");
		n.prereqs.push("dimension"); // contrived, but shows the rule
		assert.equal(status(n), "passing");
	});
});

describe("derive exercises", () => {
	it("must cover every prereq, need a rubric, and can't be a quiz", () => {
		const g = sampleGraph();
		const a = emptyAssess();
		const base = { node: "eigen", prompt: "Show why…", solution: "…", rubric: "uses maps and basis", check: "derive" as const };
		assert.throws(() => assignExercise(a, g, { ...base, covers: ["basis"] }, T0), /missing: linear-maps/);
		assert.throws(() => assignExercise(a, g, { ...base, rubric: undefined, covers: ["basis", "linear-maps"] }, T0), /rubric/);
		assert.throws(() => assignExercise(a, g, { ...base, node: "vectors", covers: [] }, T0), /no prerequisites/);
		assert.throws(() => createQuiz(a, g, { node: "eigen", question: "?", options: [{ label: "a" }, { label: "b" }], correct: [0], check: "derive" }, T0), /free response/);
		const ex = assignExercise(a, g, { ...base, covers: ["basis", "linear-maps"] }, T0);
		assert.deepEqual(ex.covers, ["linear-maps", "basis"]);
	});

	it("records which links held, and a broken link is named in remediation", () => {
		const g = sampleGraph();
		const a = emptyAssess();
		for (const id of ["vectors", "span", "basis", "linear-maps"]) g.nodes[id]!.evidence.push(pass(T0, "recall"));
		const ex = assignExercise(a, g, { node: "eigen", prompt: "…", solution: "…", rubric: "…", check: "derive", covers: ["basis", "linear-maps"] }, T0);
		assert.throws(() => submitExercise(a, g, { id: ex.id, result: "correct", feedback: "", links: [{ from: "basis", ok: true }] }, T0), /missing linear-maps/);
		assert.throws(
			() => submitExercise(a, g, { id: ex.id, result: "correct", feedback: "", links: [{ from: "basis", ok: true }, { from: "linear-maps", ok: false }] }, T0),
			/can't be correct/,
		);
		submitExercise(a, g, { id: ex.id, result: "partial", feedback: "lost the map step", links: [{ from: "basis", ok: true }, { from: "linear-maps", ok: false }] }, T0);
		assert.deepEqual(g.nodes.eigen!.evidence.at(-1)!.links, [
			{ from: "linear-maps", ok: false },
			{ from: "basis", ok: true },
		]);
		const rec = next(g, T0).find((r) => r.node === "eigen")!;
		assert.equal(rec.action, "remediate");
		assert.match(rec.reason, /couldn't get from Linear maps to Eigenvectors/);
	});
});
