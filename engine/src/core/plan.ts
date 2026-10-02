import { ancestors, dependents, descendants, getNode, topoOrder } from "./graph.ts";
import { isDue, isSatisfied, masteryGap, needsRemediation, statuses } from "./mastery.ts";
import type { Goal, Graph, Status } from "./types.ts";
import { calendarDaysBetween, iso, parseYmd } from "./util.ts";

export type Action = "setup" | "probe" | "remediate" | "review" | "teach" | "done";

export interface Recommendation {
	action: Action;
	node?: string;
	title?: string;
	status?: Status;
	reason: string;
}

export interface PlanOptions {
	/** Max reviews to surface before new material. */
	reviewCap?: number;
	count?: number;
}

export function activeGoals(g: Graph): Goal[] {
	return g.goals
		.filter((x) => !x.cleared)
		.sort((a, b) => (a.by ?? "9999").localeCompare(b.by ?? "9999") || a.created.localeCompare(b.created));
}

/** Targets plus every ancestor that isn't yet satisfied, in teaching order. */
export function goalClosure(g: Graph, goal: Goal, st = statuses(g)): string[] {
	const want = new Set<string>();
	for (const t of goal.targets) {
		if (!g.nodes[t]) continue;
		want.add(t);
		for (const a of ancestors(g, t)) want.add(a);
	}
	return topoOrder(g).filter((id) => want.has(id) && st.get(id) !== "solid");
}

export function next(g: Graph, now: Date, opts: PlanOptions = {}): Recommendation[] {
	const reviewCap = opts.reviewCap ?? 4;
	const count = opts.count ?? 5;
	const ids = Object.keys(g.nodes);
	if (g.phase === "setup" || ids.length === 0) {
		return [{ action: "setup", reason: ids.length ? "map drafted but not yet approved" : "no map yet — build it from the goal and sources" }];
	}
	if (g.phase === "placement") {
		const cands = placementCandidates(g, count);
		if (cands.length) return cands;
		return [{ action: "setup", reason: "placement complete — set phase to active" }];
	}

	const st = statuses(g);
	const order = topoOrder(g);
	const pos = new Map(order.map((id, i) => [id, i]));
	const goals = activeGoals(g);
	const goalRank = new Map<string, number>();
	goals.forEach((goal, gi) => {
		for (const id of goalClosure(g, goal, st)) if (!goalRank.has(id)) goalRank.set(id, gi);
	});
	const byPriority = (a: string, b: string) =>
		(goalRank.get(a) ?? 99) - (goalRank.get(b) ?? 99) || pos.get(a)! - pos.get(b)!;
	const ready = (id: string) => getNode(g, id).prereqs.every((p) => isSatisfied(st.get(p)!));
	const title = (id: string) => getNode(g, id).title;
	const goalNote = (id: string) => {
		const gi = goalRank.get(id);
		if (gi === undefined) return "";
		const goal = goals[gi]!;
		return ` — on the path to goal "${goal.note ?? goal.targets.join(", ")}"${goal.by ? ` (by ${goal.by})` : ""}`;
	};

	const out: Recommendation[] = [];

	// 1. Fix what's broken before building on it. Fix the lowest broken node
	//    first: if its prereq is broken too, that prereq comes first.
	const broken = ids.filter((id) => needsRemediation(st.get(id)!) && ready(id)).sort(byPriority);
	for (const id of broken) {
		const s = st.get(id)!;
		const misc = [...getNode(g, id).evidence].reverse().find((e) => e.misconception)?.misconception;
		out.push({
			action: "remediate",
			node: id,
			title: title(id),
			status: s,
			reason: (s === "misconception" ? `misconception to dislodge: "${misc}"` : "last check missed") + goalNote(id),
		});
	}

	// 2. Due reviews (capped so review never eats the session).
	const due = ids
		.filter((id) => isSatisfied(st.get(id)!) && isDue(getNode(g, id), now))
		.sort((a, b) => {
			const ga = goalRank.has(a) ? 0 : 1;
			const gb = goalRank.has(b) ? 0 : 1;
			const aa = st.get(a) === "assumed" ? 1 : 0;
			const ab = st.get(b) === "assumed" ? 1 : 0;
			return ga - gb || aa - ab || Date.parse(getNode(g, a).review!.due) - Date.parse(getNode(g, b).review!.due);
		})
		.slice(0, reviewCap);
	for (const id of due) {
		const s = st.get(id)!;
		const gap = masteryGap(getNode(g, id), now);
		out.push({
			action: "review",
			node: id,
			title: title(id),
			status: s,
			reason: (s === "assumed" ? "assumed from placement — verify directly" : gap ? `due for re-check (${gap})` : "due for re-check") + goalNote(id),
		});
	}

	// 3. New material: unlearned nodes whose prereqs are all satisfied. With an
	//    active goal, only nodes on the goal's path count.
	let teachable = ids.filter((id) => (st.get(id) === "unseen" || st.get(id) === "taught") && ready(id));
	if (goals.length) {
		const onPath = teachable.filter((id) => goalRank.has(id));
		if (onPath.length) teachable = onPath;
	}
	teachable.sort(byPriority);
	for (const id of teachable) {
		const n = getNode(g, id);
		const s = st.get(id)!;
		const base =
			s === "taught" ? "taught but never checked" : n.prereqs.length ? `ready — builds on ${n.prereqs.map(title).join(", ")}` : "ready — foundational";
		out.push({ action: "teach", node: id, title: n.title, status: s, reason: base + goalNote(id) });
	}

	if (out.length === 0) {
		const unsolid = ids.filter((id) => st.get(id) !== "solid").length;
		out.push({
			action: "done",
			reason: unsolid
				? `nothing due — ${unsolid} node(s) are passing and will come back for re-checks on schedule`
				: "every node is solid — add sources or extend the map",
		});
	}
	return out.slice(0, count);
}

