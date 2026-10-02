import * as fs from "node:fs";
import * as path from "node:path";
import type { Graph, SourceStatus } from "./types.ts";
import { iso, sha256File } from "./util.ts";

export interface ScannedSource {
	file: string;
	status: SourceStatus;
	change: "new" | "changed" | "unchanged" | "missing";
	bytes?: number;
	progress?: string;
}

function walk(dir: string, rel = ""): string[] {
	if (!fs.existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const r = path.join(rel, entry.name);
		if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), r));
		else if (entry.isFile()) out.push(r);
	}
	return out.sort();
}

/**
 * Hash everything under sources/ and reconcile with the graph's source list.
 * New files are registered as "new"; a changed file goes back to "new" so it
 * gets re-read. Mutates the graph.
 */
export function scanSources(root: string, g: Graph, now: Date): ScannedSource[] {
	const dir = path.join(root, "sources");
	const files = walk(dir).map((f) => path.join("sources", f));
	const out: ScannedSource[] = [];
	for (const file of files) {
		const abs = path.join(root, file);
		const sha = sha256File(abs);
		const bytes = fs.statSync(abs).size;
		const rec = g.sources.find((s) => s.file === file);
		if (!rec) {
			g.sources.push({ file, sha256: sha, added: iso(now), status: "new" });
			out.push({ file, status: "new", change: "new", bytes });
		} else if (rec.sha256 !== sha) {
			rec.sha256 = sha;
			rec.status = "new";
			rec.note = `changed ${iso(now).slice(0, 10)}`;
			out.push({ file, status: "new", change: "changed", bytes, progress: rec.progress });
		} else {
			out.push({ file, status: rec.status, change: "unchanged", bytes, progress: rec.progress });
		}
	}
	for (const rec of g.sources) if (!files.includes(rec.file)) out.push({ file: rec.file, status: rec.status, change: "missing" });
	return out;
}
