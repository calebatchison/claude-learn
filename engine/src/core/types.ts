// Data model for a learn context (a class folder or a workshop).
//
// graph.json is the single source of truth. map.md / progress.md are generated
// views and are never read back. Mastery is never stored: it is computed from
// the evidence on each node (see mastery.ts), so the record can't drift from
// what actually happened.

export type ContextKind = "class" | "workshop";
export type Phase = "setup" | "placement" | "active";
export type NodeKind = "concept" | "practice";
/** How hard each node is learned. Deep = the full mastery bar; breadth = covered after a clean pass. */
export type Depth = "deep" | "breadth";
/** A class's default depth: all deep, all breadth, or deep for the core and breadth for the outer topics. */
export type ClassStyle = "depth" | "breadth" | "mix";

/**
 * What a piece of evidence tested. Mastery requires passes of 2+ kinds.
 * `derive` = rebuild the node from all of its prerequisites (free response).
 */
export type Check = "recall" | "transfer" | "worked" | "derive";
export type Result = "correct" | "partial" | "wrong";
export type Purpose = "probe" | "check" | "review";
export type Difficulty = "easy" | "medium" | "hard";
/** Self-rated after answering a probe or review. Right + unsure = tentative. */
export type Confidence = "sure" | "unsure";

export interface Evidence {
	at: string; // ISO timestamp
	via: "quiz" | "exercise" | "inferred";
	purpose: Purpose;
	check: Check;
	result: Result;
	/** Probes and reviews only. */
	confidence?: Confidence;
	/** 0 = cold. 1 = a nudge. 2+ = substantial help (doesn't count toward mastery). */
	hints?: number;
	/** Named misconception this answer revealed, e.g. "confuses span with basis". */
	misconception?: string;
	note?: string;
	/** For a derive check: whether each prerequisite link held. */
	links?: LinkResult[];
	/** For an exercise: how hard the problem was. */
	difficulty?: Difficulty;
	/** Quiz / exercise id that produced it. */
	ref?: string;
}

export interface LinkResult {
	from: string; // prereq id
	ok: boolean;
}

/** A map-time decision overriding a node's depth. */
export interface DepthRule {
	depth: Depth;
	reason: string;
	at: string;
}

/** A map-time decision overriding whether a node needs a derive pass. */
export interface DeriveRule {
	required: boolean;
	reason: string;
	at: string;
}

export interface SourceRef {
	file: string; // relative to the context root
	page?: string; // "4" or "4-6"
	note?: string;
}

export interface GraphNode {
	id: string;
	title: string;
	kind: NodeKind;
	unit?: string;
	summary?: string;
	/** Ids of nodes this one is built on. Edges point prereq -> node. */
	prereqs: string[];
	/** An unconditional truth the lesson is founded on (a root of the teaching order). */
	foundational?: boolean;
	sources?: SourceRef[];
	/** External links, e.g. a LeetCode problem URL for a practice node. */
	links?: string[];
	created: string;
	/** Timestamps when the node was taught. */
	taught?: string[];
	evidence: Evidence[];
	review?: { interval: number; due: string };
	/** Overrides of the derive requirement, oldest first; the last one wins. */
	deriveRules?: DeriveRule[];
	/** Overrides of the class's default depth, oldest first; the last one wins. */
	depthRules?: DepthRule[];
}

export interface Unit {
	id: string;
	title: string;
}

export interface Goal {
	id: string;
	targets: string[];
	by?: string; // YYYY-MM-DD
	note?: string;
	created: string;
	cleared?: string;
}

export type SourceStatus = "new" | "partial" | "ingested" | "skipped";

export interface SourceRecord {
	file: string;
	sha256: string;
	added: string;
	status: SourceStatus;
	/** Free text, e.g. "chapters 1-3 ingested". */
	progress?: string;
	note?: string;
}

export interface SessionRecord {
	id: string;
	file: string; // relative to root
	started: string;
	ended?: string;
	title: string;
	summary?: string;
}

export interface Graph {
	schema: 1;
	kind: ContextKind;
	name: string;
	goal: string;
	created: string;
	phase: Phase;
	/** Absent = "depth". */
	style?: ClassStyle;
	units: Unit[];
	nodes: Record<string, GraphNode>;
	goals: Goal[];
	sources: SourceRecord[];
	sessions: SessionRecord[];
}

export type Status =
	| "unseen" // nothing known
	| "assumed" // inferred known from a harder probe; never directly checked
	| "taught" // taught, not yet checked
	| "shaky" // last check wrong or partial
	| "misconception" // last check revealed a named wrong model
	| "passing" // last check right, mastery bar not yet met
	| "solid"; // passed 2+ kinds of check, and survived a delayed re-check

export interface QuizOption {
	label: string;
	description?: string;
	/** For a distractor: the misconception someone picking it holds. */
	misconception?: string;
}

export interface Quiz {
	id: string;
	node?: string;
	question: string;
	context?: string;
	options: QuizOption[];
	correct: number[];
	explanation?: string;
	multi: boolean;
	purpose: Purpose;
	check: Check;
	infer: boolean;
	created: string;
}

export type ExerciseMode = "chat" | "paper" | "external";

export interface Exercise {
	id: string;
	node?: string;
	prompt: string;
	solution: string;
	rubric?: string;
	mode: ExerciseMode;
	link?: string;
	purpose: Purpose;
	check: Check;
	/** For a derive exercise: the prereq ids the rubric covers (all of them). */
	covers?: string[];
	difficulty?: Difficulty;
	assigned: string;
	status: "pending" | "submitted";
	submitted?: string;
	result?: Result;
	hints?: number;
	feedback?: string;
	submission?: string;
}

export interface AssessState {
	counter: { quiz: number; exercise: number };
	quizzes: Record<string, Quiz>;
	exercises: Record<string, Exercise>;
}
