// LaTeX → readable Unicode for places that can't render math (the terminal
// question picker). The session note keeps the original LaTeX for Obsidian.

const SYMBOLS: Record<string, string> = {
	alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
	iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
	phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
	Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
	langle: "⟨", rangle: "⟩", cdot: "·", cdots: "⋯", ldots: "…", dots: "…", times: "×", div: "÷", pm: "±", mp: "∓",
	to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐", leftrightarrow: "↔", iff: "⇔", implies: "⇒", mapsto: "↦",
	le: "≤", leq: "≤", ge: "≥", geq: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡", sim: "∼", propto: "∝", ll: "≪", gg: "≫",
	infty: "∞", partial: "∂", nabla: "∇", hbar: "ħ", ell: "ℓ", int: "∫", oint: "∮", iint: "∬", sum: "Σ", prod: "Π",
	in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", supset: "⊃", cup: "∪", cap: "∩", emptyset: "∅", varnothing: "∅",
	forall: "∀", exists: "∃", neg: "¬", land: "∧", lor: "∨", wedge: "∧", vee: "∨", oplus: "⊕", otimes: "⊗", circ: "∘",
	dagger: "†", perp: "⊥", parallel: "∥", angle: "∠", degree: "°", prime: "′", star: "⋆", ast: "∗",
	quad: " ", qquad: "  ", ",": " ", ";": " ", "!": "", " ": " ", lbrace: "{", rbrace: "}", vert: "|", Vert: "‖", mid: "|",
	log: "log", ln: "ln", exp: "exp", sin: "sin", cos: "cos", tan: "tan", det: "det", lim: "lim", max: "max", min: "min",
};

const SUP: Record<string, string> = {
	"0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
	"+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", T: "ᵀ", "*": "*", "†": "†", "′": "′",
};
const SUB: Record<string, string> = {
	"0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
	"+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", i: "ᵢ", j: "ⱼ", k: "ₖ", n: "ₙ", x: "ₓ",
};
const BLACKBOARD: Record<string, string> = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ" };

/** Match a {...} group starting at s[i] === "{"; returns [content, endIndex]. */
function group(s: string, i: number): [string, number] {
	let depth = 0;
	for (let j = i; j < s.length; j++) {
		if (s[j] === "{") depth++;
		else if (s[j] === "}" && --depth === 0) return [s.slice(i + 1, j), j + 1];
	}
	return [s.slice(i + 1), s.length];
}

function script(body: string, table: Record<string, string>, mark: string): string {
	const mapped = [...body].map((c) => table[c]);
	return mapped.every(Boolean) ? mapped.join("") : `${mark}${body.length > 1 ? `(${body})` : body}`;
}

function convertMath(s: string): string {
	let out = "";
	let i = 0;
	while (i < s.length) {
		const c = s[i]!;
		if (c === "\\") {
			const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
			const name = m ? m[1]! : "";
			i += name.length + 1;
			const arg = () => {
				while (s[i] === " ") i++;
				if (s[i] !== "{") return "";
				const [g, end] = group(s, i);
				i = end;
				return convertMath(g);
			};
			if (name === "frac" || name === "dfrac" || name === "tfrac") {
				const a = arg();
				const b = arg();
				const wrap = (x: string) => (/^[\w.ⁿ⁰-⁹²³¹]+$/u.test(x) ? x : `(${x})`);
				out += `${wrap(a)}/${wrap(b)}`;
			} else if (name === "sqrt") out += `√${(() => { const a = arg(); return a.length > 1 ? `(${a})` : a; })()}`;
			else if (name === "mathbb") out += [...arg()].map((ch) => BLACKBOARD[ch] ?? ch).join("");
			else if (["text", "mathrm", "mathbf", "mathit", "mathcal", "operatorname", "textbf", "textit", "boldsymbol", "vec", "hat", "bar", "overline", "tilde"].includes(name)) {
				const a = arg();
				out += name === "vec" ? `${a}⃗` : name === "hat" ? `${a}̂` : name === "bar" || name === "overline" ? `${a}̄` : name === "tilde" ? `${a}̃` : a;
			} else if (name === "left" || name === "right" || name === "big" || name === "Big" || name === "bigg" || name === "displaystyle") {
				/* sizing: drop */
			} else if (name === "{" || name === "}") out += name;
			else {
				const sym = SYMBOLS[name] ?? name;
				out += sym;
				// LaTeX eats the space after a control word: \Delta E is "ΔE". Keep
				// the space after operators (\cdot, \to) where it reads better.
				if (/^[\p{L}ħℓ∂∇]$/u.test(sym) && s[i] === " " && /[\p{L}\d]/u.test(s[i + 1] ?? "")) i++;
			}
		} else if (c === "^" || c === "_") {
			i++;
			let body: string;
			if (s[i] === "{") {
				const [g, end] = group(s, i);
				body = convertMath(g);
				i = end;
			} else if (s[i] === "\\") {
				const m = /^\\([a-zA-Z]+)/.exec(s.slice(i));
				body = m ? (SYMBOLS[m[1]!] ?? m[1]!) : "";
				i += m ? m[0].length : 1;
			} else body = s[i++] ?? "";
			out += c === "^" ? script(body, SUP, "^") : script(body, SUB, "_");
		} else if (c === "{" || c === "}") i++;
		else {
			out += c;
			i++;
		}
	}
	return out.replace(/ {2,}/g, " ");
}

/** Convert $…$ / $$…$$ spans to Unicode; text outside math is untouched. */
export function latexToUnicode(text: string): string {
	return text.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (_, display: string | undefined, inline: string | undefined) => convertMath((display ?? inline)!.trim()));
}
