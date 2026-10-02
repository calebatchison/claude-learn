import { ancestors, getNode } from "./graph.ts";
import type { Check, Evidence, Graph, GraphNode, Status } from "./types.ts";
import { addDays, DAY_MS, iso } from "./util.ts";

/**
 * The mastery bar. A node is solid only when, since its last failure, the
 * learner has:
 *   - passed at least MIN_CHECK_KINDS different kinds of check (recall,
 *     transfer, worked problem), with at most one hint each, AND
 *   - passed again at least DELAYED_RECHECK_MS after the first of those passes
 *     (it survived a delayed re-check, so it isn't just short-term memory).
 */
export const MIN_CHECK_KINDS = 2;
export const DELAYED_RECHECK_MS = 20 * 3600_000;
export const MAX_INTERVAL_DAYS = 90;
const ASSUMED_FIRST_REVIEW_DAYS = 5;

const isReal = (e: Evidence) => e.via !== "inferred";
/** A pass that counts toward mastery: correct and essentially unassisted. */
const isCleanPass = (e: Evidence) => e.result === "correct" && (e.hints ?? 0) <= 1;

export function status(n: GraphNode): Status {
	const real = n.evidence.filter(isReal);
	if (real.length === 0) {
		if (n.evidence.some((e) => e.via === "inferred" && e.result === "correct")) return "assumed";
		return n.taught?.length ? "taught" : "unseen";
	}
	const last = real[real.length - 1]!;
	if (last.result !== "correct") {
		if (last.misconception) return "misconception";
		// Failing a placement probe on something never taught just means "not
		// known yet" — teach it normally rather than treating it as a lapse.
		const onlyProbes = real.every((e) => e.purpose === "probe");
		if (onlyProbes && !n.taught?.length) return "unseen";
		return "shaky";
	}
	return meetsMasteryBar(real) ? "solid" : "passing";
}

function meetsMasteryBar(real: Evidence[]): boolean {
	let lastFail = -1;
	real.forEach((e, i) => {
		if (e.result !== "correct") lastFail = i;
	});
	const run = real.slice(lastFail + 1).filter(isCleanPass);
	if (run.length < 2) return false;
	const kinds = new Set<Check>(run.map((e) => e.check));
	if (kinds.size < MIN_CHECK_KINDS) return false;
	const first = Date.parse(run[0]!.at);
	return run.some((e) => Date.parse(e.at) - first >= DELAYED_RECHECK_MS);
}

/** Counts as known for unlocking dependents. */
export function isSatisfied(s: Status): boolean {
	return s === "passing" || s === "solid" || s === "assumed";
}

export function needsRemediation(s: Status): boolean {
	return s === "shaky" || s === "misconception";
}

export function statuses(g: Graph): Map<string, Status> {
	return new Map(Object.values(g.nodes).map((n) => [n.id, status(n)]));
}

/** What the learner still needs for this node to count as solid. */
export function masteryGap(n: GraphNode, now: Date): string | undefined {
	const s = status(n);
	if (s === "solid") return undefined;
	if (s !== "passing") return undefined;
	const real = n.evidence.filter(isReal);
	let lastFail = -1;
	real.forEach((e, i) => {
		if (e.result !== "correct") lastFail = i;
	});
	const run = real.slice(lastFail + 1).filter(isCleanPass);
	const kinds = new Set(run.map((e) => e.check));
	const needs: string[] = [];
	if (kinds.size < MIN_CHECK_KINDS) {
		const missing = (["recall", "transfer", "worked"] as Check[]).filter((k) => !kinds.has(k));
		needs.push(`a ${missing.join(" or ")} check`);
	}
	const first = run[0] ? Date.parse(run[0].at) : now.getTime();
	if (!run.some((e) => Date.parse(e.at) - first >= DELAYED_RECHECK_MS)) needs.push("a re-check on a later day");
	return needs.length ? `needs ${needs.join(" and ")}` : undefined;
}

/**
 * Record a result on a node and reschedule its next review.
 *
 * Intervals grow only when the node was actually due, so a second check in
 * the same session doesn't inflate the schedule.
 */
export function record(n: GraphNode, ev: Evidence, now: Date): void {
	n.evidence.push(ev);
	const cur = n.review?.interval ?? 0;
	const wasDue = !n.review || Date.parse(n.review.due) - now.getTime() <= DAY_MS / 2;
	const hints = ev.hints ?? 0;
	let interval: number;
	if (ev.result === "wrong") interval = 0;
	else if (ev.result === "partial" || hints >= 2) interval = Math.max(1, Math.floor(cur / 2));
	else if (!wasDue) interval = Math.max(cur, 1);
	else if (cur === 0) interval = 1;
	else interval = Math.min(MAX_INTERVAL_DAYS, Math.round(cur * (hints ? 1.6 : 2.5)));
	n.review = { interval, due: iso(addDays(now, interval)) };
}

export function markTaught(n: GraphNode, now: Date): void {
	n.taught = [...(n.taught ?? []), iso(now)];
}

/**
 * After a correct placement probe on `id`, credit its unchecked ancestors as
 * "assumed" — you can't do the hard thing without the easy things under it.
 * Assumed nodes get a light verification review later. Returns ids credited.
 */
export function inferAncestors(g: Graph, id: string, now: Date, ref?: string): string[] {
	const credited: string[] = [];
	for (const a of ancestors(g, id)) {
		const n = getNode(g, a);
		if (n.evidence.some(isReal) || n.evidence.some((e) => e.via === "inferred")) continue;
		n.evidence.push({ at: iso(now), via: "inferred", purpose: "probe", check: "recall", result: "correct", ref, note: `inferred from ${id}` });
		n.review = { interval: ASSUMED_FIRST_REVIEW_DAYS, due: iso(addDays(now, ASSUMED_FIRST_REVIEW_DAYS)) };
		credited.push(a);
	}
	return credited;
}

export function isDue(n: GraphNode, now: Date): boolean {
	return !!n.review && Date.parse(n.review.due) <= now.getTime();
}

/** Satisfied nodes resting on a prereq that has since become shaky. */
export function atRisk(g: Graph, st = statuses(g)): string[] {
	return Object.values(g.nodes)
		.filter((n) => isSatisfied(st.get(n.id)!) && n.prereqs.some((p) => needsRemediation(st.get(p)!)))
		.map((n) => n.id);
}
