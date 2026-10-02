import { applyChanges, emptyGraph } from "../src/core/graph.ts";
import type { Graph } from "../src/core/types.ts";

export const T0 = new Date("2026-10-01T10:00:00");
export const hours = (d: Date, h: number) => new Date(d.getTime() + h * 3600_000);

/**
 * vectors -> span -> basis -> dimension
 *              \-> linear-maps -> eigen
 */
export function sampleGraph(now = T0): Graph {
	const g = emptyGraph("class", "Linear Algebra", "understand eigenvectors", now);
	return applyChanges(
		g,
		{
			phase: "active",
			units: [
				{ id: "u1", title: "Spaces" },
				{ id: "u2", title: "Maps" },
			],
			nodes: [
				{ id: "vectors", title: "Vectors", unit: "u1", foundational: true },
				{ id: "span", title: "Span", unit: "u1", prereqs: ["vectors"] },
				{ id: "basis", title: "Basis", unit: "u1", prereqs: ["span"] },
				{ id: "dimension", title: "Dimension", unit: "u1", prereqs: ["basis"] },
				{ id: "linear-maps", title: "Linear maps", unit: "u2", prereqs: ["span"] },
				{ id: "eigen", title: "Eigenvectors", unit: "u2", prereqs: ["linear-maps", "basis"] },
			],
		},
		now,
	).graph;
}
