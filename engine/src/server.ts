import * as fs from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { asksConfidence, assignExercise, createQuiz, gradeQuiz, resolveSelection, submitExercise, type QuizGrade } from "./core/assess.ts";
import {
	type Ctx,
	classCtx,
	dataDir,
	initClass,
	initWorkshop,
	isClassRoot,
	loadAssess,
	loadGraph,
	newSessionLog,
	projectDir,
	saveAssess,
	saveGraph,
	writeActive,
} from "./core/context.ts";
import { applyChanges, depthOf, getNode, nodeDepths } from "./core/graph.ts";
import { markTaught, masteryGap, requiresDerive, status, statuses } from "./core/mastery.ts";
import { activeGoals, newGoalId, next, planGoal } from "./core/plan.ts";
import { listNodes, renderMap } from "./core/render.ts";
import { latexToUnicode } from "./core/plaintext.ts";
import { scanSources } from "./core/sources.ts";
import type { Confidence, Graph, Quiz } from "./core/types.ts";
import { iso, letter, ymd } from "./core/util.ts";
import { doctor, renderViz } from "./core/viz.ts";

// ── Session state (per Claude Code session = per server process) ────────────

let root = projectDir();
/** Set by session_start; otherwise tools act on the class at `root`. */
let sessionCtx: Ctx | undefined;
let sessionId: string | undefined;

function ctx(): Ctx {
	if (sessionCtx) return sessionCtx;
	if (isClassRoot(root)) return classCtx(root);
	throw new Error(`no class in ${root} and no workshop running. Use class_init, or session_start with workshop_topic.`);
}

// All tool calls run one at a time, so parallel calls can't race on graph.json.
let queue: Promise<unknown> = Promise.resolve();
type ToolResult = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; isError?: boolean };
function tool<A>(fn: (args: A) => Promise<ToolResult> | ToolResult) {
	return (args: A): Promise<ToolResult> => {
		const run = queue.then(async () => {
			try {
				return await fn(args);
			} catch (err) {
				return { isError: true, content: [{ type: "text" as const, text: (err as Error).message }] };
			}
		});
		queue = run.catch(() => undefined);
		return run;
	};
}
const json = (v: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(v, null, 1) }] });

