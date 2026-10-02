import { dependents, topoOrder } from "./graph.ts";
import { atRisk, isDue, masteryGap, statuses } from "./mastery.ts";
import { activeGoals, next, planGoal } from "./plan.ts";
import type { Exercise, Graph, Status } from "./types.ts";

// Obsidian draws Mermaid at natural size in a fixed-width note, and its themes
// can override classDef colours. So: keep every diagram small (no unit
// subgraphs — they explode the layout), and put status in the label itself
// as an emoji, which survives any theme. Colours are a bonus on top.
const FULL_GRAPH_MAX = 12;
const DIAGRAM_MAX = 14;

const STATUS_ORDER: Status[] = ["solid", "passing", "assumed", "taught", "shaky", "misconception", "unseen"];

const ICON: Record<Status, string> = {
	solid: "✅",
	passing: "🟢",
	assumed: "🔵",
	taught: "🟡",
	shaky: "🟠",
	misconception: "🔴",
	unseen: "⚪",
};

const INIT = '%%{init: {"flowchart": {"useMaxWidth": true, "nodeSpacing": 30, "rankSpacing": 40}}}%%';

const CLASS_DEFS = [
	"classDef solid fill:#2e7d32,stroke:#1b5e20,color:#ffffff",
	"classDef passing fill:#a5d6a7,stroke:#2e7d32,color:#1b1b1b",
	"classDef assumed fill:#e3f2fd,stroke:#64b5f6,color:#1b1b1b,stroke-dasharray:4 3",
	"classDef taught fill:#fff59d,stroke:#f9a825,color:#1b1b1b",
	"classDef shaky fill:#ffcc80,stroke:#ef6c00,color:#1b1b1b",
	"classDef misconception fill:#ef9a9a,stroke:#c62828,color:#1b1b1b",
	"classDef unseen fill:#eeeeee,stroke:#9e9e9e,color:#424242",
	"classDef ext fill:none,stroke:#9e9e9e,color:#9e9e9e,stroke-dasharray:3 3",
	"classDef next stroke:#1565c0,stroke-width:4px",
];

const LEGEND = `**Legend:** ${STATUS_ORDER.map((s) => `${ICON[s]} ${s === "taught" ? "taught, unchecked" : s === "passing" ? "passing (not yet re-verified)" : s}`).join(" · ")} · ▶ next up`;

const mid = (id: string) => "n_" + id.replace(/[^a-zA-Z0-9_]/g, "_");

/**
 * Notes are tall and narrow: lay a diagram out top-down unless it's wider
 * (most nodes on one level) than it is deep, then left-to-right.
 */
