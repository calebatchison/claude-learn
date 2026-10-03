import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { creditPrereqs, markTaught } from "../src/core/mastery.ts";
import { next } from "../src/core/plan.ts";
import type { Evidence, Graph } from "../src/core/types.ts";
import { hours, sampleGraph, T0 } from "./helpers.ts";

const DAY = 24 * 3600_000;
const pass = (at: Date, extra: Partial<Evidence> = {}): Evidence => ({ at: at.toISOString(), via: "quiz", purpose: "review", check: "recall", result: "correct", ...extra });

/** Every node passing, each with a 10-day interval due 5 days after T0. */
function passingGraph(): Graph {
	const g = sampleGraph();
	for (const n of Object.values(g.nodes)) {
		n.evidence.push(pass(T0, { purpose: "check" }));
		n.review = { interval: 10, due: new Date(T0.getTime() + 5 * DAY).toISOString() };
	}
	return g;
}
const dueIn = (g: Graph, id: string, from: Date) => (Date.parse(g.nodes[id]!.review!.due) - from.getTime()) / DAY;

describe("implicit review credit", () => {
	it("pushes prereqs back by 50% / 25% / 12.5% of their interval by depth, shortest route first", () => {
		const g = passingGraph();
		// eigen -> linear-maps (1), basis (1) -> span (2) -> vectors (3)
		const moved = creditPrereqs(g, "eigen", pass(T0), T0);
		assert.deepEqual(moved.sort(), ["basis", "linear-maps", "span", "vectors"]);
		assert.equal(dueIn(g, "basis", T0), 10, "5 + 50% of 10, capped at a fresh interval");
		assert.equal(dueIn(g, "span", T0), 7.5);
		assert.equal(dueIn(g, "vectors", T0), 6.25);
		assert.equal(dueIn(g, "dimension", T0), 5, "not underneath eigen");
		assert.equal(g.nodes.basis!.evidence.length, 1, "no evidence added");
	});

	it("only cold, clean, confident passes count", () => {
		const g = passingGraph();
		markTaught(g.nodes.span!, T0);
		assert.deepEqual(creditPrereqs(g, "span", pass(hours(T0, 1), { purpose: "check" }), hours(T0, 1)), [], "check right after teaching");
		assert.deepEqual(creditPrereqs(g, "span", pass(T0, { confidence: "unsure" }), T0), [], "tentative");
		assert.deepEqual(creditPrereqs(g, "span", pass(T0, { hints: 2 }), T0), [], "heavily hinted");
		assert.deepEqual(creditPrereqs(g, "span", pass(T0, { purpose: "probe" }), T0), [], "probe");
		assert.deepEqual(creditPrereqs(g, "span", pass(hours(T0, 26), { purpose: "check", via: "exercise" }), hours(T0, 26)), ["vectors"], "later-day exercise");
	});

	it("skips assumed and broken prereqs", () => {
		const g = passingGraph();
		g.nodes.span!.evidence = [{ ...pass(T0), via: "inferred", purpose: "probe" }];
		g.nodes.vectors!.evidence.push({ ...pass(T0), result: "wrong" });
		assert.deepEqual(creditPrereqs(g, "basis", pass(T0), T0), []);
	});

	it("a plain miss names the prereqs to consider", () => {
		const g = passingGraph();
		g.nodes.basis!.evidence.push({ ...pass(T0), result: "wrong" });
		const rec = next(g, T0).find((r) => r.node === "basis")!;
		assert.match(rec.reason, /builds on Span — check one first if the miss looks foundational/);
	});
});
