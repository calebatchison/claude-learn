import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import type { Active } from "../src/core/context.ts";
import { logFinalReply, syncTranscript } from "../src/core/translog.ts";

const TOOL = "mcp__plugin_learn_learn__quiz_ask";

function setup() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "learn-log-"));
	const transcript = path.join(dir, "t.jsonl");
	const logFile = path.join(dir, "log.md");
	fs.writeFileSync(logFile, "# log\n\n");
	const active: Active = { projectDir: dir, kind: "class", root: dir, logFile, started: "", cursor: -1, open: {}, quizQuestions: [] };
	const write = (...lines: object[]) => fs.appendFileSync(transcript, lines.map((l) => JSON.stringify(l) + "\n").join(""));
	return { transcript, logFile, active, write };
}

const user = (content: unknown, extra = {}) => ({ type: "user", message: { role: "user", content }, ...extra });
const asst = (...content: object[]) => ({ type: "assistant", message: { role: "assistant", content } });

describe("transcript → session log", () => {
	it("starts at the most recent prompt, mirrors prose and quizzes, hides answers until graded", () => {
		const { transcript, logFile, active, write } = setup();
		write(user("old conversation before the session"), asst({ type: "text", text: "old reply" }));
		write(
			user("<command-message>learn</command-message>\n<command-name>/learn</command-name>\n<command-args>continue</command-args>"),
			user("skill body", { isMeta: true }),
			asst({ type: "thinking", thinking: "hmm" }),
			asst({ type: "text", text: "Let's derive $e^{i\\pi}$." }),
			asst({ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }),
			user([{ type: "tool_result", tool_use_id: "t1", content: "files" }]),
			asst({
				type: "tool_use",
				id: "t2",
				name: TOOL,
				input: { question: "What is $e^{i\\pi}$?", options: [{ label: "$-1$" }, { label: "$1$" }], correct: [0], explanation: "SECRET-EXPLANATION" },
			}),
		);
		syncTranscript(active, transcript, "s1");
		let log = fs.readFileSync(logFile, "utf8");
		assert.ok(!log.includes("old conversation"));
		assert.match(log, /\*\*You:\*\* \/learn continue/);
		assert.ok(!log.includes("skill body"));
		assert.ok(!log.includes("hmm"));
		assert.ok(!log.includes("files"));
		assert.match(log, /Let's derive/);
		assert.match(log, /\[!question\] Quiz/);
		assert.match(log, /\*\*A\.\*\* \$-1\$/);
		assert.ok(!log.includes("SECRET"), "question block must not leak the explanation");

		write(
			user([
				{
					type: "tool_result",
					tool_use_id: "t2",
					content: [{ type: "text", text: JSON.stringify({ status: "graded", grade: { result: "wrong", chosen: ["B. $1$"], correct: ["A. $-1$"], explanation: "SECRET-EXPLANATION" } }) }],
				},
			]),
			asst({ type: "text", text: "Close — let's look at the unit circle." }),
		);
		syncTranscript(active, transcript, "s1");
		log = fs.readFileSync(logFile, "utf8");
		assert.match(log, /\[!failure\] ✗ Not quite — you chose B\. \$1\$/);
		assert.match(log, /SECRET-EXPLANATION/);
		assert.match(log, /unit circle/);
		// Idempotent: nothing new, nothing appended.
		const before = log;
		syncTranscript(active, transcript, "s1");
		assert.equal(fs.readFileSync(logFile, "utf8"), before);
	});

	it("ignores other Claude sessions and doesn't consume a half-written line", () => {
		const { transcript, logFile, active, write } = setup();
		write(user("hello"));
		fs.appendFileSync(transcript, '{"type":"assistant","message":{"content":[{"type":"text","text":"part');
		syncTranscript(active, transcript, "s1");
		assert.ok(!fs.readFileSync(logFile, "utf8").includes("part"));
		fs.appendFileSync(transcript, 'ial reply"}]}}\n');
		syncTranscript(active, transcript, "s1");
		assert.match(fs.readFileSync(logFile, "utf8"), /partial reply/);
		assert.equal(syncTranscript(active, transcript, "other").skipped, "log is bound to another Claude session");
	});

	it("logs the final reply from the Stop hook when the transcript lags, without duplicating it later", () => {
		const { transcript, logFile, active, write } = setup();
		write(user("teach me"), asst({ type: "text", text: "First, a picture." }));
		syncTranscript(active, transcript, "s1");
		// Stop fires before the final reply reaches the transcript.
		assert.equal(logFinalReply(active, "That's the whole idea: balance."), true);
		assert.equal(logFinalReply(active, "That's the whole idea: balance."), false, "only once");
		write(asst({ type: "text", text: "That's the whole idea: balance." }), user("next"), asst({ type: "text", text: "On we go." }));
		syncTranscript(active, transcript, "s1");
		const log = fs.readFileSync(logFile, "utf8");
		assert.equal(log.match(/whole idea/g)!.length, 1);
		assert.ok(log.indexOf("whole idea") < log.indexOf("**You:** next"));
		assert.match(log, /On we go/);
		// When the transcript already had it, Stop doesn't re-log it.
		assert.equal(logFinalReply(active, "On we go."), false);
	});

	it("doesn't double-log a fallback quiz asked through AskUserQuestion", () => {
		const { transcript, logFile, active, write } = setup();
		write(
			user("go"),
			asst({ type: "tool_use", id: "q", name: TOOL, input: { question: "Q1?", options: [{ label: "x" }, { label: "y" }], correct: [0] } }),
			user([{ type: "tool_result", tool_use_id: "q", content: JSON.stringify({ status: "pending", quiz: "q1" }) }]),
			// Reworded (math converted to Unicode) — dedupe must not rely on exact text.
			asst({ type: "tool_use", id: "a", name: "AskUserQuestion", input: { questions: [{ question: "Q1 (reworded)?", options: [{ label: "A. x" }, { label: "B. y" }] }] } }),
			user([{ type: "tool_result", tool_use_id: "a", content: 'User has answered your questions: "Q1?"="x".' }]),
		);
		syncTranscript(active, transcript, "s1");
		write(
			asst({ type: "tool_use", id: "b", name: "AskUserQuestion", input: { questions: [{ question: "Unrelated preference?", options: [{ label: "p" }] }] } }),
		);
		syncTranscript(active, transcript, "s1");
		const log = fs.readFileSync(logFile, "utf8");
		assert.equal(log.match(/Q1/g)!.length, 1);
		assert.match(log, /Unrelated preference/, "only the one re-ask is suppressed");
	});
});
