# A class session

## Open

1. You've already called `learn_status`. Read `CLASS.md`.
2. **Open exercises?** Ask whether they've done them. If they have work to submit — pasted text, a photo in chat, or a file in `submissions/` (check with Glob) — grade it now (see Exercises below).
3. **Unread sources?** Offer to fold them in ([sources.md](sources.md)) — now, or at the end.
4. `session_start({title})` with a title naming the main thing today (you can use the first `next` item).
5. Tell them the plan in one or two lines: "Two quick reviews, then we fix the shaky bit on *span*, then new: *basis*."

## The loop

Work through `next`, one item at a time. Call `next` again after each item — results change what's due.

**`remediate`** — a node that's shaky or holds a misconception. The reason lists the node's prerequisites: if the miss looks like it comes from one of them, check that one first (a quick cold question) and fix it before re-teaching this node. If the reason names a broken link from a derive check ("couldn't get from A to C"), the node itself may be fine — re-teach how C follows from A, and check A directly first if the miss looks like A is the weak part. Otherwise, don't just repeat the old explanation. Find the specific wrong model (the recorded misconception, or probe for it), show why it fails — ideally let them find the counterexample — then rebuild the node from its prerequisites and check again with a *different* question than the one they missed.

**`review`** — spaced re-verification. Ask **one** question, cold, no re-teaching first, and pass on their confidence answer. If the reason says the node needs a derive check or a free-response exercise, use that instead of multiple choice. Choose the check kind the reason asks for ("needs a transfer check") — a different kind from earlier passes is what turns *passing* into *solid*. For an *assumed* node, a quick direct check is enough. If they miss, it becomes remediation — do that before new material.

For a **breadth** node the reason says "follow-up check after a miss": one cold question confirms it; a clean pass ends its reviews.

**`teach`** — a new node. Run the `teach` skill's loop: motivate → establish → connect → `node_taught` → check. Teach the foundation it rests on if a probe reveals it's missing (and add it to the map).

**`practice`** — a covered **breadth** node that could use more problems. The reason says how many they've done and which difficulty to try next. Assign one problem with `exercise_assign` and its `difficulty`; vary the problem type, not just the numbers. A clean solve keeps it covered; a miss turns it into remediation. Practice comes after new material, so don't let it crowd out new nodes unless they ask to drill.

If they decide a breadth node matters more than planned ("I keep needing this"), promote it: `graph_apply` with `depth: "deep"` and a `depth_reason`. Its evidence carries over and is judged against the full bar.

**`done`** — nothing due. Say so; offer to pull a review forward, practise, extend the map, or stop.

## Exercises

Assign one when a node is best mastered by doing (derivations, proofs, computation, coding problems), typically right after it's taught or as the second check. `exercise_assign` stores your solution and rubric, so it can be graded in a later session; tell them how to submit (paste it, drop a photo into `submissions/`, or come back with their LeetCode solution).

Grading: `exercise_list({id})` for the stored solution and rubric → `Read` any image or file they submitted → judge the *work*, step by step → `exercise_submit` with result, honest `hints`, `misconception` if one showed, and feedback naming the step that went wrong. Partial credit is `partial`. For code: correctness first, then complexity and edge cases.

## Pacing

Default to self-paced: follow `next` and keep going while it's working. Watch energy — shorter answers, more misses, "ok" → offer to wrap up. A good session is often 3–6 items; quality over count. If they mention a test or deadline, switch to [goals.md](goals.md).

If they want something off-plan ("can we do eigenvalues today?"), do it — but if its prerequisites aren't satisfied, say which ones and offer to cover those first. Their call.

## Close

1. `session_end({summary})`: what landed, what didn't, what's next — one or two sentences.
2. Tell them: what's solid now, what's due for re-check next time (and roughly when), what the next new node is, and any open exercises.
