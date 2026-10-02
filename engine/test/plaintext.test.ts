import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createQuiz, gradeQuiz, resolveSelection } from "../src/core/assess.ts";
import { latexToUnicode } from "../src/core/plaintext.ts";
import type { AssessState } from "../src/core/types.ts";
import { T0 } from "./helpers.ts";

describe("latexToUnicode", () => {
	const cases: [string, string][] = [
		["two states, $|0\\rangle$ and $|1\\rangle$", "two states, |0⟩ and |1⟩"],
		["$x^2 + y_1 = \\frac{a}{b}$", "x² + y₁ = a/b"],
		["$\\sqrt{2}\\pi \\hbar \\omega$", "√2π ħ ω"],
		["$\\frac{1}{\\sqrt{2}}(|0\\rangle + e^{i\\phi}|1\\rangle)$", "1/(√2)(|0⟩ + e^(iφ)|1⟩)"],
		["$\\mathbb{R}^n$ and $\\Delta E \\cdot \\Delta t \\geq \\hbar/2$", "ℝⁿ and ΔE · Δt ≥ ħ/2"],
		["$$\n\\int_0^\\infty e^{-x} dx = 1\n$$", "∫₀^∞ e⁻ˣ dx = 1".replace("⁻ˣ", "^(-x)")],
		["no math here, costs $5", "no math here, costs $5"],
	];
	for (const [input, want] of cases) it(input, () => assert.equal(latexToUnicode(input), want));
});

describe("quiz answers from the terminal picker", () => {
	const a: AssessState = { counter: { quiz: 0, exercise: 0 }, quizzes: {}, exercises: {} };
	const q = createQuiz(a, undefined, { question: "?", options: [{ label: "The phase of $|1\\rangle$" }, { label: "Nothing" }], correct: [0] }, T0);
	it("matches the Unicode label shown in the picker", () => {
		assert.deepEqual(resolveSelection(q, ["A. The phase of |1⟩"]), [0]);
		assert.deepEqual(resolveSelection(q, ["The phase of |1⟩"]), [0]);
		assert.deepEqual(resolveSelection(q, ["B"]), [1]);
	});
	it("treats 'I don't know' as an honest miss", () => {
		assert.deepEqual(resolveSelection(q, ["I don't know"]), []);
		const g = gradeQuiz(a, undefined, q.id, [], T0);
		assert.equal(g.result, "wrong");
		assert.deepEqual(g.chosen, ["I don't know"]);
	});
});
