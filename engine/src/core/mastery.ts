import { ancestors, getNode } from "./graph.ts";
import type { Check, Evidence, Graph, GraphNode, Status } from "./types.ts";
import { addDays, DAY_MS, iso } from "./util.ts";

/**
 * The mastery bar. A node is solid only when, since its last failure, the
 * learner has:
 *   - passed at least MIN_CHECK_KINDS different kinds of check (recall,
 *     transfer, worked problem, derive), with at most one hint each, AND
 *   - passed again at least DELAYED_RECHECK_MS after the first of those passes
 *     (it survived a delayed re-check, so it isn't just short-term memory), AND
 *   - passed at least one generative check (an exercise: they produced the
 *     answer rather than picking it), AND
 *   - if the node requires it, passed a derive check that rebuilt it from all
 *     of its current prerequisites.
 */
export const MIN_CHECK_KINDS = 2;
export const DELAYED_RECHECK_MS = 20 * 3600_000;
export const MAX_INTERVAL_DAYS = 90;
const ASSUMED_FIRST_REVIEW_DAYS = 5;

/**
 * Right but unsure: a weak pass. It neither counts toward mastery nor breaks
 * a run — the node keeps the status it had — and it brings the review closer.
 */
export const isTentative = (e: Evidence) => e.result === "correct" && e.confidence === "unsure";
/** Direct evidence that decides status: not inferred, not tentative. */
const isReal = (e: Evidence) => e.via !== "inferred" && !isTentative(e);
/** A pass that counts toward mastery: correct and essentially unassisted. */
const isCleanPass = (e: Evidence) => e.result === "correct" && (e.hints ?? 0) <= 1;
/** The learner produced the answer rather than picking it. */
const isGenerative = (e: Evidence) => e.via === "exercise";

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
	return meetsMasteryBar(n, real) ? "solid" : "passing";
}

/** Default: concept nodes built on something need a derive pass. */
export function defaultRequiresDerive(n: GraphNode): boolean {
	return n.kind === "concept" && !n.foundational && n.prereqs.length > 0;
}

/** Whether a derive pass is required, after any map-time override. */
export function requiresDerive(n: GraphNode): boolean {
	const rule = n.deriveRules?.at(-1);
	if (rule) return rule.required && n.prereqs.length > 0;
	return defaultRequiresDerive(n);
}

/** A derive pass whose links cover every current prereq. */
function coversPrereqs(n: GraphNode, e: Evidence): boolean {
	const ok = new Set((e.links ?? []).filter((l) => l.ok).map((l) => l.from));
	return n.prereqs.every((p) => ok.has(p));
}

/** Clean passes since the last miss. */
function cleanRun(real: Evidence[]): Evidence[] {
	let lastFail = -1;
	real.forEach((e, i) => {
		if (e.result !== "correct") lastFail = i;
	});
	return real.slice(lastFail + 1).filter(isCleanPass);
}

type Missing = { kinds?: Check[]; delayed?: true; generative?: true; derive?: true };

function missingForMastery(n: GraphNode, real: Evidence[]): Missing {
	const run = cleanRun(real);
	const out: Missing = {};
	const kinds = new Set<Check>(run.map((e) => e.check));
	if (kinds.size < MIN_CHECK_KINDS) out.kinds = (["recall", "transfer", "worked", "derive"] as Check[]).filter((k) => !kinds.has(k));
	const first = run[0] ? Date.parse(run[0].at) : Number.POSITIVE_INFINITY;
	if (!run.some((e) => Date.parse(e.at) - first >= DELAYED_RECHECK_MS)) out.delayed = true;
	if (requiresDerive(n) && !run.some((e) => e.check === "derive" && coversPrereqs(n, e))) out.derive = true;
	// A derive pass is an exercise, so it satisfies this too.
	else if (!run.some(isGenerative)) out.generative = true;
	return out;
}

function meetsMasteryBar(n: GraphNode, real: Evidence[]): boolean {
	return Object.keys(missingForMastery(n, real)).length === 0;
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
export function masteryGap(n: GraphNode, _now?: Date): string | undefined {
	const s = status(n);
	if (s === "solid") return undefined;
	if (s !== "passing") return undefined;
	const m = missingForMastery(n, n.evidence.filter(isReal));
	const needs: string[] = [];
	if (m.derive) needs.push(`a derive check rebuilding it from ${n.prereqs.join(", ")}`);
	// A derive pass is also a new kind of check, so it may close both gaps.
	const have = 4 - (m.kinds?.length ?? 0);
	if (m.kinds && !(m.derive && have + 1 >= MIN_CHECK_KINDS)) needs.push(`a ${m.kinds.join(" or ")} check`);
	if (m.generative) needs.push(`a free-response exercise (${n.kind === "practice" ? "solving it" : "stating or working it themselves"})`);
	if (m.delayed) needs.push("a re-check on a later day");
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
	if (isTentative(ev)) {
		// Hold the interval; come back in half of it.
		const interval = Math.max(cur, 1);
		n.review = { interval, due: iso(addDays(now, Math.max(1, Math.floor(interval / 2)))) };
		return;
	}
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
