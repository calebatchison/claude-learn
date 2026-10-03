import { depthOf, getNode } from "./graph.ts";
import { creditPrereqs, inferAncestors, record, status } from "./mastery.ts";
import type { AssessState, Check, Confidence, Evidence, Exercise, ExerciseMode, Graph, LinkResult, Purpose, Quiz, QuizOption, Result, Status } from "./types.ts";
import { latexToUnicode } from "./plaintext.ts";
import { iso, letter } from "./util.ts";

export interface QuizInput {
	node?: string;
	question: string;
	context?: string;
	options: QuizOption[];
	correct: number[];
	explanation?: string;
	purpose?: Purpose;
	check?: Check;
	infer?: boolean;
}

export function createQuiz(a: AssessState, g: Graph | undefined, input: QuizInput, now: Date): Quiz {
	if (input.options.length < 2) throw new Error("a quiz needs at least 2 options");
	if (!input.correct.length) throw new Error("mark at least one option correct");
	for (const i of input.correct) {
		if (!Number.isInteger(i) || i < 0 || i >= input.options.length) throw new Error(`correct index ${i} is out of range (0-${input.options.length - 1})`);
	}
	if (input.check === "derive") throw new Error("a derive check is free response: use exercise_assign with check: \"derive\"");
	if (input.node && g) getNode(g, input.node);
	a.counter.quiz++;
	const purpose = input.purpose ?? "check";
	const quiz: Quiz = {
		id: `q${a.counter.quiz}`,
		node: input.node,
		question: input.question,
		context: input.context,
		options: input.options,
		correct: [...new Set(input.correct)].sort((x, y) => x - y),
		explanation: input.explanation,
		multi: input.correct.length > 1,
		purpose,
		check: input.check ?? "recall",
		infer: input.infer ?? purpose === "probe",
		created: iso(now),
	};
	a.quizzes[quiz.id] = quiz;
	return quiz;
}

/**
 * Resolve the learner's selection to option indexes. Accepts exact labels,
 * letters ("B"), or "B. label" as shown in the picker.
 */
