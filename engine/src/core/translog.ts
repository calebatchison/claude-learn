import * as fs from "node:fs";
import type { Active } from "./context.ts";
import { letter } from "./util.ts";

// Mirrors the Claude Code transcript into the session's markdown log, so the
// lesson can be read rendered (math, code, diagrams) in Obsidian.
//
// Captured: your prompts, Claude's lesson prose, quiz / exercise / question
// blocks. Skipped: other tool calls, thinking, subagents.
//
// Runs from hooks (PreToolUse on quiz/exercise tools so the question shows up
// before you answer, PostToolUse for the result, Stop to catch up). It's
// incremental: a cursor remembers how many transcript lines were processed.
// A quiz question block never contains the answer.

type Block = { type: string; [k: string]: unknown };
interface Line {
	type?: string;
	isMeta?: boolean;
	isSidechain?: boolean;
	message?: { role?: string; content?: string | Block[] };
}

const QUIZ_ASK = /__quiz_ask$/;
const QUIZ_ANSWER = /__quiz_answer$/;
const EX_ASSIGN = /__exercise_assign$/;
const EX_SUBMIT = /__exercise_submit$/;
const ASK_USER = /^AskUserQuestion$/;
const LOGGED_TOOL = [QUIZ_ASK, QUIZ_ANSWER, EX_ASSIGN, EX_SUBMIT, ASK_USER];

// Claude Code's own commands are session plumbing, not part of the lesson.
const BUILTIN_COMMANDS = new Set(
	"model config clear compact cost context help resume rewind plugin plugins mcp memory permissions status doctor login logout fast effort agents hooks ide init add-dir export theme vim usage artifacts review".split(" "),
);

const quote = (s: string) =>
	s
		.split("\n")
		.map((l) => (l.length ? `> ${l}` : ">"))
		.join("\n");

function toolResultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((b: Block) => (b.type === "text" ? String(b.text ?? "") : ""))
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

function parseJson(s: string): Record<string, unknown> | undefined {
	try {
		const v = JSON.parse(s);
		return v && typeof v === "object" ? v : undefined;
	} catch {
		return undefined;
	}
}

