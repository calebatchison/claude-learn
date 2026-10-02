import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { emptyGraph } from "./graph.ts";
import { renderMap, renderProgress } from "./render.ts";
import type { AssessState, ContextKind, Graph } from "./types.ts";
import { readJson, shortHash, slugify, writeAtomic, writeJson, ymd } from "./util.ts";

// A context is where one body of learning lives.
//
//   class     <root>/graph.json, CLASS.md, map.md, progress.md,
//             sources/, submissions/, sessions/, viz/, .learn/ (quizzes, exercises)
//   workshop  <root>/workshops/<date>-<slug>.md            (the one note)
//             <root>/workshops/.state/<slug>/graph.json    (state, hidden from Obsidian)

export interface Ctx {
	kind: ContextKind;
	root: string;
	graphPath: string;
	stateDir: string;
	slug?: string;
}

export function classCtx(root: string): Ctx {
	return { kind: "class", root, graphPath: path.join(root, "graph.json"), stateDir: path.join(root, ".learn") };
}

export function workshopCtx(root: string, slug: string): Ctx {
	const stateDir = path.join(root, "workshops", ".state", slug);
	return { kind: "workshop", root, slug, graphPath: path.join(stateDir, "graph.json"), stateDir };
}

export function isClassRoot(root: string): boolean {
	const g = readJson<Partial<Graph>>(path.join(root, "graph.json"));
	return g?.schema === 1 && g.kind === "class";
}

// ── Environment ─────────────────────────────────────────────────────────────

const usable = (v: string | undefined) => (v && !v.includes("${") ? v : undefined);

export function projectDir(): string {
	return path.resolve(usable(process.env.LEARN_PROJECT_DIR) ?? usable(process.env.CLAUDE_PROJECT_DIR) ?? process.cwd());
}

export function dataDir(): string {
	return path.resolve(
		usable(process.env.LEARN_DATA_DIR) ?? usable(process.env.CLAUDE_PLUGIN_DATA) ?? path.join(os.homedir(), ".claude-learn"),
	);
}

// ── Active session ──────────────────────────────────────────────────────────
// Shared between the MCP server (which starts sessions) and the hooks (which
// mirror the transcript into the session log). Keyed by project dir, so it
// lives outside the user's folders.

export interface Active {
	projectDir: string;
	kind: ContextKind;
	root: string;
	slug?: string;
	logFile: string;
	started: string;
	/** Claude Code session this log is bound to (set by the first hook call). */
	claudeSession?: string;
	transcript?: string;
	/** Transcript lines already processed. */
	cursor: number;
	/** Logged tool calls awaiting their result, keyed by tool_use id. */
	open: Record<string, { name: string; input?: Record<string, unknown> }>;
	/** Quiz questions already shown, so a fallback AskUserQuestion isn't logged twice. */
	quizQuestions: string[];
	/** A quiz came back pending; the AskUserQuestion that follows re-asks it. */
	quizAwaitingAnswer?: boolean;
	/** Final reply written early from the Stop hook; its transcript copy is skipped. */
	preLogged?: string;
}

export function activePath(project = projectDir(), data = dataDir()): string {
	return path.join(data, "active", `${shortHash(project)}.json`);
}

export function readActive(project = projectDir(), data = dataDir()): Active | undefined {
	return readJson<Active>(activePath(project, data));
}

export function writeActive(a: Active, data = dataDir()): void {
	writeJson(activePath(a.projectDir, data), a);
}

export function ctxFromActive(a: Active): Ctx {
	return a.kind === "class" ? classCtx(a.root) : workshopCtx(a.root, a.slug!);
}

// ── Load / save ─────────────────────────────────────────────────────────────

export function loadGraph(ctx: Ctx): Graph {
	const g = readJson<Graph>(ctx.graphPath);
	if (!g) throw new Error(ctx.kind === "class" ? `no class here (${ctx.root}) — run class_init first` : `workshop state missing: ${ctx.graphPath}`);
	return g;
}

const emptyAssess = (): AssessState => ({ counter: { quiz: 0, exercise: 0 }, quizzes: {}, exercises: {} });

export function loadAssess(ctx: Ctx): AssessState {
	return readJson<AssessState>(path.join(ctx.stateDir, "assess.json")) ?? emptyAssess();
}

export function saveAssess(ctx: Ctx, a: AssessState): void {
	writeJson(path.join(ctx.stateDir, "assess.json"), a);
}

/** Persist the graph and regenerate the human-facing views. */
export function saveGraph(ctx: Ctx, g: Graph, now: Date): void {
	writeJson(ctx.graphPath, g);
	if (ctx.kind === "class") {
		const pending = Object.values(loadAssess(ctx).exercises).filter((e) => e.status === "pending");
		writeAtomic(path.join(ctx.root, "map.md"), renderMap(g, now));
		writeAtomic(path.join(ctx.root, "progress.md"), renderProgress(g, pending, now));
	}
}

// ── Creation ────────────────────────────────────────────────────────────────

export interface ClassInit {
	name: string;
	goal: string;
	scope?: string;
	preferences?: string;
}

export function initClass(root: string, init: ClassInit, now: Date): Ctx {
	if (isClassRoot(root)) throw new Error(`${root} is already a class`);
	const ctx = classCtx(root);
	for (const d of ["sources", "submissions", "sessions", "viz", ".learn"]) fs.mkdirSync(path.join(root, d), { recursive: true });
	const classMd = path.join(root, "CLASS.md");
	if (!fs.existsSync(classMd)) {
		writeAtomic(
			classMd,
			[
				`# ${init.name}`,
				"",
				"Human-editable. The teacher reads this at the start of every session.",
				"",
				"## Goal",
				"",
				init.goal,
				"",
				"## Scope",
				"",
				init.scope ?? "_What's in and out of scope, the course syllabus, exam format…_",
				"",
				"## How I learn",
				"",
				init.preferences ?? "_Pacing, Socratic vs. narrated, notation preferences, anything the teacher should know._",
				"",
				"## Notes",
				"",
				"_Deadlines, the professor's conventions, things to emphasise._",
				"",
			].join("\n"),
		);
	}
	saveGraph(ctx, emptyGraph("class", init.name, init.goal, now), now);
	return ctx;
}

export function initWorkshop(root: string, topic: string, now: Date): { ctx: Ctx; logFile: string } {
	const base = `${ymd(now)}-${slugify(topic, 40)}`;
	let slug = base;
	for (let i = 2; fs.existsSync(path.join(root, "workshops", `${slug}.md`)); i++) slug = `${base}-${i}`;
	const ctx = workshopCtx(root, slug);
	const logFile = path.join(root, "workshops", `${slug}.md`);
	writeAtomic(logFile, `---\ntype: workshop\ntopic: "${topic.replace(/"/g, "'")}"\ndate: ${ymd(now)}\n---\n\n# ${topic}\n\n`);
	saveGraph(ctx, emptyGraph("workshop", topic, topic, now), now);
	return { ctx, logFile };
}

export function newSessionLog(ctx: Ctx, g: Graph, title: string, now: Date): { id: string; file: string } {
	const date = ymd(now);
	const n = g.sessions.filter((s) => s.started.startsWith(date)).length + 1;
	const id = `${date}-${String(n).padStart(2, "0")}`;
	const rel = path.join("sessions", `${id}-${slugify(title, 40)}.md`);
	writeAtomic(path.join(ctx.root, rel), `---\ntype: session\nclass: "${g.name.replace(/"/g, "'")}"\ndate: ${date}\n---\n\n# ${title}\n\n[map](../map.md) · [progress](../progress.md)\n\n`);
	return { id, file: rel };
}