export function resolveSelection(quiz: Quiz, selected: string[]): number[] {
	const out = new Set<number>();
	for (const raw of selected) {
		if (/^(i\s+)?(don'?t|do not) know$|^not sure$|^no idea$/i.test(raw.trim())) continue;
		const s = raw.trim();
		const norm = s.toLowerCase();
		const forms = (i: number) => {
			const label = quiz.options[i]!.label.trim();
			const plain = latexToUnicode(label);
			return [label, plain, `${letter(i)}. ${label}`, `${letter(i)}. ${plain}`].map((x) => x.toLowerCase());
		};
		let idx = quiz.options.findIndex((_, i) => forms(i).includes(norm));
		if (idx < 0) {
			const m = /^([A-Z]{1,2})(?:[.):]\s*.*)?$/i.exec(s);
			if (m) {
				const li = quiz.options.findIndex((_, i) => letter(i) === m[1]!.toUpperCase());
				if (li >= 0) idx = li;
			}
		}
		if (idx < 0) idx = quiz.options.findIndex((o) => `${o.label}`.toLowerCase().startsWith(norm) && norm.length >= 8);
		if (idx < 0) throw new Error(`"${raw}" doesn't match any option of ${quiz.id}`);
		out.add(idx);
	}
	return [...out].sort((a, b) => a - b);
}

export interface QuizGrade {
	quiz: string;
	result: Result;
	chosen: string[];
	correct: string[];
	explanation?: string;
	misconception?: string;
	confidence?: Confidence;
	/** Right but unsure: doesn't count toward mastery or credit ancestors. */
	tentative?: true;
	/** Prereqs whose next review moved later because this cold pass exercised them. */
	reviewsPushed?: string[];
	node?: string;
	status?: Status;
	inferred?: string[];
}

/** Confidence is only asked on probes and reviews; the check after teaching skips it. */
export const asksConfidence = (purpose: Purpose) => purpose === "probe" || purpose === "review";

export function gradeQuiz(a: AssessState, g: Graph | undefined, quizId: string, chosen: number[], now: Date, confidence?: Confidence): QuizGrade {
	const quiz = a.quizzes[quizId];
	if (!quiz) throw new Error(`unknown or already-graded quiz "${quizId}"`);
	const conf = asksConfidence(quiz.purpose) && chosen.length ? confidence : undefined;
	const right = chosen.length === quiz.correct.length && chosen.every((c, i) => c === quiz.correct[i]);
	const result: Result = right ? "correct" : "wrong";
	const wrongPicks = chosen.filter((c) => !quiz.correct.includes(c));
	const show = (i: number) => `${letter(i)}. ${quiz.options[i]!.label}`;
	let misconception = wrongPicks.map((c) => quiz.options[c]?.misconception).find(Boolean);
	// Sure and wrong is a confidently held wrong model, tagged or not.
	if (!misconception && !right && conf === "sure") misconception = `confidently chose "${wrongPicks.map(show).join(", ")}"`;
	const grade: QuizGrade = {
		quiz: quiz.id,
		result,
		chosen: chosen.length ? chosen.map(show) : ["I don't know"],
		correct: quiz.correct.map(show),
		explanation: quiz.explanation,
		misconception: right ? undefined : misconception,
		...(conf ? { confidence: conf } : {}),
		...(right && conf === "unsure" ? { tentative: true } : {}),
	};
	if (quiz.node && g?.nodes[quiz.node]) {
		const n = getNode(g, quiz.node);
		const ev: Evidence = {
			at: iso(now),
			via: "quiz",
			purpose: quiz.purpose,
			check: quiz.check,
			result,
			...(conf ? { confidence: conf } : {}),
			misconception: grade.misconception,
			ref: quiz.id,
		};
		const depth = depthOf(g, n.id);
		record(n, ev, now, depth);
		grade.node = n.id;
		const credited = creditPrereqs(g, n.id, ev, now);
		if (credited.length) grade.reviewsPushed = credited;
		// A lucky guess mustn't credit a whole subtree.
		if (right && quiz.infer && conf !== "unsure") {
			const inferred = inferAncestors(g, n.id, now, quiz.id);
			if (inferred.length) grade.inferred = inferred;
		}
		grade.status = status(n, depth);
	}
	delete a.quizzes[quizId];
	return grade;
}

export interface ExerciseInput {
	node?: string;
	prompt: string;
	solution: string;
	rubric?: string;
	mode?: ExerciseMode;
	link?: string;
	purpose?: Purpose;
	check?: Check;
	/** Derive only: the prereq ids the rubric covers — must be all of the node's prereqs. */
	covers?: string[];
}

/** A derive exercise must rebuild the node from every one of its prereqs. */
function validateDerive(g: Graph | undefined, input: ExerciseInput): string[] {
	if (!input.node || !g) throw new Error("a derive exercise needs a node on the map");
	const n = getNode(g, input.node);
	if (!n.prereqs.length) throw new Error(`"${n.id}" has no prerequisites to derive it from — use a recall or worked check`);
	if (input.mode === "external") throw new Error("a derive exercise is answered in chat or on paper");
	if (!input.rubric?.trim()) throw new Error("a derive exercise needs a rubric naming how each prerequisite is used");
	const covers = new Set(input.covers ?? []);
	const missing = n.prereqs.filter((p) => !covers.has(p));
	const extra = [...covers].filter((p) => !n.prereqs.includes(p));
	if (missing.length || extra.length) {
		throw new Error(
			`a derive exercise must cover exactly the prerequisites of "${n.id}" (${n.prereqs.join(", ")})` +
				(missing.length ? `; missing: ${missing.join(", ")}` : "") +
				(extra.length ? `; not prerequisites: ${extra.join(", ")}` : ""),
		);
	}
	return [...n.prereqs];
}

export function assignExercise(a: AssessState, g: Graph | undefined, input: ExerciseInput, now: Date): Exercise {
	if (input.node && g) getNode(g, input.node);
	const covers = input.check === "derive" ? validateDerive(g, input) : undefined;
	a.counter.exercise++;
	const ex: Exercise = {
		id: `ex${a.counter.exercise}`,
		node: input.node,
		prompt: input.prompt,
		solution: input.solution,
		rubric: input.rubric,
		mode: input.mode ?? "paper",
		link: input.link,
		purpose: input.purpose ?? "check",
		check: input.check ?? "worked",
		...(covers ? { covers } : {}),
		assigned: iso(now),
		status: "pending",
	};
	a.exercises[ex.id] = ex;
	return ex;
}

export interface ExerciseSubmit {
	id: string;
	result: Result;
	hints?: number;
	misconception?: string;
	feedback: string;
	submission?: string;
	/** Derive only: whether each covered prerequisite link held. */
	links?: LinkResult[];
}

function checkLinks(ex: Exercise, input: ExerciseSubmit): LinkResult[] {
	const covers = ex.covers ?? [];
	const byId = new Map((input.links ?? []).map((l) => [l.from, l.ok]));
	const missing = covers.filter((p) => !byId.has(p));
	if (missing.length) throw new Error(`grade every link of ${ex.id}: missing ${missing.join(", ")}`);
	const links = covers.map((from) => ({ from, ok: byId.get(from)! }));
	if (input.result === "correct" && links.some((l) => !l.ok)) throw new Error("a derive result can't be correct while a link failed — grade it partial or wrong");
	return links;
}

export function submitExercise(
	a: AssessState,
	g: Graph | undefined,
	input: ExerciseSubmit,
	now: Date,
): { exercise: Exercise; status?: Status; reviewsPushed?: string[] } {
	const ex = a.exercises[input.id];
	if (!ex) throw new Error(`unknown exercise "${input.id}"`);
	if (ex.status === "submitted") throw new Error(`${ex.id} was already graded (${ex.result}) — assign a new exercise for another attempt`);
	const links = ex.check === "derive" ? checkLinks(ex, input) : undefined;
	ex.status = "submitted";
	ex.submitted = iso(now);
	ex.result = input.result;
	ex.hints = input.hints ?? 0;
	ex.feedback = input.feedback;
	if (input.submission) ex.submission = input.submission;
	let st: Status | undefined;
	let reviewsPushed: string[] | undefined;
	if (ex.node && g?.nodes[ex.node]) {
		const n = getNode(g, ex.node);
		const ev: Evidence = {
			at: iso(now),
			via: "exercise",
			purpose: ex.purpose,
			check: ex.check,
			result: input.result,
			hints: input.hints ?? 0,
			misconception: input.misconception,
			...(links ? { links } : {}),
			ref: ex.id,
		};
		const depth = depthOf(g, n.id);
		record(n, ev, now, depth);
		st = status(n, depth);
		const credited = creditPrereqs(g, n.id, ev, now);
		if (credited.length) reviewsPushed = credited;
	}
	return { exercise: ex, status: st, ...(reviewsPushed ? { reviewsPushed } : {}) };
}