/**
 * Placement probing: binary-search the learner's edge. Probe nodes that split
 * the remaining unknowns most evenly (a pass credits ancestors, a miss rules
 * out descendants), so each answer resolves as much of the map as possible.
 */
export function placementCandidates(g: Graph, count = 3): Recommendation[] {
	const st = statuses(g);
	const deps = dependents(g);
	const failed = Object.values(g.nodes).filter((n) => n.evidence.some((e) => e.purpose === "probe" && e.result !== "correct"));
	const ruledOut = new Set<string>();
	for (const n of failed) for (const d of descendants(g, n.id, deps)) ruledOut.add(d);
	const unknown = new Set(
		Object.values(g.nodes)
			.filter((n) => !n.evidence.length && !ruledOut.has(n.id) && st.get(n.id) !== "assumed")
			.map((n) => n.id),
	);
	if (!unknown.size) return [];
	const scored = [...unknown].map((id) => {
		const up = [...ancestors(g, id)].filter((a) => unknown.has(a)).length;
		const down = [...descendants(g, id, deps)].filter((d) => unknown.has(d)).length;
		return { id, score: Math.min(up, down), span: up + down };
	});
	scored.sort((a, b) => b.score - a.score || b.span - a.span || a.id.localeCompare(b.id));
	return scored.slice(0, count).map(({ id, score }) => ({
		action: "probe" as const,
		node: id,
		title: getNode(g, id).title,
		status: st.get(id),
		reason: score > 0 ? "splits the unknown region — a pass credits what's below it, a miss rules out what's above" : "unprobed edge node",
	}));
}

export interface GoalPlan {
	goal: Goal;
	closure: string[];
	days: number;
	perDay: number;
	schedule: { day: number; nodes: string[] }[];
	/** Satisfied but not solid: re-verify before the deadline. */
	refresh: string[];
	warning?: string;
}

export function planGoal(g: Graph, goal: Goal, now: Date): GoalPlan {
	const st = statuses(g);
	const closure = goalClosure(g, goal, st);
	const toLearn = closure.filter((id) => !isSatisfied(st.get(id)!));
	const refresh = closure.filter((id) => isSatisfied(st.get(id)!));
	const days = goal.by ? Math.max(1, calendarDaysBetween(now, parseYmd(goal.by)) + 1) : Math.max(1, Math.ceil(toLearn.length / 4));
	const perDay = Math.ceil(toLearn.length / days) || 0;
	const schedule: { day: number; nodes: string[] }[] = [];
	for (let i = 0; i < toLearn.length; i += Math.max(1, perDay)) {
		schedule.push({ day: schedule.length + 1, nodes: toLearn.slice(i, i + Math.max(1, perDay)) });
	}
	let warning: string | undefined;
	if (perDay > 6) warning = `heavy: about ${perDay} new nodes a day. Consider narrowing the targets or prioritising the most testable nodes.`;
	if (goal.by && calendarDaysBetween(now, parseYmd(goal.by)) < 0) warning = `the deadline ${goal.by} has passed`;
	return { goal, closure, days, perDay, schedule, refresh, warning };
}

export function newGoalId(g: Graph, now: Date): string {
	return `goal-${g.goals.length + 1}-${iso(now).slice(0, 10)}`;
}