function direction(nodes: string[], edges: [string, string][]): "TD" | "LR" {
	const level = new Map<string, number>();
	const lv = (n: string, guard = new Set<string>()): number => {
		if (level.has(n)) return level.get(n)!;
		if (guard.has(n)) return 0;
		guard.add(n);
		const ins = edges.filter(([, b]) => b === n).map(([a]) => a);
		const v = ins.length ? 1 + Math.max(...ins.map((a) => lv(a, guard))) : 0;
		level.set(n, v);
		return v;
	};
	const counts = new Map<number, number>();
	for (const n of nodes) counts.set(lv(n), (counts.get(lv(n)) ?? 0) + 1);
	const width = Math.max(...counts.values());
	const depth = counts.size;
	return width > depth + 1 ? "LR" : "TD";
}
const label = (s: string) => s.replace(/"/g, "#quot;").replace(/[<>]/g, "");

/**
 * One small flowchart. `ext` nodes are prerequisites from outside the set,
 * drawn dashed so you can see where this piece attaches.
 */
function mermaid(g: Graph, ids: Set<string>, st: Map<string, Status>, nextId: string | undefined, ext = new Set<string>()): string {
	const all = new Set([...ids, ...ext]);
	const edges: [string, string][] = [];
	for (const id of ids) for (const p of g.nodes[id]!.prereqs) if (all.has(p)) edges.push([p, id]);
	const lines = ["```mermaid", INIT, `graph ${direction([...all], edges)}`];
	for (const id of [...ids, ...ext]) {
		const n = g.nodes[id]!;
		const isExt = ext.has(id) && !ids.has(id);
		const prefix = id === nextId ? "▶ " : isExt ? "↑ " : "";
		lines.push(`  ${mid(id)}["${prefix}${ICON[st.get(id)!]} ${label(n.title)}"]`);
	}
	for (const [p, id] of edges) lines.push(`  ${mid(p)} ${ext.has(p) && !ids.has(p) ? "-.->" : "-->"} ${mid(id)}`);
	lines.push(...CLASS_DEFS.map((c) => "  " + c));
	for (const s of STATUS_ORDER) {
		const members = [...ids].filter((id) => st.get(id) === s);
		if (members.length) lines.push(`  class ${members.map(mid).join(",")} ${s}`);
	}
	const extOnly = [...ext].filter((id) => !ids.has(id));
	if (extOnly.length) lines.push(`  class ${extOnly.map(mid).join(",")} ext`);
	if (nextId && ids.has(nextId)) lines.push(`  class ${mid(nextId)} next`);
	lines.push("```");
	return lines.join("\n");
}

function unitStatus(ss: Status[]): Status {
	if (ss.some((s) => s === "misconception")) return "misconception";
	if (ss.some((s) => s === "shaky")) return "shaky";
	if (ss.every((s) => s === "solid")) return "solid";
	if (ss.every((s) => s === "solid" || s === "passing" || s === "assumed")) return "passing";
	if (ss.some((s) => s !== "unseen")) return "taught";
	return "unseen";
}

/** Units as nodes, with only the edges that aren't implied by others (transitive reduction). */
function unitOverview(g: Graph, st: Map<string, Status>, nextUnit: string | undefined): string {
	const unitOf = (id: string) => g.nodes[id]!.unit ?? "_none";
	const units = [...g.units];
	if (Object.values(g.nodes).some((n) => !n.unit)) units.push({ id: "_none", title: "Unsorted" });
	const present = units.filter((u) => Object.values(g.nodes).some((n) => unitOf(n.id) === u.id));
	const adj = new Map<string, Set<string>>(present.map((u) => [u.id, new Set()]));
	for (const n of Object.values(g.nodes)) for (const p of n.prereqs) if (unitOf(p) !== unitOf(n.id)) adj.get(unitOf(p))?.add(unitOf(n.id));
	const reach = (from: string, skip: string): boolean => {
		const stack = [...adj.get(from)!].filter((x) => x !== skip);
		const seen = new Set<string>();
		while (stack.length) {
			const cur = stack.pop()!;
			if (cur === skip) return true;
			if (seen.has(cur)) continue;
			seen.add(cur);
			stack.push(...(adj.get(cur) ?? []));
		}
		return false;
	};
	const kept: [string, string][] = [];
	for (const [a, outs] of adj) for (const b of outs) if (!reach(a, b)) kept.push([a, b]);
	const lines = ["```mermaid", INIT, `graph ${direction(present.map((u) => u.id), kept)}`];
	const cls = new Map<Status, string[]>();
	for (const u of present) {
		const ss = Object.values(g.nodes).filter((n) => unitOf(n.id) === u.id).map((n) => st.get(n.id)!);
		const known = ss.filter((s) => s === "solid" || s === "passing" || s === "assumed").length;
		const us = unitStatus(ss);
		cls.set(us, [...(cls.get(us) ?? []), mid("u_" + u.id)]);
		lines.push(`  ${mid("u_" + u.id)}["${u.id === nextUnit ? "▶ " : ""}${ICON[us]} ${label(u.title)} · ${known}/${ss.length}"]`);
	}
	for (const [a, b] of kept) lines.push(`  ${mid("u_" + a)} --> ${mid("u_" + b)}`);
	lines.push(...CLASS_DEFS.map((c) => "  " + c));
	for (const [s, ms] of cls) lines.push(`  class ${ms.join(",")} ${s}`);
	lines.push("```");
	return lines.join("\n");
}

/** Next up, what it rests on, what it unlocks, and anything broken — capped small. */
function focusSet(g: Graph, st: Map<string, Status>, nextId: string | undefined): Set<string> {
	const ids = new Set<string>();
	const deps = dependents(g);
	const add = (id: string) => ids.size < DIAGRAM_MAX && ids.add(id);
	if (nextId) {
		add(nextId);
		for (const p of g.nodes[nextId]!.prereqs) add(p);
		for (const d of deps.get(nextId) ?? []) add(d);
		for (const p of g.nodes[nextId]!.prereqs) for (const pp of g.nodes[p]!.prereqs) add(pp);
	}
	for (const [id, s] of st) if (s === "shaky" || s === "misconception") add(id);
	return ids;
}

export function renderMap(g: Graph, now: Date): string {
	const st = statuses(g);
	const recs = next(g, now, { count: 1 });
	const nextId = recs[0]?.node;
	const total = Object.keys(g.nodes).length;
	const out = [`# ${g.name} — map`, "", `> Generated from \`graph.json\` — don't edit by hand. Updated ${now.toLocaleString()}.`, "", LEGEND, ""];
	if (!total) return [...out, "_No map yet._", ""].join("\n");

	const counts = STATUS_ORDER.map((s) => [s, [...st.values()].filter((x) => x === s).length] as const).filter(([, c]) => c);
	out.push(`**${total} nodes:** ${counts.map(([s, c]) => `${ICON[s]} ${c} ${s}`).join(" · ")}`, "");
	if (nextId) out.push(`**Next up:** ${g.nodes[nextId]!.title} — ${recs[0]!.reason}`, "");

	if (total <= FULL_GRAPH_MAX) {
		out.push("## Map", "", mermaid(g, new Set(Object.keys(g.nodes)), st, nextId), "");
		return out.join("\n");
	}

	const focus = focusSet(g, st, nextId);
	if (focus.size > 1) out.push("## Focus", "", "_Next up, what it rests on, what it unlocks, and anything that needs fixing._", "", mermaid(g, focus, st, nextId), "");
	if (g.units.length) {
		out.push("## Units", "", "_Each unit's progress (known / total). Arrows: a unit builds on another._", "", unitOverview(g, st, nextId ? g.nodes[nextId]!.unit : undefined), "");
	}
	for (const u of [...g.units, { id: "_none", title: "Unsorted" }]) {
		const members = Object.values(g.nodes)
			.filter((n) => (n.unit ?? "_none") === u.id)
			.map((n) => n.id);
		if (!members.length) continue;
		const order = topoOrder(g).filter((id) => members.includes(id));
		out.push(`### ${u.title}`, "");
		// Big units are listed rather than drawn; a 30-node diagram doesn't read.
		if (order.length > DIAGRAM_MAX) {
			for (const id of order) out.push(`- ${id === nextId ? "▶ " : ""}${ICON[st.get(id)!]} ${g.nodes[id]!.title}`);
			out.push("");
			continue;
		}
		const ids = new Set(order);
		const ext = new Set<string>();
		for (const id of ids) for (const p of g.nodes[id]!.prereqs) if (!ids.has(p)) ext.add(p);
		out.push(mermaid(g, ids, st, nextId, ext), "");
	}
	return out.join("\n");
}

export function renderProgress(g: Graph, pending: Exercise[], now: Date): string {
	const st = statuses(g);
	const title = (id: string) => g.nodes[id]?.title ?? id;
	const out = [`# ${g.name} — progress`, "", `> Generated — don't edit by hand. Updated ${now.toLocaleString()}.`, ""];
	out.push(`**Goal:** ${g.goal}`, "", `**Phase:** ${g.phase}`, "");

	out.push("## Next up", "");
	for (const r of next(g, now, { count: 6 })) {
		out.push(`- **${r.action}**${r.node ? ` — ${title(r.node)}` : ""}: ${r.reason}`);
	}
	out.push("");

	const goals = activeGoals(g);
	if (goals.length) {
		out.push("## Active goals", "");
		for (const goal of goals) {
			const p = planGoal(g, goal, now);
			out.push(`### ${goal.note ?? goal.targets.map(title).join(", ")}${goal.by ? ` — by ${goal.by}` : ""}`, "");
			if (p.warning) out.push(`> ⚠️ ${p.warning}`, "");
			for (const day of p.schedule) out.push(`- Day ${day.day}: ${day.nodes.map(title).join(", ")}`);
			if (p.refresh.length) out.push(`- Re-verify before the deadline: ${p.refresh.map(title).join(", ")}`);
			if (!p.schedule.length && !p.refresh.length) out.push("- Everything on this path is solid.");
			out.push("");
		}
	}

	const broken = [...st].filter(([, s]) => s === "shaky" || s === "misconception");
	const risky = atRisk(g, st);
	if (broken.length || risky.length) {
		out.push("## Needs attention", "");
		for (const [id, s] of broken) {
			const misc = [...g.nodes[id]!.evidence].reverse().find((e) => e.misconception)?.misconception;
			out.push(`- **${title(id)}** — ${s}${misc ? `: "${misc}"` : ""}`);
		}
		for (const id of risky) out.push(`- ${title(id)} — at risk (rests on something shaky)`);
		out.push("");
	}

	const due = Object.values(g.nodes).filter((n) => isDue(n, now) && ["passing", "solid", "assumed"].includes(st.get(n.id)!));
	if (due.length) {
		out.push(`## Due for review (${due.length})`, "");
		for (const n of due.slice(0, 20)) out.push(`- ${n.title} (${st.get(n.id)})`);
		if (due.length > 20) out.push(`- …and ${due.length - 20} more`);
		out.push("");
	}

	const almost = Object.values(g.nodes)
		.map((n) => [n, masteryGap(n, now)] as const)
		.filter(([, gap]) => gap);
	if (almost.length) {
		out.push("## Passing — not yet solid", "");
		for (const [n, gap] of almost.slice(0, 15)) out.push(`- ${n.title}: ${gap}`);
		out.push("");
	}

	if (pending.length) {
		out.push("## Open exercises", "");
		for (const ex of pending) {
			out.push(`- \`${ex.id}\` (${ex.mode}${ex.node ? `, ${title(ex.node)}` : ""}): ${ex.prompt.split("\n")[0]!.slice(0, 120)}`);
		}
		out.push("");
	}

	if (g.units.length) {
		out.push("## Units", "", "| Unit | Solid | Passing | Learning | Unseen |", "|---|---|---|---|---|");
		for (const u of g.units) {
			const ss = Object.values(g.nodes)
				.filter((n) => n.unit === u.id)
				.map((n) => st.get(n.id)!);
			if (!ss.length) continue;
			const c = (f: (s: Status) => boolean) => ss.filter(f).length;
			out.push(
				`| ${u.title} | ${c((s) => s === "solid")} | ${c((s) => s === "passing" || s === "assumed")} | ${c((s) => s === "taught" || s === "shaky" || s === "misconception")} | ${c((s) => s === "unseen")} |`,
			);
		}
		out.push("");
	}

	if (g.sources.length) {
		out.push("## Sources", "");
		for (const s of g.sources) out.push(`- \`${s.file}\` — ${s.status}${s.progress ? ` (${s.progress})` : ""}`);
		out.push("");
	}

	const recent = g.sessions.slice(-5).reverse();
	if (recent.length) {
		out.push("## Recent sessions", "");
		for (const s of recent) out.push(`- [${s.started.slice(0, 10)} — ${s.title}](${s.file})${s.summary ? `: ${s.summary}` : ""}`);
		out.push("");
	}
	return out.join("\n");
}

/** Compact one-line-per-node listing for the model. */
export function listNodes(g: Graph, ids?: Iterable<string>): string {
	const st = statuses(g);
	const order = topoOrder(g);
	const want = ids ? new Set(ids) : undefined;
	return order
		.filter((id) => !want || want.has(id))
		.map((id) => {
			const n = g.nodes[id]!;
			const bits = [`${id} | ${n.title} | ${st.get(id)}`];
			if (n.unit) bits.push(`unit=${n.unit}`);
			if (n.kind !== "concept") bits.push(n.kind);
			if (n.foundational) bits.push("foundational");
			if (n.prereqs.length) bits.push(`after=${n.prereqs.join(",")}`);
			return bits.join(" | ");
		})
		.join("\n");
}

