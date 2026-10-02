---
name: visualize
description: Add a correct, minimal visual to a lesson — a diagram or geometric picture rendered inline in the session note. Use when an idea is genuinely clearer as a picture (a dependency graph, system or flow, sequence, state machine, tree, comparison, or a spatial/geometric thing like coordinates, a number line, vectors, a plot). Delegates authoring and rendering to the diagram-maker subagent, which verifies the image by looking at it.
user-invocable: false
---

# Visualize

A picture earns its place only when it shows something words can't — shape, structure, direction, relationship, geometry. This skill produces ONE such picture, guarantees it is **correct** (the maker renders it and looks at it before returning), and embeds it so it renders inline in the Obsidian note.

You are the **creative director**: you decide the exact idea and distill it to its fewest carrying elements. The `learn:diagram-maker` subagent authors, renders, verifies and saves, then returns a filename.

## When to visualize (and when not to)

Reach for a picture when the idea is:
- **A structure or relationship** — dependencies, a system with parts and arrows, a pipeline, a sequence of exchanges, a state machine, a hierarchy, a comparison, containment.
- **Spatial or geometric** — coordinate geometry, a number line, vectors, a function's shape, a physical arrangement.

Don't when prose or a single equation already carries it. A decorative diagram that restates the sentence beside it adds noise and a chance to be wrong. When in doubt, don't.

**Quick structural diagrams don't need the maker.** A small mermaid graph (a lesson plan, a 3–6 node dependency sketch) can go straight into your reply as a ```mermaid block — Obsidian renders it natively. Use the maker when correctness depends on seeing the result: geometry, precise layouts, anything dense.

## Brief the maker: one idea, fewest elements

The most common failure is **cramming**. Before briefing, prune: for each element ask "if I delete this, is the idea still clear?" If yes, delete it. Give the concept AND the concrete elements — not a vague topic, not a long checklist.

- BAD: "make a diagram about how TCP works"
- GOOD: "graph TD: 'packet' at the top; arrows down to 'ordering' and 'retransmit on loss'; both arrows down into 'reliable stream'. No title. Show that reliability is built FROM packets, not alongside them."
- GOOD (svg): "Unit circle, axes from −1.5 to 1.5. Point P at angle 60° on the circle, labelled P. Dashed drop from P to the x-axis. Label the horizontal leg cos θ and the vertical leg sin θ. Mark θ at the origin."

If your brief lists more than ~5–7 elements, cut it first.

## Invoke

Dispatch with the Agent tool: `subagent_type: "learn:diagram-maker"`, prompt = your brief. It returns:

```
RESULT:
filename: viz-<slug>-<timestamp>.png
path: <folder>/viz/viz-<slug>-<timestamp>.png
```

`RESULT: NONE` means it couldn't make a correct picture — simplify, rethink, or drop the visual. If the reason is that no renderer is installed, tell the learner once how to set it up (it's in the reason) and fall back to a simple ```mermaid block. Never hand-author a geometric picture without the maker; correctness depends on its render-and-inspect loop.

## Embed it

Put the embed in your teaching reply, with the returned **filename** (not the path) and a width:

```
![[viz-<slug>-<timestamp>.png|500]]
```

Your reply is mirrored into the session note, and Obsidian resolves the embed by filename anywhere in the vault, so it renders inline. Use a larger width for dense diagrams. Introduce it in a sentence, then let it carry the idea — don't narrate every element back in prose.
