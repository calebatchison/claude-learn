import type { ContextKind, Graph, GraphNode, NodeKind, Phase, SourceRef, SourceStatus, Unit } from "./types.ts";
import { iso } from "./util.ts";

export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function emptyGraph(kind: ContextKind, name: string, goal: string, now: Date): Graph {
	return {
		schema: 1,
		kind,
		name,
		goal,
		created: iso(now),
		phase: "setup",
		units: [],
		nodes: {},
		goals: [],
		sources: [],
		sessions: [],
	};
}

export function getNode(g: Graph, id: string): GraphNode {
	const n = g.nodes[id];
	if (!n) throw new Error(`unknown node "${id}"`);
	return n;
}

export function dependents(g: Graph): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const id of Object.keys(g.nodes)) out.set(id, []);
	for (const n of Object.values(g.nodes)) for (const p of n.prereqs) out.get(p)?.push(n.id);
	return out;
}

export function ancestors(g: Graph, id: string): Set<string> {
	const seen = new Set<string>();
	const stack = [...(g.nodes[id]?.prereqs ?? [])];
	while (stack.length) {
		const cur = stack.pop()!;
		if (seen.has(cur)) continue;
		seen.add(cur);
		stack.push(...(g.nodes[cur]?.prereqs ?? []));
	}
	return seen;
}

export function descendants(g: Graph, id: string, deps = dependents(g)): Set<string> {
	const seen = new Set<string>();
	const stack = [...(deps.get(id) ?? [])];
	while (stack.length) {
		const cur = stack.pop()!;
		if (seen.has(cur)) continue;
		seen.add(cur);
		stack.push(...(deps.get(cur) ?? []));
	}
	return seen;
}

/** Returns a cycle as a list of ids, or undefined if the graph is acyclic. */
export function findCycle(g: Graph): string[] | undefined {
	const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = done
	const trail: string[] = [];
	const visit = (id: string): string[] | undefined => {
		state.set(id, 1);
		trail.push(id);
		for (const p of g.nodes[id]?.prereqs ?? []) {
			if (!g.nodes[p]) continue;
			const s = state.get(p);
			if (s === 1) return [...trail.slice(trail.indexOf(p)), p];
			if (s === undefined) {
				const c = visit(p);
				if (c) return c;
			}
		}
		trail.pop();
		state.set(id, 2);
		return undefined;
	};
	for (const id of Object.keys(g.nodes)) {
		if (!state.has(id)) {
			const c = visit(id);
			if (c) return c.reverse();
		}
	}
	return undefined;
}

/** Longest path from a root (a node with no prereqs is depth 0). */
export function depths(g: Graph): Map<string, number> {
	const memo = new Map<string, number>();
	const depth = (id: string, guard: Set<string>): number => {
		const known = memo.get(id);
		if (known !== undefined) return known;
		if (guard.has(id)) return 0;
		guard.add(id);
		const ps = (g.nodes[id]?.prereqs ?? []).filter((p) => g.nodes[p]);
		const d = ps.length ? 1 + Math.max(...ps.map((p) => depth(p, guard))) : 0;
		guard.delete(id);
		memo.set(id, d);
		return d;
	};
	for (const id of Object.keys(g.nodes)) depth(id, new Set());
	return memo;
}

/** Stable teaching order: unit order, then depth, then title. Respects prereqs. */
export function topoOrder(g: Graph): string[] {
	const d = depths(g);
	const unitIdx = new Map(g.units.map((u, i) => [u.id, i]));
	const rank = (id: string) => {
		const n = g.nodes[id]!;
		return [n.unit !== undefined ? (unitIdx.get(n.unit) ?? 999) : 999, d.get(id) ?? 0] as const;
	};
	const ids = Object.keys(g.nodes).sort((a, b) => {
		const [ua, da] = rank(a);
		const [ub, db] = rank(b);
		return ua - ub || da - db || g.nodes[a]!.title.localeCompare(g.nodes[b]!.title);
	});
	// Kahn's algorithm, always picking the earliest-ranked ready node, so a
	// unit-1 node that depends on a unit-2 node still comes after it.
	const placed = new Set<string>();
	const order: string[] = [];
	while (order.length < ids.length) {
		const next = ids.find((id) => !placed.has(id) && g.nodes[id]!.prereqs.every((p) => placed.has(p) || !g.nodes[p]));
		if (!next) break; // cycle; validate() reports it
		placed.add(next);
		order.push(next);
	}
	for (const id of ids) if (!placed.has(id)) order.push(id);
	return order;
}

export function validate(g: Graph): string[] {
	const errors: string[] = [];
	const unitIds = new Set(g.units.map((u) => u.id));
	for (const [key, n] of Object.entries(g.nodes)) {
		if (key !== n.id) errors.push(`node key "${key}" doesn't match its id "${n.id}"`);
		if (!ID_RE.test(n.id)) errors.push(`node id "${n.id}" must be lowercase kebab-case`);
		if (n.unit && !unitIds.has(n.unit)) errors.push(`node "${n.id}" is in unknown unit "${n.unit}"`);
		for (const p of n.prereqs) {
			if (p === n.id) errors.push(`node "${n.id}" lists itself as a prereq`);
			else if (!g.nodes[p]) errors.push(`node "${n.id}" has unknown prereq "${p}"`);
		}
	}
	const cycle = findCycle(g);
	if (cycle) errors.push(`prerequisite cycle: ${cycle.join(" -> ")}`);
	return errors;
}

