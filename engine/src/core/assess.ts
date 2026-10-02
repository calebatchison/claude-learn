import { getNode } from "./graph.ts";
import { inferAncestors, record, status } from "./mastery.ts";
import type { AssessState, Check, Exercise, ExerciseMode, Graph, Purpose, Quiz, QuizOption, Result, Status } from "./types.ts";
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
	node?: string;
	status?: Status;
	inferred?: string[];
}

export function gradeQuiz(a: AssessState, g: Graph | undefined, quizId: string, chosen: number[], now: Date): QuizGrade {
	const quiz = a.quizzes[quizId];
	if (!quiz) throw new Error(`unknown or already-graded quiz "${quizId}"`);
	const right = chosen.length === quiz.correct.length && chosen.every((c, i) => c === quiz.correct[i]);
	const result: Result = right ? "correct" : "wrong";
	const wrongPicks = chosen.filter((c) => !quiz.correct.includes(c));
	const misconception = wrongPicks.map((c) => quiz.options[c]?.misconception).find(Boolean);
	const show = (i: number) => `${letter(i)}. ${quiz.options[i]!.label}`;
	const grade: QuizGrade = {
		quiz: quiz.id,
		result,
		chosen: chosen.length ? chosen.map(show) : ["I don't know"],
		correct: quiz.correct.map(show),
		explanation: quiz.explanation,
		misconception: right ? undefined : misconception,
	};
	if (quiz.node && g?.nodes[quiz.node]) {
		const n = getNode(g, quiz.node);
		record(n, { at: iso(now), via: "quiz", purpose: quiz.purpose, check: quiz.check, result, misconception: grade.misconception, ref: quiz.id }, now);
		grade.node = n.id;
		if (right && quiz.infer) {
			const inferred = inferAncestors(g, n.id, now, quiz.id);
			if (inferred.length) grade.inferred = inferred;
		}
		grade.status = status(n);
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
}

export function assignExercise(a: AssessState, g: Graph | undefined, input: ExerciseInput, now: Date): Exercise {
	if (input.node && g) getNode(g, input.node);
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
}

export function submitExercise(a: AssessState, g: Graph | undefined, input: ExerciseSubmit, now: Date): { exercise: Exercise; status?: Status } {
	const ex = a.exercises[input.id];
	if (!ex) throw new Error(`unknown exercise "${input.id}"`);
	if (ex.status === "submitted") throw new Error(`${ex.id} was already graded (${ex.result}) — assign a new exercise for another attempt`);
	ex.status = "submitted";
	ex.submitted = iso(now);
	ex.result = input.result;
	ex.hints = input.hints ?? 0;
	ex.feedback = input.feedback;
	if (input.submission) ex.submission = input.submission;
	let st: Status | undefined;
	if (ex.node && g?.nodes[ex.node]) {
		const n = getNode(g, ex.node);
		record(
			n,
			{ at: iso(now), via: "exercise", purpose: ex.purpose, check: ex.check, result: input.result, hints: input.hints ?? 0, misconception: input.misconception, ref: ex.id },
			now,
		);
		st = status(n);
	}
	return { exercise: ex, status: st };
}