/** Text of a real typed prompt, or undefined for meta / tool results / command noise. */
export function userPromptText(line: Line): string | undefined {
	if (line.type !== "user" || line.isMeta || line.isSidechain) return undefined;
	const c = line.message?.content;
	let text: string;
	if (typeof c === "string") text = c;
	else if (Array.isArray(c)) {
		if (c.some((b) => b.type === "tool_result")) return undefined;
		text = c
			.map((b) => (b.type === "text" ? String(b.text ?? "") : b.type === "image" ? "_[image attached]_" : ""))
			.filter(Boolean)
			.join("\n");
	} else return undefined;
	if (/<local-command-(stdout|caveat|stderr)>/.test(text)) return undefined;
	text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
	const cmd = /<command-name>([^<]*)<\/command-name>/.exec(text);
	if (cmd) {
		const name = cmd[1]!.trim();
		if (BUILTIN_COMMANDS.has(name.replace(/^\//, ""))) return undefined;
		const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
		text = `${name}${args ? ` ${args}` : ""}`;
	}
	if (!text || text.startsWith("[Request interrupted")) return undefined;
	return text;
}

export function renderQuizQuestion(input: Record<string, unknown>): string {
	const opts = (input.options as { label: string; description?: string }[] | undefined) ?? [];
	const multi = Array.isArray(input.correct) && input.correct.length > 1;
	const lines = [`[!question] Quiz${multi ? " — select all that apply" : ""}`, `**${String(input.question ?? "")}**`];
	if (input.context) lines.push("", String(input.context));
	lines.push("");
	opts.forEach((o, i) => lines.push(`- **${letter(i)}.** ${o.label}${o.description ? ` — ${o.description}` : ""}`));
	return quote(lines.join("\n"));
}

export function renderQuizResult(r: Record<string, unknown>): string | undefined {
	const grade = (r.grade ?? r) as Record<string, unknown>;
	if (r.status === "pending" || r.status === "skipped" || !grade.result) {
		return r.status === "skipped" ? quote("[!note] Quiz skipped") : undefined;
	}
	const chosen = (grade.chosen as string[] | undefined) ?? [];
	const correct = (grade.correct as string[] | undefined) ?? [];
	const ok = grade.result === "correct";
	const lines = ok
		? [grade.tentative ? `[!success] ✓ Correct, but unsure — ${chosen.join(", ")}. It'll come back for review sooner.` : `[!success] ✓ Correct — ${chosen.join(", ")}`]
		: chosen.length === 1 && chosen[0] === "I don't know"
			? [`[!failure] ? Didn't know — that's useful to find out`, `**Answer:** ${correct.join(", ")}`]
			: [`[!failure] ✗ Not quite — you chose ${chosen.join(", ") || "nothing"}${grade.confidence === "sure" ? " (and were sure)" : ""}`, `**Answer:** ${correct.join(", ")}`];
	if (grade.explanation) lines.push("", String(grade.explanation));
	return quote(lines.join("\n"));
}

export function renderExercise(input: Record<string, unknown>, id?: string): string {
	const mode = String(input.mode ?? "paper");
	const where = mode === "paper" ? "work it on paper" : mode === "external" ? "solve it outside, then come back" : "answer in chat";
	const lines = [`[!example] Exercise${id ? ` ${id}` : ""} — ${where}`, String(input.prompt ?? "")];
	if (input.link) lines.push("", String(input.link));
	return quote(lines.join("\n"));
}

export function renderExerciseResult(input: Record<string, unknown>): string {
	const result = String(input.result ?? "");
	const head = result === "correct" ? "[!success] ✓ Exercise correct" : result === "partial" ? "[!warning] ◐ Partly there" : "[!failure] ✗ Not yet";
	return quote([`${head}${input.id ? ` (${input.id})` : ""}`, String(input.feedback ?? "")].join("\n"));
}

function renderAskQuestion(input: Record<string, unknown>): string {
	const qs = (input.questions as { question: string; options?: { label: string; description?: string }[] }[] | undefined) ?? [];
	return qs
		.map((q) => {
			const lines = [`[!question] ${q.question}`];
			for (const o of q.options ?? []) lines.push(`- ${o.label}${o.description ? ` — ${o.description}` : ""}`);
			return quote(lines.join("\n"));
		})
		.join("\n\n");
}

function renderAskAnswer(text: string): string {
	const pairs = [...text.matchAll(/"([^"]+)"="([^"]*)"/g)].map((m) => m[2]);
	return `**You:** ${pairs.length ? pairs.join("; ") : text.trim()}`;
}

/** Index of the most recent typed prompt — where a newly bound log starts. */
export function lastPromptIndex(lines: string[]): number {
	for (let i = lines.length - 1; i >= 0; i--) {
		try {
			if (userPromptText(JSON.parse(lines[i]!))) return i;
		} catch {
			/* partial line */
		}
	}
	return 0;
}

export interface SyncResult {
	appended: number;
	skipped?: string;
}

/**
 * Append whatever the transcript has gained since the cursor. Mutates
 * `active` (cursor, binding, open tool calls); the caller persists it.
 */
export function syncTranscript(active: Active, transcriptPath: string, sessionId: string): SyncResult {
	if (!active.claudeSession) {
		active.claudeSession = sessionId;
		active.transcript = transcriptPath;
		active.cursor = -1; // resolved below, once the file is read
	} else if (active.claudeSession !== sessionId) {
		return { appended: 0, skipped: "log is bound to another Claude session" };
	}
	if (active.transcript !== transcriptPath) {
		active.transcript = transcriptPath;
		active.cursor = 0;
	}
	if (!fs.existsSync(transcriptPath)) return { appended: 0, skipped: "no transcript yet" };
	const raw = fs.readFileSync(transcriptPath, "utf8");
	const lines = raw.split("\n");
	// The last element is "" when the file ends with a newline; otherwise it's
	// a line still being written. Either way, don't consume it.
	const complete = lines.slice(0, -1);
	if (active.cursor < 0) active.cursor = lastPromptIndex(complete);

	const out: string[] = [];
	let i = active.cursor;
	for (; i < complete.length; i++) {
		let line: Line;
		try {
			line = JSON.parse(complete[i]!);
		} catch {
			continue;
		}
		if (line.isSidechain) continue;
		const prompt = userPromptText(line);
		if (prompt) {
			delete active.preLogged;
			delete active.quizAwaitingAnswer;
			out.push(quote(`**You:** ${prompt}`));
			continue;
		}
		const content = line.message?.content;
		if (!Array.isArray(content)) continue;
		for (const b of content) {
			if (line.type === "assistant" && b.type === "text") {
				const t = String(b.text ?? "").trim();
				// Already written from the Stop hook's last_assistant_message.
				if (t && active.preLogged?.includes(t)) continue;
				if (t && t !== "(no content)") out.push(t);
			} else if (line.type === "assistant" && b.type === "tool_use") {
				const name = String(b.name ?? "");
				if (!LOGGED_TOOL.some((re) => re.test(name))) continue;
				const input = (b.input ?? {}) as Record<string, unknown>;
				const id = String(b.id ?? "");
				if (QUIZ_ANSWER.test(name)) delete active.quizAwaitingAnswer;
				if (QUIZ_ASK.test(name)) {
					out.push(renderQuizQuestion(input));
					active.quizQuestions = [...active.quizQuestions, String(input.question ?? "")].slice(-50);
				} else if (ASK_USER.test(name)) {
					const qs = (input.questions as { question: string }[] | undefined) ?? [];
					// A pending quiz is re-asked through AskUserQuestion; it's already logged.
					if (active.quizAwaitingAnswer || qs.some((q) => active.quizQuestions.includes(q.question))) {
						delete active.quizAwaitingAnswer;
						continue;
					}
					out.push(renderAskQuestion(input));
				}
				active.open[id] = { name, input };
			} else if (line.type === "user" && b.type === "tool_result") {
				const id = String(b.tool_use_id ?? "");
				const open = active.open[id];
				if (!open) continue;
				delete active.open[id];
				if (b.is_error) continue;
				const text = toolResultText(b.content);
				const json = parseJson(text);
				if (QUIZ_ASK.test(open.name) || QUIZ_ANSWER.test(open.name)) {
					if (QUIZ_ASK.test(open.name) && json?.status === "pending") active.quizAwaitingAnswer = true;
					const r = json && renderQuizResult(json);
					if (r) out.push(r);
				} else if (EX_ASSIGN.test(open.name)) {
					out.push(renderExercise(open.input ?? {}, json?.id as string | undefined));
				} else if (EX_SUBMIT.test(open.name)) {
					out.push(renderExerciseResult(open.input ?? {}));
				} else if (ASK_USER.test(open.name)) {
					out.push(renderAskAnswer(text));
				}
			}
		}
	}
	active.cursor = i;
	if (out.length) fs.appendFileSync(active.logFile, out.map((s) => s + "\n").join("\n") + "\n", "utf8");
	return { appended: out.length };
}

/**
 * The transcript can lag the Stop hook, so a turn's final reply may not be in
 * it yet — and the last reply of a session would then never be logged. Stop
 * hands us that reply directly: write it now, and remember it so the
 * transcript copy is skipped when it lands.
 */
export function logFinalReply(active: Active, text: string | undefined): boolean {
	const t = text?.trim();
	if (!t || t === "(no content)" || active.preLogged?.includes(t)) return false;
	if (!fs.existsSync(active.transcript ?? "")) return false;
	// Already in the transcript and processed? Look at this turn only: the
	// processed lines after the most recent prompt.
	const processed = fs.readFileSync(active.transcript!, "utf8").split("\n").slice(0, active.cursor);
	for (let i = processed.length - 1; i >= 0; i--) {
		let line: Line;
		try {
			line = JSON.parse(processed[i]!);
		} catch {
			continue;
		}
		if (userPromptText(line)) break;
		const c = line.message?.content;
		if (line.type !== "assistant" || !Array.isArray(c)) continue;
		if (c.some((b) => b.type === "text" && String(b.text ?? "").trim() && t.includes(String(b.text ?? "").trim()))) return false;
	}
	active.preLogged = t;
	fs.appendFileSync(active.logFile, t + "\n\n", "utf8");
	return true;
}
