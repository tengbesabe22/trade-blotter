# Prompt Log

Selected significant prompts from development. Excerpts are shortened for brevity;
outcomes summarize the discussion, review and resulting implementation.

## 1. Planning before implementation

**Context:** During initial planning, I supplied the project brief, role expectations,
sample trade data, preferred stack, deadline and initial design ideas. I invited
Codex to question the assumptions and discuss alternatives.

**Prompt:** “WE will need to make a design spec for this project and we will collaborate on this project together. I've read through the document and I will attach all the background you need for our task.”

**Follow-up example:** “Let's start the cancel trade UI next. Keep it small, test first, and walk me through the plan before coding.”

**Outcome:** We produced a design specification before bootstrapping and refined it
as implementation clarified the requirements. Features needing careful design
returned to plan-first reviews, including UI flows, audit storage, live updates
and summaries.

## 2. Atomic concurrency control

**Prompt:** “Both could succeed because the check and update are separate. We should include the expected version in the update WHERE clause and increment it atomically.”

**Outcome:** I proposed the guard. Codex helped examine races and implement
ownership/status/version predicates with conflict responses. Unit tests simulate
losing updates; actual database concurrency remains a separate verification gap.

## 3. Durable events with low-latency updates

**Prompt:** “can we implement a transaction outbox for this?”

**Outcome:** My outbox proposal became transactional trade/audit/summary/event
writes. Discussion with Codex led to REST + SSE without a separate queue, immediate
post-commit wake-up and an in-process relayer/broadcaster. Single-instance limits
and the production broker/worker path were documented.

## 4. Developer implementation with AI tests and review

**Prompt:** “write the test then I implement them after you scaffold it”

**Outcome:** Codex supplied tests and scaffolding for early trade APIs. I implemented
listing/creation steps; Codex reviewed the contracts, repository and POST wiring,
fixed remaining cases and ran checks. Later feature slices delegated more of the
implementation to Codex.

## 5. Runtime validation

**Prompt:** “I will use zod now for the trade contract and use that for validation as well.”

**Outcome:** I selected Zod and worked on the initial contracts and normalization.
Codex identified gaps, completed validation and decimal handling, and aligned
inferred types, API payloads and fingerprinting inputs.

## 6. Authentication and ownership

**Prompt:** “Let's use individual email/password accounts, traders can view all trades but only amend or cancel their own, and reviewers are read-only.”

**Outcome:** Codex implemented database sessions, HttpOnly cookies, server-side
role/ownership checks and the corresponding UI. Review removed a local login
limiter; federation/shared limiting were retained as production considerations.
The final idle policy is 15 minutes, with an eight-hour maximum.

## 7. Simpler pagination

**Prompt:** “Keep server-side sorting and filtering, use forward-only cursors with Previous handled by the frontend.”

**Outcome:** I rejected the earlier cursor complexity. Codex replaced signed and
bidirectional handling with standard forward boundaries, a frontend cursor history
and reset-on-filter/sort changes, preserving server-side query bounds.

## 8. Developer-supplied UI design

**Prompt:** “The amend and the cancelation confirmation will also be in the Create Trade window panel.”

**Outcome:** I supplied the workspace sketch and interaction requirements. Codex
implemented the table/right-panel layout, preserved creation drafts, added shared
action panels and replaced row text actions with accessible icons/tooltips.

## 9. Scoped frontend implementation and review

**Prompt:** “Let's connect the frontend to SSE and update the trade table through the TanStack Query cache next. Keep it small, test first, and walk me through the changes.”

**Outcome:** Codex implemented the browser subscription and live cache integration
in reviewed slices. I examined snapshot/event races and reconnect behavior and
manually checked propagation with two signed-in clients. Later work extended the
same flow to the tabbed Position Summary.

## 10. One event contract

**Prompt:** “Use one event contract with trade and summaries, remove the version 1/2 branching, and keep the trade and summary versions.”

**Outcome:** I requested simpler event handling. Codex removed compatibility branches
while retaining per-entity revisions for duplicate/out-of-order protection. Events
carry absolute summary snapshots; the frontend does not add received totals twice.

## 11. Outbox recovery trade-off

**Prompt:** “let's remove the periodic polling, keep startup recovery, and use a one-shot timer for retries.”

**Outcome:** Codex removed idle polling and implemented targeted retry timers.
I accepted the trade-off that a missed wake in a running process waits for another
trade or restart; independent recovery remains production work.

## 12. Deployment performance diagnosis

**Prompt:** “All Deployed but it is real slow”

**Outcome:** I supplied browser timings and operated deployments. Codex compared
network/server timings and added preflight permission caching plus JSON-only Caddy
gzip. I confirmed gzip, a reduction from 38.5 KB to 3.9 KB, and 301 ms to 168 ms
for the sampled trade read. These observations are not load-test percentiles.

## 13. Readable structure and meaningful tests

**Prompt:** “Keep the assertions and behavior the same, update the test discovery and imports, then walk me through the changes.”

**Outcome:** Codex reorganized frontend/backend tests separately and verified the
same test-name sets before and after each move. My review drove folder boundaries
and smaller commits. The risk-focused audit checked permissions, mutation conflicts,
idempotency, SSE/cache races and error states; all 772 tests passed, with real-DB
and browser-E2E limits stated explicitly.

## Practices evidenced in the workflow

This retrospective check maps recorded behavior to
[OpenAI's Codex guidance](https://learn.chatgpt.com/guides/best-practices).

| Practice | Evidence from this project |
| --- | --- |
| Plan complex work | Initial design specification and feature-specific plan-before-code prompts. |
| Supply context and constraints | Requirements, sample payloads, ownership rules, UI sketches and failure scenarios. |
| Keep guidance reusable | `AGENTS.md` records coding conventions, test-first expectations and collaboration rules. |
| Keep changes reviewable | API/UI and frontend/backend test restructuring were separated after review. |
| Verify outcomes | Failing-test iterations, type/build/lint checks and matching test-name sets after moves. |
| Review and challenge results | Simplified cursors/event formats; manual two-client checks and measured performance feedback. |
