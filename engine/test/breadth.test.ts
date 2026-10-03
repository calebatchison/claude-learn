import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyChanges, nodeDepths } from "../src/core/graph.ts";
import { FOLLOWUP_DAYS, record, status, statuses } from "../src/core/mastery.ts";
import { next } from "../src/core/plan.ts";
import { listNodes, renderMap } from "../src/core/render.ts";
import type { Evidence, Graph } from "../src/core/types.ts";
import { hours, sampleGraph, T0 } from "./helpers.ts";

const pass = (at: Date, extra: Partial<Evidence> = {}): Evidence => ({
	at: at.toISOString(),
	via: "quiz",
	purpose: "check",
	check: "recall",
	result: "correct",
	...extra,
});
const styled = (style: Graph["style"]) => applyChanges(sampleGraph(), { style }, T0).graph;
const depthOf = (g: Graph) => Object.fromEntries([...nodeDepths(g)].map(([id, d]) => [id, d.depth]));

describe("depth resolution", () => {
	it("no style means every node is deep, as before", () => {
		assert.ok(Object.values(depthOf(sampleGraph())).every((d) => d === "deep"));
	});

	it("breadth style makes every node breadth", () => {
		assert.ok(Object.values(depthOf(styled("breadth"))).every((d) => d === "breadth"));
	});

	it("mix: foundations and what 2+ nodes build on are deep, with their whole base; outer topics are breadth", () => {
		// span has two dependents (basis, linear-maps); basis has two (dimension, eigen).
		assert.deepEqual(depthOf(styled("mix")), {
			vectors: "deep",
			span: "deep",
			basis: "deep",
			dimension: "breadth",
			"linear-maps": "breadth",
			eigen: "breadth",
		});
	});

	it("a deep override pulls every ancestor deep, naming the reason", () => {
		const g = applyChanges(styled("breadth"), { nodes: [{ id: "eigen", depth: "deep", depth_reason: "the goal" }] }, T0).graph;
		const d = nodeDepths(g);
		for (const id of ["eigen", "linear-maps", "basis", "span", "vectors"]) assert.equal(d.get(id)!.depth, "deep", id);
		assert.equal(d.get("dimension")!.depth, "breadth");
		assert.equal(d.get("vectors")!.promotedBy, "eigen");
		assert.equal(d.get("eigen")!.promotedBy, undefined);
		assert.match(listNodes(g), /vectors \| Vectors \| unseen \| deep \(because eigen\)/);
	});

	it("depth overrides need a reason and can't make a deep node's base breadth", () => {
		const g = applyChanges(styled("breadth"), { nodes: [{ id: "eigen", depth: "deep", depth_reason: "the goal" }] }, T0).graph;
		assert.throws(() => applyChanges(g, { nodes: [{ id: "dimension", depth: "deep" }] }, T0), /needs a depth_reason/);
		assert.throws(() => applyChanges(g, { nodes: [{ id: "basis", depth: "breadth", depth_reason: "x" }] }, T0), /"eigen" is deep and builds on it/);
		const g2 = applyChanges(g, { nodes: [{ id: "eigen", depth: "breadth", depth_reason: "goal changed" }] }, T0).graph;
		assert.equal(g2.nodes.eigen!.depthRules!.length, 2);
		assert.ok(Object.values(depthOf(g2)).every((d) => d === "breadth"));
	});
});

describe("breadth bar", () => {
	it("one clean pass covers a node; heavy hints don't", () => {
		const n = sampleGraph().nodes.vectors!;
		record(n, pass(T0, { hints: 2 }), T0, "breadth");
		assert.equal(status(n, "breadth"), "passing");
		record(n, pass(hours(T0, 1)), hours(T0, 1), "breadth");
		assert.equal(status(n, "breadth"), "solid");
		assert.equal(status(n, "deep"), "passing", "the same evidence is judged by the deep bar when promoted");
	});

	it("no spaced reviews: a clean pass schedules nothing; a miss gets one follow-up, then none", () => {
		const n = sampleGraph().nodes.vectors!;
		record(n, pass(T0), T0, "breadth");
		assert.equal(n.review, undefined);
		record(n, { ...pass(hours(T0, 2)), result: "wrong", misconception: "arrows only" }, hours(T0, 2), "breadth");
		assert.equal(status(n, "breadth"), "misconception", "misconceptions are still caught");
		record(n, pass(hours(T0, 3)), hours(T0, 3), "breadth");
		assert.equal(n.review!.interval, FOLLOWUP_DAYS);
		record(n, pass(hours(T0, 80)), hours(T0, 80), "breadth");
		assert.equal(n.review, undefined);
	});

	it("covered nodes unlock dependents and show as covered on the map", () => {
		const g = styled("breadth");
		record(g.nodes.vectors!, pass(T0), T0, "breadth");
		assert.equal(statuses(g).get("vectors"), "solid");
		assert.equal(next(g, T0).find((r) => r.action === "teach")!.node, "span");
		assert.match(renderMap(g, T0), /☑️ Vectors/);
		assert.match(listNodes(g), /vectors \| Vectors \| covered \| breadth/);
	});
});
