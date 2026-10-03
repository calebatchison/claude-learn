import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createQuiz, gradeQuiz } from "../src/core/assess.ts";
import { masteryGap, record, status } from "../src/core/mastery.ts";
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
const ask = (a: AssessState, g: ReturnType<typeof sampleGraph>, node: string, purpose: "probe" | "check" | "review") =>
	createQuiz(a, g, { node, question: "?", options: [{ label: "right" }, { label: "wrong" }], correct: [0], purpose }, T0);

describe("confidence", () => {
	it("unsure + right on a probe is tentative: no status change, no credit for ancestors", () => {
		const g = sampleGraph();
		const a = emptyAssess();
		const grade = gradeQuiz(a, g, ask(a, g, "basis", "probe").id, [0], T0, "unsure");
		assert.equal(grade.tentative, true);
		assert.equal(grade.inferred, undefined);
		assert.equal(status(g.nodes.basis!), "unseen");
		assert.equal(status(g.nodes.span!), "unseen");
	});

	it("sure + right on a probe credits ancestors as before", () => {
		const g = sampleGraph();
		const a = emptyAssess();
		const grade = gradeQuiz(a, g, ask(a, g, "basis", "probe").id, [0], T0, "sure");
		assert.deepEqual(grade.inferred!.sort(), ["span", "vectors"]);
	});

	it("sure + wrong is a misconception even without a tagged distractor; unsure + wrong is an ordinary miss", () => {
		const g = sampleGraph();
		const a = emptyAssess();
		for (const id of ["vectors", "span"]) g.nodes[id]!.evidence.push(pass(T0, "recall"));
		const sure = gradeQuiz(a, g, ask(a, g, "span", "review").id, [1], T0, "sure");
		assert.match(sure.misconception!, /confidently chose "B\. wrong"/);
		assert.equal(status(g.nodes.span!), "misconception");
		gradeQuiz(a, g, ask(a, g, "vectors", "review").id, [1], T0, "unsure");
		assert.equal(status(g.nodes.vectors!), "shaky");
	});

	it("confidence is ignored on the check right after teaching", () => {
		const g = sampleGraph();
		const a = emptyAssess();
		const grade = gradeQuiz(a, g, ask(a, g, "vectors", "check").id, [0], T0, "unsure");
		assert.equal(grade.tentative, undefined);
		assert.equal(status(g.nodes.vectors!), "passing");
	});

	it("a tentative review keeps status, holds the interval, and comes back at half of it", () => {
		const n = sampleGraph().nodes.vectors!;
		record(n, pass(T0, "recall"), T0);
		n.review = { interval: 8, due: T0.toISOString() };
		record(n, pass(hours(T0, 1), "transfer", { purpose: "review", confidence: "unsure" }), hours(T0, 1));
		assert.equal(status(n), "passing");
		assert.equal(n.review!.interval, 8);
		assert.equal(Date.parse(n.review!.due) - hours(T0, 1).getTime(), 4 * 24 * 3600_000);
	});

	it("a tentative pass doesn't break a run or count toward it", () => {
		const n = sampleGraph().nodes.vectors!;
		record(n, pass(T0, "recall"), T0);
		record(n, pass(hours(T0, 30), "transfer", { purpose: "review", confidence: "unsure", via: "exercise" }), hours(T0, 30));
		assert.equal(status(n), "passing");
		assert.match(masteryGap(n)!, /a transfer or worked or derive check/);
	});
});

describe("generative recall", () => {
	it("solid needs at least one exercise pass, even on a foundation", () => {
		const n = sampleGraph().nodes.vectors!;
		record(n, pass(T0, "recall"), T0);
		record(n, pass(hours(T0, 30), "transfer"), hours(T0, 30));
		assert.equal(status(n), "passing");
		assert.match(masteryGap(n)!, /free-response exercise/);
		record(n, pass(hours(T0, 31), "recall", { via: "exercise" }), hours(T0, 31));
		assert.equal(status(n), "solid");
	});
});