// ── Change sets ─────────────────────────────────────────────────────────────

export interface NodeUpsert {
	id: string;
	title?: string;
	kind?: NodeKind;
	unit?: string | null;
	summary?: string;
	prereqs?: string[];
	foundational?: boolean;
	sources?: SourceRef[];
	links?: string[];
}

export interface Edge {
	from: string; // prereq
	to: string; // dependent
}

export interface ChangeSet {
	name?: string;
	goal?: string;
	phase?: Phase;
	units?: Unit[];
	nodes?: NodeUpsert[];
	remove?: string[];
	add_edges?: Edge[];
	remove_edges?: Edge[];
	sources?: { file: string; status: SourceStatus; progress?: string; note?: string }[];
}

export interface ChangeSummary {
	added: string[];
	updated: string[];
	removed: string[];
	edgesAdded: number;
	edgesRemoved: number;
	unitsAdded: string[];
	sourcesUpdated: string[];
}

/**
 * Apply a change set to a copy of the graph. Throws with every validation
 * error at once if the result would be invalid, so the original is untouched.
 */
export function applyChanges(g: Graph, cs: ChangeSet, now: Date): { graph: Graph; summary: ChangeSummary } {
	const next: Graph = structuredClone(g);
	const summary: ChangeSummary = {
		added: [],
		updated: [],
		removed: [],
		edgesAdded: 0,
		edgesRemoved: 0,
		unitsAdded: [],
		sourcesUpdated: [],
	};
	const errors: string[] = [];

	if (cs.name !== undefined) next.name = cs.name;
	if (cs.goal !== undefined) next.goal = cs.goal;
	if (cs.phase !== undefined) next.phase = cs.phase;

	for (const u of cs.units ?? []) {
		if (!ID_RE.test(u.id)) {
			errors.push(`unit id "${u.id}" must be lowercase kebab-case`);
			continue;
		}
		const existing = next.units.find((x) => x.id === u.id);
		if (existing) existing.title = u.title;
		else {
			next.units.push({ id: u.id, title: u.title });
			summary.unitsAdded.push(u.id);
		}
	}

	for (const up of cs.nodes ?? []) {
		const existing = next.nodes[up.id];
		if (!existing) {
			if (!up.title) {
				errors.push(`new node "${up.id}" needs a title`);
				continue;
			}
			const n: GraphNode = {
				id: up.id,
				title: up.title,
				kind: up.kind ?? "concept",
				prereqs: [...new Set(up.prereqs ?? [])],
				created: iso(now),
				evidence: [],
			};
			if (up.unit) n.unit = up.unit;
			if (up.summary) n.summary = up.summary;
			if (up.foundational) n.foundational = true;
			if (up.sources?.length) n.sources = up.sources;
			if (up.links?.length) n.links = up.links;
			next.nodes[up.id] = n;
			summary.added.push(up.id);
		} else {
			if (up.title !== undefined) existing.title = up.title;
			if (up.kind !== undefined) existing.kind = up.kind;
			if (up.unit === null) delete existing.unit;
			else if (up.unit !== undefined) existing.unit = up.unit;
			if (up.summary !== undefined) existing.summary = up.summary;
			if (up.prereqs !== undefined) existing.prereqs = [...new Set(up.prereqs)];
			if (up.foundational !== undefined) {
				if (up.foundational) existing.foundational = true;
				else delete existing.foundational;
			}
			if (up.sources !== undefined) existing.sources = up.sources;
			if (up.links !== undefined) existing.links = up.links;
			summary.updated.push(up.id);
		}
	}

	for (const e of cs.add_edges ?? []) {
		const to = next.nodes[e.to];
		if (!to) {
			errors.push(`edge ${e.from} -> ${e.to}: unknown node "${e.to}"`);
			continue;
		}
		if (!to.prereqs.includes(e.from)) {
			to.prereqs.push(e.from);
			summary.edgesAdded++;
		}
	}
	for (const e of cs.remove_edges ?? []) {
		const to = next.nodes[e.to];
		if (to?.prereqs.includes(e.from)) {
			to.prereqs = to.prereqs.filter((p) => p !== e.from);
			summary.edgesRemoved++;
		}
	}

	const removing = new Set(cs.remove ?? []);
	for (const id of removing) {
		if (!next.nodes[id]) {
			errors.push(`can't remove unknown node "${id}"`);
			continue;
		}
		const blockers = Object.values(next.nodes)
			.filter((n) => !removing.has(n.id) && n.prereqs.includes(id))
			.map((n) => n.id);
		if (blockers.length) {
			errors.push(`can't remove "${id}": ${blockers.join(", ")} depend on it (remove those edges too)`);
			continue;
		}
		delete next.nodes[id];
		summary.removed.push(id);
	}

	for (const s of cs.sources ?? []) {
		const rec = next.sources.find((r) => r.file === s.file);
		if (!rec) {
			errors.push(`unknown source "${s.file}" (run sources_scan first)`);
			continue;
		}
		rec.status = s.status;
		if (s.progress !== undefined) rec.progress = s.progress;
		if (s.note !== undefined) rec.note = s.note;
		summary.sourcesUpdated.push(s.file);
	}

	errors.push(...validate(next));
	if (errors.length) throw new Error(`change set rejected:\n- ${[...new Set(errors)].join("\n- ")}`);
	return { graph: next, summary };
}
