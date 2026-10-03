import { ancestors, getNode, nodeDepths } from "./graph.ts";
import type { Check, Depth, Evidence, Graph, GraphNode, Status } from "./types.ts";
import { addDays, DAY_MS, iso, ymd } from "./util.ts";

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
/** Breadth nodes have no ongoing reviews: one follow-up check after a miss, then none. */
export const FOLLOWUP_DAYS = 3;

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

/**
 * A node's status. A breadth node is done ("covered", shown as such) once its
 * last direct check was a clean pass; internally that is `solid`, so planning
 * treats it as finished.
 */
export function status(n: GraphNode, depth: Depth = "deep"): Status {
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
	if (depth === "breadth") return isCleanPass(last) ? "solid" : "passing";
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
	const depths = nodeDepths(g);
	return new Map(Object.values(g.nodes).map((n) => [n.id, status(n, depths.get(n.id)?.depth)]));
}

/** What the learner still needs for this node to count as solid. */
export function masteryGap(n: GraphNode, _now?: Date, depth: Depth = "deep"): string | undefined {
	const s = status(n, depth);
	if (s !== "passing") return undefined;
	if (depth === "breadth") return "needs a pass without heavy hints to count as covered";
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
export function record(n: GraphNode, ev: Evidence, now: Date, depth: Depth = "deep"): void {
	if (depth === "breadth") return recordBreadth(n, ev, now);
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

/**
 * Breadth: no spaced reviews. A miss comes back for remediation, and the pass
 * that fixes it gets a single follow-up check; a clean pass otherwise clears
 * any scheduled review.
 */
function recordBreadth(n: GraphNode, ev: Evidence, now: Date): void {
	const prev = n.evidence.filter(isReal).at(-1);
	n.evidence.push(ev);
	const followUp = (days: number) => {
		n.review = { interval: days, due: iso(addDays(now, days)) };
	};
	if (ev.result === "wrong") n.review = { interval: 0, due: iso(now) };
	else if (!isCleanPass(ev)) followUp(1);
	else if (prev && prev.result !== "correct") followUp(FOLLOWUP_DAYS);
	else delete n.review;
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

/** How far implicit credit reaches below a node, and how much each level gets. */
export const IMPLICIT_DEPTH = 3;
const IMPLICIT_SHARE = (depth: number) => 0.5 ** depth;

/**
 * A clean, cold pass on a node exercises the ideas under it, so push back
 * their next reviews: by 50% of the prereq's interval one level down, 25% two
 * levels down, 12.5% three levels down (the shortest route wins). Due dates
 * only — it never adds evidence, so prereqs still need direct checks to become
 * solid, and a push never lands later than a fresh full interval from now.
 *
 * Cold = a review, or a pass on a later day than the node was last taught:
 * the check right after a lesson doesn't count, because the prereqs were just
 * recalled during it. Returns the ids whose reviews moved.
 */
export function creditPrereqs(g: Graph, id: string, ev: Evidence, now: Date): string[] {
	if (!isCleanPass(ev) || isTentative(ev) || ev.via === "inferred" || ev.purpose === "probe") return [];
	const n = getNode(g, id);
	const lastTaught = n.taught?.at(-1);
	const cold = ev.purpose === "review" || (lastTaught !== undefined && ymd(new Date(lastTaught)) !== ymd(now));
	if (!cold) return [];

	// Breadth-first, so each ancestor is reached first by its shortest route.
	const depth = new Map<string, number>();
	let frontier = [id];
	for (let d = 1; d <= IMPLICIT_DEPTH && frontier.length; d++) {
		const nextFrontier: string[] = [];
		for (const f of frontier) {
			for (const p of getNode(g, f).prereqs) {
				if (p === id || depth.has(p)) continue;
				depth.set(p, d);
				nextFrontier.push(p);
			}
		}
		frontier = nextFrontier;
	}

	const moved: string[] = [];
	for (const [pid, d] of depth) {
		const p = getNode(g, pid);
		const s = status(p);
		// Assumed nodes still need their first direct check; broken ones need fixing.
		if (s !== "passing" && s !== "solid") continue;
		if (!p.review || p.review.interval <= 0) continue;
		const due = Date.parse(p.review.due);
		const cap = addDays(now, p.review.interval).getTime();
		const pushed = Math.min(due + IMPLICIT_SHARE(d) * p.review.interval * DAY_MS, cap);
		if (pushed <= due) continue;
		p.review = { interval: p.review.interval, due: iso(new Date(pushed)) };
		moved.push(pid);
	}
	return moved;
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
