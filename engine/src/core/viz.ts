import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { slugify } from "./util.ts";

// Renders Mermaid / SVG source to PNG so the diagram maker can look at the
// result before it reaches the learner. What it verified is pixel-identical
// to what gets embedded.
//
//   Mermaid: `mmdc` (@mermaid-js/mermaid-cli) on PATH, else via npx.
//   SVG:     rsvg-convert, else ImageMagick, else headless Chrome.

export type VizKind = "mermaid" | "svg";

const CHROME_CANDIDATES = [
	process.env.PUPPETEER_EXECUTABLE_PATH,
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
];

function which(cmd: string): string | undefined {
	const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
	return r.status === 0 ? r.stdout.split("\n")[0]!.trim() || undefined : undefined;
}

function findChrome(): string | undefined {
	return CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
}

export interface Doctor {
	mermaid: string | undefined;
	svg: string | undefined;
	chrome: string | undefined;
	advice: string[];
}

export function doctor(): Doctor {
	const mmdc = which("mmdc");
	const rsvg = which("rsvg-convert");
	const magick = which("magick");
	const chrome = findChrome();
	const advice: string[] = [];
	if (!mmdc) advice.push("Mermaid: `npm install -g @mermaid-js/mermaid-cli` (first run falls back to npx, which is slow).");
	if (!mmdc && !chrome) advice.push("mermaid-cli needs a browser: install Google Chrome, or run `npx puppeteer browsers install chrome-headless-shell`.");
	if (!rsvg && !magick && !chrome) advice.push("SVG: `brew install librsvg` (provides rsvg-convert).");
	return {
		mermaid: mmdc ? `mmdc (${mmdc})` : "npx @mermaid-js/mermaid-cli (slow first run)",
		svg: rsvg ? `rsvg-convert (${rsvg})` : magick ? `magick (${magick})` : chrome ? `headless browser (${chrome})` : undefined,
		chrome,
		advice,
	};
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): void {
	execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 180_000, env: { ...process.env, ...env } });
}

function errText(err: unknown): string {
	const e = err as { stderr?: Buffer; message?: string };
	return (e.stderr?.toString().trim() || e.message || String(err)).slice(0, 2000);
}

function renderMermaid(src: string, out: string, width: number): void {
	const work = path.dirname(src);
	const cfg = path.join(work, "puppeteer.json");
	const chrome = findChrome();
	fs.writeFileSync(cfg, JSON.stringify({ args: ["--no-sandbox"], ...(chrome ? { executablePath: chrome } : {}) }));
	const args = ["-i", src, "-o", out, "-b", "white", "-s", "2", "-w", String(width), "-p", cfg, "-q"];
	const mmdc = which("mmdc");
	if (mmdc) run(mmdc, args);
	else run("npx", ["-y", "-p", "@mermaid-js/mermaid-cli@11", "mmdc", ...args]);
}

function renderSvg(src: string, out: string, width: number): void {
	const rsvg = which("rsvg-convert");
	if (rsvg) return run(rsvg, ["-w", String(width * 2), "-b", "white", "-o", out, src]);
	const magick = which("magick");
	if (magick) return run(magick, ["-density", "192", "-background", "white", src, "-flatten", out]);
	const chrome = findChrome();
	if (chrome) {
		const body = fs.readFileSync(src, "utf8");
		const vb = /viewBox="[\d.\s-]+?\s([\d.]+)\s([\d.]+)"/.exec(body);
		const h = vb ? Math.ceil((width * Number(vb[2])) / Number(vb[1])) : width;
		const html = path.join(path.dirname(src), "page.html");
		fs.writeFileSync(html, `<html><body style="margin:0;background:white"><img src="${path.basename(src)}" style="width:${width}px;display:block"></body></html>`);
		return run(chrome, ["--headless", "--disable-gpu", "--hide-scrollbars", `--window-size=${width},${h}`, `--screenshot=${out}`, `file://${html}`]);
	}
	throw new Error("no SVG renderer found. Install librsvg (`brew install librsvg`) or Google Chrome.");
}

export interface VizResult {
	png: Buffer;
	saved?: { filename: string; path: string };
}

/**
 * Render source to PNG. With `saveAs`, also publish it into `<root>/viz/`
 * under a unique name (Obsidian resolves embeds by filename, so it must be unique).
 */
export function renderViz(kind: VizKind, source: string, opts: { root: string; saveAs?: string; width?: number }): VizResult {
	const width = opts.width ?? 900;
	const work = fs.mkdtempSync(path.join(os.tmpdir(), "learn-viz-"));
	try {
		const src = path.join(work, kind === "mermaid" ? "diagram.mmd" : "diagram.svg");
		const out = path.join(work, "out.png");
		fs.writeFileSync(src, source, "utf8");
		try {
			if (kind === "mermaid") renderMermaid(src, out, width);
			else renderSvg(src, out, width);
		} catch (err) {
			throw new Error(`render failed:\n${errText(err)}`);
		}
		if (!fs.existsSync(out)) throw new Error("renderer produced no image");
		const png = fs.readFileSync(out);
		let saved: VizResult["saved"];
		if (opts.saveAs) {
			const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
			const filename = `viz-${slugify(opts.saveAs, 40)}-${stamp}.png`;
			const dest = path.join(opts.root, "viz", filename);
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.writeFileSync(dest, png);
			saved = { filename, path: dest };
		}
		return { png, saved };
	} finally {
		fs.rmSync(work, { recursive: true, force: true });
	}
}
