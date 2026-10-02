import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const DAY_MS = 86_400_000;

export function iso(d: Date): string {
	return d.toISOString();
}

/** Local calendar date, YYYY-MM-DD. */
export function ymd(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, days: number): Date {
	return new Date(d.getTime() + days * DAY_MS);
}

/** Whole calendar days from `a` to `b` (local dates). */
export function calendarDaysBetween(a: Date, b: Date): number {
	const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
	const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
	return Math.round((db - da) / DAY_MS);
}

/** Parse YYYY-MM-DD as local end-of-day. */
export function parseYmd(s: string): Date {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) throw new Error(`expected a YYYY-MM-DD date, got "${s}"`);
	return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
}

export function slugify(s: string, max = 48): string {
	const slug = s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, max)
		.replace(/-+$/g, "");
	return slug || "untitled";
}

export function readJson<T>(file: string): T | undefined {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as T;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw new Error(`could not read ${file}: ${(err as Error).message}`);
	}
}

/** Write via temp file + rename so a crash never leaves a half-written file. */
export function writeAtomic(file: string, content: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, content, "utf8");
	fs.renameSync(tmp, file);
}

export function writeJson(file: string, value: unknown): void {
	writeAtomic(file, JSON.stringify(value, null, 2) + "\n");
}

export function sha256File(file: string): string {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function shortHash(s: string): string {
	return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

/** "A", "B", ... "Z", "AA" */
export function letter(i: number): string {
	let s = "";
	let n = i;
	do {
		s = String.fromCharCode(65 + (n % 26)) + s;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return s;
}
