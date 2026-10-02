import * as fs from "node:fs";
import * as path from "node:path";
import { classCtx, dataDir, isClassRoot, loadAssess, loadGraph, readActive, saveGraph, writeActive } from "./core/context.ts";
import { statuses } from "./core/mastery.ts";
import { activeGoals, next } from "./core/plan.ts";
import { logFinalReply, syncTranscript } from "./core/translog.ts";
import { doctor } from "./core/viz.ts";

// learn — terminal companion to the MCP server, and the hook entry point.
//
//   learn status [dir]    summary of a class
//   learn next [dir]      what the next session will do
//   learn render [dir]    regenerate map.md / progress.md
//   learn doctor          check diagram renderers
//   learn hook            (hooks only) reads hook JSON on stdin

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	if (i < 0) return undefined;
	const v = args[i + 1];
	args.splice(i, 2);
	return v && !v.includes("${") ? v : undefined;
}

function classAt(dir: string) {
	const root = path.resolve(dir);
	if (!isClassRoot(root)) {
		console.error(`not a class: ${root}`);
		process.exit(1);
	}
	return classCtx(root);
}

function sessionStartContext(cwd: string): string | undefined {
	if (!isClassRoot(cwd)) return undefined;
	const c = classCtx(cwd);
	const g = loadGraph(c);
	const now = new Date();
	const recs = next(g, now, { count: 3 });
	const open = Object.values(loadAssess(c).exercises).filter((e) => e.status === "pending").length;
	const goals = activeGoals(g);
	return [
		`This folder is a learn class: "${g.name}" (phase: ${g.phase}, ${Object.keys(g.nodes).length} nodes).`,
		`Next up: ${recs.map((r) => `${r.action}${r.title ? ` ${r.title}` : ""}`).join("; ")}.`,
		goals.length ? `Active goal: ${goals.map((x) => `${x.note ?? x.targets.join(", ")}${x.by ? ` by ${x.by}` : ""}`).join("; ")}.` : "",
		open ? `${open} open exercise(s) awaiting submission.` : "",
		"If the learner says /learn or asks to continue, use the learn skill.",
	]
		.filter(Boolean)
		.join(" ");
}

async function hook(args: string[]): Promise<void> {
	const data = flag(args, "--data") ?? dataDir();
	const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}") as {
		hook_event_name?: string;
		session_id?: string;
		transcript_path?: string;
		cwd?: string;
		agent_id?: string;
		last_assistant_message?: string;
	};
	const project = path.resolve(flag(args, "--project") ?? input.cwd ?? process.cwd());
	if (input.hook_event_name === "SessionStart") {
		const ctx = sessionStartContext(input.cwd ?? project);
		if (ctx) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: ctx } }));
		return;
	}
	if (input.agent_id) return; // subagent activity isn't part of the lesson
	const active = readActive(project, data);
	if (!active || !input.transcript_path || !input.session_id) return;
	const r = syncTranscript(active, input.transcript_path, input.session_id);
	if (!r.skipped && input.hook_event_name === "Stop") logFinalReply(active, input.last_assistant_message);
	writeActive(active, data);
}

async function main() {
	const args = process.argv.slice(2);
	const cmd = args.shift();
	switch (cmd) {
		case "hook":
			try {
				await hook(args);
			} catch (err) {
				// Never break the user's session over logging; leave a trace instead.
				try {
					fs.mkdirSync(dataDir(), { recursive: true });
					fs.appendFileSync(path.join(dataDir(), "hook-errors.log"), `${new Date().toISOString()} ${(err as Error).stack}\n`);
				} catch {
					/* ignore */
				}
			}
			return;
		case "status": {
			const c = classAt(args[0] ?? ".");
			const g = loadGraph(c);
			const counts: Record<string, number> = {};
			for (const s of statuses(g).values()) counts[s] = (counts[s] ?? 0) + 1;
			console.log(`${g.name} — phase ${g.phase}, ${Object.keys(g.nodes).length} nodes`);
			console.log(Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · "));
			for (const r of next(g, new Date(), { count: 5 })) console.log(`  ${r.action.padEnd(9)} ${r.title ?? ""}  — ${r.reason}`);
			return;
		}
		case "next": {
			const c = classAt(args[0] ?? ".");
			for (const r of next(loadGraph(c), new Date(), { count: 10 })) console.log(`${r.action.padEnd(9)} ${r.node ?? ""}  ${r.reason}`);
			return;
		}
		case "render": {
			const c = classAt(args[0] ?? ".");
			saveGraph(c, loadGraph(c), new Date());
			console.log(`rendered ${path.join(c.root, "map.md")} and progress.md`);
			return;
		}
		case "doctor": {
			const d = doctor();
			console.log(`mermaid: ${d.mermaid}\nsvg:     ${d.svg ?? "none"}\nbrowser: ${d.chrome ?? "none"}`);
			for (const a of d.advice) console.log(`- ${a}`);
			return;
		}
		default:
			console.log("usage: learn <status|next|render|doctor> [class-dir]");
			process.exit(cmd ? 1 : 0);
	}
}

await main();