function summary(g: Graph, now: Date) {
	const st = statuses(g);
	const counts: Record<string, number> = {};
	for (const s of st.values()) counts[s] = (counts[s] ?? 0) + 1;
	return {
		name: g.name,
		goal: g.goal,
		phase: g.phase,
		style: g.style ?? "depth",
		nodes: Object.keys(g.nodes).length,
		units: g.units.map((u) => u.id),
		status_counts: counts,
		next: next(g, now),
		goals: activeGoals(g).map((goal) => ({ id: goal.id, targets: goal.targets, by: goal.by, note: goal.note })),
	};
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = new McpServer({ name: "learn", version: "0.1.0" });

const optionSchema = z.object({
	label: z.string().describe("The option as a bare claim, no justification. Use LaTeX for math ($x^2$)."),
	description: z.string().optional().describe("Rarely needed. Must not give the answer away."),
	misconception: z.string().optional().describe("For a distractor: the misconception someone picking it holds. Recorded on the node if picked."),
});
const quizCheckSchema = z
	.enum(["recall", "transfer", "worked"])
	.describe("recall = state/recognise it; transfer = apply it in an unfamiliar setting; worked = carry out a multi-step problem");
const checkSchema = z
	.enum(["recall", "transfer", "worked", "derive"])
	.describe(
		"recall = state it in their own words; transfer = apply it in an unfamiliar setting; worked = carry out a multi-step problem; derive = rebuild the node from ALL its prerequisites (needs covers + rubric)",
	);
const purposeSchema = z.enum(["probe", "check", "review"]).describe("probe = placement/mapping; check = after teaching; review = spaced re-verification");

server.registerTool(
	"learn_status",
	{
		description:
			"Start here at the beginning of every /learn. Reports whether the folder is a class, and if so its phase, status counts, next recommendations, goals, open exercises, and unread sources. Pass `root` only to work in a folder other than the project directory.",
		inputSchema: { root: z.string().optional().describe("Absolute path of the folder to work in (default: the project directory).") },
	},
	tool(({ root: r }: { root?: string }) => {
		if (r) {
			root = path.resolve(r);
			sessionCtx = undefined;
		}
		const now = new Date();
		if (!isClassRoot(root)) {
			const files = fs.existsSync(root) ? fs.readdirSync(root).filter((f) => !f.startsWith(".")) : [];
			return json({
				root,
				class: false,
				workshop_running: sessionCtx?.kind === "workshop",
				folder_contents: files.slice(0, 40),
				hint: "Not a class. To start one: class_init (then build the map). For a one-off lesson: session_start with workshop_topic.",
			});
		}
		const c = classCtx(root);
		const g = loadGraph(c);
		const a = loadAssess(c);
		const newSources = scanSources(root, structuredClone(g), now).filter((s) => s.change === "new" || s.change === "changed").map((s) => s.file);
		return json({
			root,
			class: true,
			...summary(g, now),
			open_exercises: Object.values(a.exercises)
				.filter((e) => e.status === "pending")
				.map((e) => ({ id: e.id, node: e.node, mode: e.mode, assigned: e.assigned.slice(0, 10) })),
			unread_sources: newSources,
			session_running: sessionCtx ? true : false,
			files: { class_md: path.join(root, "CLASS.md"), map: path.join(root, "map.md"), progress: path.join(root, "progress.md") },
		});
	}),
);

server.registerTool(
	"class_init",
	{
		description: "Create a class in the current folder: CLASS.md, graph.json, sources/, sessions/, submissions/, viz/. Only after the learner has told you the goal.",
		inputSchema: {
			name: z.string().describe('e.g. "Linear Algebra (MATH 540)"'),
			goal: z.string().describe("What the learner wants to be able to do at the end, concretely."),
			scope: z.string().optional(),
			preferences: z.string().optional().describe("How they like to learn, if they said."),
		},
	},
	tool((args: { name: string; goal: string; scope?: string; preferences?: string }) => {
		const c = initClass(root, args, new Date());
		sessionCtx = undefined;
		return json({ created: c.root, next: "Drop files into sources/ if any, run sources_scan, then draft the map with graph_apply (dry_run first)." });
	}),
);

server.registerTool(
	"session_start",
	{
		description:
			"Open the session log (the Obsidian note the lesson is mirrored into). Class: call once per /learn after learn_status. Workshop: pass workshop_topic to create a one-note workshop instead.",
		inputSchema: {
			title: z.string().optional().describe("Short title for this session's log, e.g. the node being taught."),
			workshop_topic: z.string().optional().describe("Start a one-off workshop on this topic instead of a class session."),
		},
	},
	tool(({ title, workshop_topic }: { title?: string; workshop_topic?: string }) => {
		const now = new Date();
		let logFile: string;
		if (workshop_topic) {
			const w = initWorkshop(root, workshop_topic, now);
			sessionCtx = w.ctx;
			logFile = w.logFile;
			sessionId = undefined;
		} else {
			const c = classCtx(root);
			const g = loadGraph(c);
			const s = newSessionLog(c, g, title ?? "Session", now);
			g.sessions.push({ id: s.id, file: s.file, started: iso(now), title: title ?? "Session" });
			saveGraph(c, g, now);
			sessionCtx = c;
			sessionId = s.id;
			logFile = path.join(root, s.file);
		}
		writeActive(
			{
				projectDir: projectDir(),
				kind: sessionCtx.kind,
				root,
				slug: sessionCtx.slug,
				logFile,
				started: iso(now),
				cursor: -1,
				open: {},
				quizQuestions: [],
			},
			dataDir(),
		);
		return json({ log: logFile, mode: sessionCtx.kind, note: "Your replies, quizzes and exercises are mirrored into this file automatically. Don't write to it yourself." });
	}),
);

server.registerTool(
	"session_end",
	{
		description: "Record a one-or-two sentence summary of the session (what landed, what didn't, what's next). Call before you sign off.",
		inputSchema: { summary: z.string() },
	},
	tool(({ summary: text }: { summary: string }) => {
		const c = ctx();
		const now = new Date();
		const g = loadGraph(c);
		const s = g.sessions.find((x) => x.id === sessionId) ?? g.sessions[g.sessions.length - 1];
		if (s) {
			s.ended = iso(now);
			s.summary = text;
		}
		saveGraph(c, g, now);
		return json({ recorded: true, next: next(g, now, { count: 3 }) });
	}),
);

server.registerTool(
	"graph_view",
	{
		description:
			"Read the knowledge map. scope=all: one line per node (id | title | status | unit | prereqs). scope=unit/node: details incl. evidence for one unit or node. scope=frontier: next steps plus statuses around them.",
		inputSchema: {
			scope: z.enum(["all", "frontier", "unit", "node"]),
			id: z.string().optional().describe("Unit or node id, for scope=unit/node."),
		},
	},
	tool(({ scope, id }: { scope: "all" | "frontier" | "unit" | "node"; id?: string }) => {
		const g = loadGraph(ctx());
		const now = new Date();
		if (scope === "all") return { content: [{ type: "text", text: listNodes(g) || "(empty map)" }] };
		if (scope === "unit") {
			if (!id) throw new Error("scope=unit needs id");
			const ids = Object.values(g.nodes).filter((n) => n.unit === id).map((n) => n.id);
			return { content: [{ type: "text", text: listNodes(g, ids) || `(no nodes in unit ${id})` }] };
		}
		if (scope === "node") {
			if (!id) throw new Error("scope=node needs id");
			const n = getNode(g, id);
			const d = nodeDepths(g).get(id)!;
			return json({ ...n, depth: d.depth, ...(d.promotedBy ? { deep_because: d.promotedBy } : {}), status: status(n, d.depth), gap: masteryGap(n, now, d.depth) });
		}
		const recs = next(g, now, { count: 6 });
		const around = new Set<string>();
		for (const r of recs) {
			if (!r.node) continue;
			around.add(r.node);
			for (const p of g.nodes[r.node]!.prereqs) around.add(p);
		}
		return json({ next: recs, around: listNodes(g, around) });
	}),
);

const nodeUpsert = z.object({
	id: z.string().describe("lowercase-kebab-case, stable forever"),
	title: z.string().optional().describe("Required for new nodes. Short: a term or short phrase."),
	kind: z.enum(["concept", "practice"]).optional().describe("practice = a problem/exercise node, e.g. a LeetCode problem"),
	unit: z.string().nullable().optional(),
	summary: z.string().optional().describe("One sentence: what knowing this node means."),
	prereqs: z.array(z.string()).optional().describe("REPLACES the prereq list. Use add_edges to add one."),
	foundational: z.boolean().optional().describe("An unconditional truth the teaching is founded on."),
	sources: z.array(z.object({ file: z.string(), page: z.string().optional(), note: z.string().optional() })).optional(),
	links: z.array(z.string()).optional(),
	requires_derive: z
		.boolean()
		.optional()
		.describe(
			"Override whether mastering this node needs a derive pass. Default: required for concept nodes with prereqs that aren't foundational; not for foundational or practice nodes. Needs derive_reason; every override is logged.",
		),
	derive_reason: z.string().optional().describe("Why this node departs from the default derive rule (required with requires_derive)."),
	depth: z
		.enum(["deep", "breadth"])
		.optional()
		.describe(
			"Override the class style for this node. deep = full mastery bar and spaced reviews; breadth = covered after one clean pass, reviews only after misses. Promoting to deep keeps all evidence. Refused as breadth while a deep node builds on it. Needs depth_reason; every override is logged.",
		),
	depth_reason: z.string().optional().describe("Why this node departs from the class style (required with depth)."),
});
const edge = z.object({ from: z.string().describe("prereq"), to: z.string().describe("dependent") });

server.registerTool(
	"graph_apply",
	{
		description:
			"Change the knowledge map atomically: upsert units and nodes, add/remove edges, remove nodes, update source status, set phase. Validates everything (ids, prereqs exist, no cycles) and rejects the whole change on any error. Use dry_run to preview (returns a mermaid diagram) before showing the learner.",
		inputSchema: {
			dry_run: z.boolean().optional(),
			name: z.string().optional(),
			goal: z.string().optional(),
			phase: z.enum(["setup", "placement", "active"]).optional(),
			style: z
				.enum(["depth", "breadth", "mix"])
				.optional()
				.describe(
					"Class depth, chosen from the learner's goal at setup. depth = every node deep; breadth = every node breadth (cover lots of ground); mix = deep for foundational nodes and anything 2+ nodes build on, breadth for the outer topics. Ancestors of a deep node are always deep.",
				),
			units: z.array(z.object({ id: z.string(), title: z.string() })).optional().describe("Upserted, in teaching order."),
			nodes: z.array(nodeUpsert).optional(),
			remove: z.array(z.string()).optional(),
			add_edges: z.array(edge).optional(),
			remove_edges: z.array(edge).optional(),
			sources: z
				.array(z.object({ file: z.string(), status: z.enum(["new", "partial", "ingested", "skipped"]), progress: z.string().optional(), note: z.string().optional() }))
				.optional(),
		},
	},
	tool((args: Parameters<typeof applyChanges>[1] & { dry_run?: boolean }) => {
		const c = ctx();
		const now = new Date();
		const g = loadGraph(c);
		const { dry_run, ...changes } = args;
		const { graph, summary: s } = applyChanges(g, changes, now);
		if (dry_run) {
			// One overview diagram — the unit map for big graphs, the whole map for small ones.
			const map = renderMap(graph, now);
			const section = /## (?:Units|Map)\n[\s\S]*?(```mermaid[\s\S]*?```)/.exec(map)?.[1];
			const nodes = Object.values(graph.nodes);
			const depths = nodeDepths(graph);
			const isDeep = (id: string) => depths.get(id)?.depth === "deep";
			const derive = {
				required: nodes.filter((n) => isDeep(n.id) && requiresDerive(n)).map((n) => n.id),
				overrides: nodes.filter((n) => n.deriveRules?.length).map((n) => ({ id: n.id, required: n.deriveRules!.at(-1)!.required, reason: n.deriveRules!.at(-1)!.reason })),
			};
			return json({
				dry_run: true,
				would: s,
				preview: section ?? "(empty map)",
				derive,
				depth: {
					style: graph.style ?? "depth",
					breadth: nodes.filter((n) => !isDeep(n.id)).map((n) => n.id),
					promoted: [...depths].filter(([, d]) => d.promotedBy).map(([id, d]) => ({ id, because: d.promotedBy })),
					overrides: nodes.filter((n) => n.depthRules?.length).map((n) => ({ id: n.id, depth: n.depthRules!.at(-1)!.depth, reason: n.depthRules!.at(-1)!.reason })),
				},
				note: "Show the learner this one diagram, the class style and which nodes are breadth (and which were pulled deep, and why), and which nodes need a derive pass (and any overrides with their reasons); the full detail lives in map.md.",
			});
		}
		saveGraph(c, graph, now);
		return json({ applied: s, phase: graph.phase, nodes: Object.keys(graph.nodes).length });
	}),
);

server.registerTool(
	"sources_scan",
	{
		description: "Scan sources/ for new or changed files and register them. Returns each file's status (new / partial / ingested / skipped).",
		inputSchema: {},
	},
	tool(() => {
		const c = ctx();
		if (c.kind !== "class") throw new Error("sources belong to a class");
		const now = new Date();
		const g = loadGraph(c);
		const files = scanSources(c.root, g, now);
		saveGraph(c, g, now);
		return json({ sources_dir: path.join(c.root, "sources"), files });
	}),
);

server.registerTool(
	"next",
	{
		description:
			"What to do next, computed from the map: placement probes, remediation of shaky nodes / misconceptions, due reviews, then new teachable nodes (prereqs satisfied), prioritising active goals.",
		inputSchema: { count: z.number().int().min(1).max(20).optional() },
	},
	tool(({ count }: { count?: number }) => json(next(loadGraph(ctx()), new Date(), { count }))),
);

server.registerTool(
	"node_taught",
	{
		description: "Mark a node as taught. Only after you have written the lesson out to the learner in your reply (motivate → establish → connect); then quiz-check it.",
		inputSchema: { node: z.string() },
	},
	tool(({ node }: { node: string }) => {
		const c = ctx();
		const now = new Date();
		const g = loadGraph(c);
		markTaught(getNode(g, node), now);
		saveGraph(c, g, now);
		return json({ node, status: status(getNode(g, node), depthOf(g, node)) });
	}),
);

// ── Quizzes ─────────────────────────────────────────────────────────────────

// "declined" = the learner chose to skip. "unavailable" = no picker (not
// supported, dismissed, or headless) — fall back to asking in chat.
type Picked = { chosen: number[]; confidence?: Confidence };

const CONFIDENCE_FIELD = {
	type: "string" as const,
	title: "How sure were you?",
	oneOf: [
		{ const: "sure", title: "Sure" },
		{ const: "unsure", title: "Unsure" },
	],
};
const readConfidence = (v: unknown): Confidence | undefined => (v === "sure" || v === "unsure" ? v : undefined);

async function elicit(quiz: Quiz): Promise<Picked | "declined" | "unavailable"> {
	// The terminal picker can't render math or wrap long questions, so the
	// built-in question tool is the default; the MCP form is opt-in.
	if (process.env.LEARN_QUIZ_UI !== "picker") return "unavailable";
	if (!server.server.getClientCapabilities()?.elicitation) return "unavailable";
	const message = latexToUnicode([quiz.context, quiz.question].filter(Boolean).join("\n\n"));
	const title = (i: number) => {
		const o = quiz.options[i]!;
		return latexToUnicode(`${letter(i)}. ${o.label}${o.description ? ` — ${o.description}` : ""}`);
	};
	try {
		const conf: Record<string, typeof CONFIDENCE_FIELD> = asksConfidence(quiz.purpose) ? { confidence: CONFIDENCE_FIELD } : {};
		if (!quiz.multi) {
			const res = await server.server.elicitInput({
				message,
				requestedSchema: {
					type: "object",
					properties: { answer: { type: "string", title: "Your answer", oneOf: quiz.options.map((_, i) => ({ const: letter(i), title: title(i) })) }, ...conf },
					required: ["answer"],
				},
			});
			if (res.action === "decline") return "declined";
			if (res.action !== "accept" || !res.content) return "unavailable";
			return { chosen: resolveSelection(quiz, [String(res.content.answer)]), confidence: readConfidence(res.content.confidence) };
		}
		const properties: Record<string, { type: "boolean"; title: string; default: boolean } | typeof CONFIDENCE_FIELD> = { ...conf };
		quiz.options.forEach((_, i) => (properties[letter(i)] = { type: "boolean", title: title(i), default: false }));
		const res = await server.server.elicitInput({ message: `${message}\n\n(Select all that apply.)`, requestedSchema: { type: "object", properties } });
		if (res.action === "decline") return "declined";
		if (res.action !== "accept" || !res.content) return "unavailable";
		return { chosen: quiz.options.map((_, i) => i).filter((i) => res.content![letter(i)] === true), confidence: readConfidence(res.content.confidence) };
	} catch {
		return "unavailable";
	}
}

function finishGrade(grade: QuizGrade) {
	return {
		status: "graded",
		grade,
		...(grade.result === "wrong" ? { teacher_note: "Probe the miss before moving on: slip, narrow gap, or misconception?" } : {}),
		...(grade.tentative ? { teacher_note: "Right but unsure: don't treat it as known. It comes back for review sooner; consider a quick follow-up from a different angle." } : {}),
	};
}

server.registerTool(
	"quiz_ask",
	{
		description:
			"Ask ONE graded multiple-choice question. The learner answers in a picker and the server grades it, records the result on the node (mastery + review schedule) and logs it. Normally returns status=pending with an `ask` payload: pass it to AskUserQuestion verbatim, then call quiz_answer with their pick. (status=graded if the MCP picker is enabled and they answered there; status=skipped if they declined.) Use for anything with a right answer — probes, Socratic steps, checks, reviews.",
		inputSchema: {
			question: z.string(),
			options: z.array(optionSchema).min(2).max(4),
			correct: z.array(z.number().int().min(0)).min(1).describe("0-based indexes of the correct option(s). More than one = select-all-that-apply."),
			explanation: z.string().optional().describe("Shown after answering: why the answer is right and what the tempting wrong ones get wrong."),
			context: z.string().optional().describe("Optional setup shown above the options."),
			node: z.string().optional().describe("Node this tests. Omit only for questions not tied to the map."),
			purpose: purposeSchema.optional(),
			check: quizCheckSchema.optional(),
			infer: z.boolean().optional().describe("On a correct probe, credit unchecked ancestors as assumed (default true for probes)."),
		},
	},
	tool(async (input: Parameters<typeof createQuiz>[2]) => {
		const c = ctx();
		const now = new Date();
		const g = loadGraph(c);
		const a = loadAssess(c);
		const quiz = createQuiz(a, g, input, now);
		saveAssess(c, a);
		const picked = await elicit(quiz);
		if (picked === "unavailable") {
			return json({
				status: "pending",
				quiz: quiz.id,
				instructions:
					"Pass `ask` to AskUserQuestion exactly as given (terminal-friendly: math converted to Unicode). Then call quiz_answer with the label they picked" +
					(asksConfidence(quiz.purpose) ? " and their answer to the confidence question (confidence: sure | unsure)" : "") +
					". If they choose Other and say they don't know, pass selected: []. If AskUserQuestion is unavailable, show the same lettered options in chat" +
					(asksConfidence(quiz.purpose) ? ", then ask Sure or Unsure" : "") +
					".",
				ask: {
					questions: [
						{
							question: latexToUnicode([quiz.context, quiz.question].filter(Boolean).join("\n\n")),
							header: quiz.purpose === "probe" ? "Probe" : quiz.purpose === "review" ? "Review" : "Quiz",
							multiSelect: quiz.multi,
							options: quiz.options.map((o, i) => ({
								label: latexToUnicode(`${letter(i)}. ${o.label}`),
								description: o.description ? latexToUnicode(o.description) : "",
							})),
						},
						...(asksConfidence(quiz.purpose)
							? [
									{
										question: "How sure were you of that answer?",
										header: "Confidence",
										multiSelect: false,
										options: [
											{ label: "Sure", description: "I knew it" },
											{ label: "Unsure", description: "Partly a guess" },
										],
									},
								]
							: []),
					],
				},
			});
		}
		const a2 = loadAssess(c);
		if (picked === "declined") {
			delete a2.quizzes[quiz.id];
			saveAssess(c, a2);
			return json({ status: "skipped", quiz: quiz.id, note: "The learner declined this question. Don't re-ask it; ask whether they want to skip ahead or try a different angle." });
		}
		const g2 = loadGraph(c);
		const grade = gradeQuiz(a2, g2, quiz.id, picked.chosen, new Date(), picked.confidence);
		saveAssess(c, a2);
		saveGraph(c, g2, new Date());
		return json(finishGrade(grade));
	}),
);

server.registerTool(
	"quiz_answer",
	{
		description:
			"Grade a pending quiz with the learner's selection (labels or letters exactly as they picked them). Empty selected = they don't know (graded as a miss, which is honest and useful). For probes and reviews, pass their confidence: right + unsure is tentative (no mastery credit, review comes sooner); wrong + sure is recorded as a misconception.",
		inputSchema: {
			quiz: z.string(),
			selected: z.array(z.string()),
			confidence: z.enum(["sure", "unsure"]).optional().describe("Probes and reviews: the learner's answer to the confidence question. Ignored for checks."),
		},
	},
	tool(({ quiz: id, selected, confidence }: { quiz: string; selected: string[]; confidence?: Confidence }) => {
		const c = ctx();
		const now = new Date();
		const g = loadGraph(c);
		const a = loadAssess(c);
		const quiz = a.quizzes[id];
		if (!quiz) throw new Error(`unknown or already-graded quiz "${id}"`);
		const grade = gradeQuiz(a, g, id, resolveSelection(quiz, selected), now, confidence);
		saveAssess(c, a);
		saveGraph(c, g, now);
		return json(finishGrade(grade));
	}),
);

// ── Exercises ───────────────────────────────────────────────────────────────

server.registerTool(
	"exercise_assign",
	{
		description:
			"Assign a free-response exercise: answered in chat, worked on paper (learner can drop a photo into submissions/), or solved externally (e.g. LeetCode). Stores your solution and rubric so it can be graded in a later session.",
		inputSchema: {
			prompt: z.string().describe("The problem, exactly as the learner should see it. LaTeX for math."),
			solution: z.string().describe("Full worked solution / reference answer. Never shown in the log."),
			rubric: z.string().optional().describe("Key steps and common errors, for grading partial credit."),
			mode: z.enum(["chat", "paper", "external"]).optional().describe("default paper"),
			link: z.string().optional(),
			node: z.string().optional(),
			purpose: purposeSchema.optional(),
			check: checkSchema.optional().describe("default worked"),
			covers: z
				.array(z.string())
				.optional()
				.describe("derive only: the node's prerequisite ids — must be all of them. The rubric says how each one is used."),
		},
	},
	tool((input: Parameters<typeof assignExercise>[2]) => {
		const c = ctx();
		const a = loadAssess(c);
		const g = loadGraph(c);
		const ex = assignExercise(a, g, input, new Date());
		saveAssess(c, a);
		saveGraph(c, g, new Date());
		return json({ id: ex.id, mode: ex.mode, submissions_dir: c.kind === "class" ? path.join(c.root, "submissions") : undefined });
	}),
);

server.registerTool(
	"exercise_list",
	{
		description: "List open exercises, or fetch one by id with its stored solution and rubric (for grading a submission).",
		inputSchema: { id: z.string().optional() },
	},
	tool(({ id }: { id?: string }) => {
		const a = loadAssess(ctx());
		if (id) {
			const ex = a.exercises[id];
			if (!ex) throw new Error(`unknown exercise "${id}"`);
			return json(ex);
		}
		return json(
			Object.values(a.exercises)
				.filter((e) => e.status === "pending")
				.map(({ solution: _s, rubric: _r, ...rest }) => rest),
		);
	}),
);

server.registerTool(
	"exercise_submit",
	{
		description:
			"Record your grading of a submitted exercise (after comparing the learner's work — text or a photo you've read — against the stored solution). Updates the node's mastery and review schedule.",
		inputSchema: {
			id: z.string(),
			result: z.enum(["correct", "partial", "wrong"]),
			hints: z.number().int().min(0).max(5).optional().describe("Hints you gave: 0 cold, 1 a nudge, 2+ substantial help."),
			misconception: z.string().optional().describe("Name the wrong model if the work revealed one."),
			feedback: z.string().describe("What was right, where it went wrong (which step), what to fix. Shown in the log."),
			submission: z.string().optional().describe("Path of the submitted file, if any."),
			links: z
				.array(z.object({ from: z.string(), ok: z.boolean() }))
				.optional()
				.describe("derive only: for every covered prerequisite, whether the learner's derivation used that link correctly."),
		},
	},
	tool((input: Parameters<typeof submitExercise>[2]) => {
		const c = ctx();
		const now = new Date();
		const a = loadAssess(c);
		const g = loadGraph(c);
		const r = submitExercise(a, g, input, now);
		saveAssess(c, a);
		saveGraph(c, g, now);
		return json({ id: r.exercise.id, result: r.exercise.result, node: r.exercise.node, status: r.status, reviews_pushed: r.reviewsPushed });
	}),
);

// ── Goals ───────────────────────────────────────────────────────────────────

server.registerTool(
	"goal_set",
	{
		description:
			'Focus the course on target nodes, optionally by a date ("test on eigenvalues Friday"). Returns the plan: every unmastered prerequisite in order, spread over the days left. next() then prioritises this path until the goal is cleared.',
		inputSchema: {
			targets: z.array(z.string()).min(1).describe("Node ids the learner must master. Add nodes first if the map lacks them."),
			by: z.string().optional().describe("Deadline, YYYY-MM-DD."),
			note: z.string().optional().describe('e.g. "Midterm 2"'),
		},
	},
	tool(({ targets, by, note }: { targets: string[]; by?: string; note?: string }) => {
		const c = ctx();
		const now = new Date();
		const g = loadGraph(c);
		for (const t of targets) getNode(g, t);
		if (by && !/^\d{4}-\d{2}-\d{2}$/.test(by)) throw new Error("by must be YYYY-MM-DD");
		const goal = { id: newGoalId(g, now), targets, by, note, created: iso(now) };
		g.goals.push(goal);
		saveGraph(c, g, now);
		const p = planGoal(g, goal, now);
		const title = (id: string) => g.nodes[id]?.title ?? id;
		return json({
			goal: goal.id,
			today: ymd(now),
			days: p.days,
			schedule: p.schedule.map((d) => ({ day: d.day, nodes: d.nodes.map((id) => `${id} (${title(id)})`) })),
			refresh_before_deadline: p.refresh,
			warning: p.warning,
		});
	}),
);

server.registerTool(
	"goal_clear",
	{
		description: "Clear a goal (deadline passed, or learner says so). Pacing returns to the normal frontier.",
		inputSchema: { id: z.string() },
	},
	tool(({ id }: { id: string }) => {
		const c = ctx();
		const now = new Date();
		const g = loadGraph(c);
		const goal = g.goals.find((x) => x.id === id);
		if (!goal) throw new Error(`unknown goal "${id}"`);
		goal.cleared = iso(now);
		saveGraph(c, g, now);
		return json({ cleared: id });
	}),
);

// ── Workshop → class ────────────────────────────────────────────────────────

server.registerTool(
	"workshop_promote",
	{
		description:
			"Turn the current workshop into a long-term class: creates a class folder seeded with the workshop's map and results, and copies the workshop note into its sessions/.",
		inputSchema: {
			folder: z.string().describe("Absolute path of the new class folder (created if missing)."),
			name: z.string().optional(),
			goal: z.string().optional(),
		},
	},
	tool(({ folder, name, goal }: { folder: string; name?: string; goal?: string }) => {
		if (sessionCtx?.kind !== "workshop") throw new Error("no workshop running in this session");
		const now = new Date();
		const src = loadGraph(sessionCtx);
		const dest = path.resolve(folder);
		fs.mkdirSync(dest, { recursive: true });
		const c = initClass(dest, { name: name ?? src.name, goal: goal ?? src.goal }, now);
		const g = loadGraph(c);
		Object.assign(g, { units: src.units, nodes: src.nodes, phase: Object.keys(src.nodes).length ? "active" : "setup" });
		const wlog = path.join(sessionCtx.root, "workshops", `${sessionCtx.slug}.md`);
		if (fs.existsSync(wlog)) {
			const rel = path.join("sessions", `${sessionCtx.slug}-workshop.md`);
			fs.copyFileSync(wlog, path.join(dest, rel));
			g.sessions.push({ id: `${ymd(now)}-w`, file: rel, started: src.created, ended: iso(now), title: `Workshop: ${src.name}` });
		}
		saveGraph(c, g, now);
		return json({ class: dest, nodes: Object.keys(g.nodes).length, next: "Tell the learner to open Claude Code in that folder and run /learn." });
	}),
);

// ── Visuals ─────────────────────────────────────────────────────────────────

server.registerTool(
	"viz_render",
	{
		description:
			"Render Mermaid or SVG source to a PNG and return the image so you can LOOK at it. Iterate until correct, then call again with save_as to publish into the context's viz/ folder; returns the filename to embed as ![[filename|500]].",
		inputSchema: {
			kind: z.enum(["mermaid", "svg"]),
			source: z.string().describe("Complete Mermaid source, or a complete <svg> document with a viewBox."),
			save_as: z.string().optional().describe("Short kebab-case topic. Only once the image is verified."),
			width: z.number().int().min(200).max(2400).optional(),
		},
	},
	tool(({ kind, source, save_as, width }: { kind: "mermaid" | "svg"; source: string; save_as?: string; width?: number }) => {
		const vizRoot = sessionCtx?.kind === "workshop" ? path.join(sessionCtx.root, "workshops") : (sessionCtx?.root ?? root);
		try {
			const r = renderViz(kind, source, { root: vizRoot, saveAs: save_as, width });
			return {
				content: [
					{ type: "image", data: r.png.toString("base64"), mimeType: "image/png" },
					{ type: "text", text: r.saved ? `RESULT:\nfilename: ${r.saved.filename}\npath: ${r.saved.path}` : "Preview only (not saved). Look at it critically; pass save_as once it's correct." },
				],
			};
		} catch (err) {
			const d = doctor();
			throw new Error(`${(err as Error).message}${d.advice.length ? `\n\nSetup:\n- ${d.advice.join("\n- ")}` : ""}`);
		}
	}),
);

await server.connect(new StdioServerTransport());

