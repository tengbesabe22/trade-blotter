# AI Usage Report

## Tools used

I used **OpenAI Codex** extensively throughout development. Official documentation
retrieval, including Firecrawl/web search, supported technical research; local
CLI tools provided test, type-check and build results.

## Planning and evolving design

Before bootstrapping the repository, I worked extensively with Codex to clarify
requirements, assumptions, domain rules, architecture and API contracts. This
produced a design specification that evolved as implementation and review exposed
new questions about pagination, live-data consistency, summaries and deployment.

For features requiring careful design, our working rule was to agree the plan,
contracts, failure cases and trade-offs before coding. Implementation then proceeded
in reviewable slices. Reusable conventions and verification rules were recorded in
`AGENTS.md`.

## How AI was used

Codex generated substantial backend and frontend implementation, tests, refactors
and documentation. It implemented complete feature slices, including authentication,
trade mutations, SSE delivery, frontend forms and live caches, audit history,
Position Summary, logging and deployment configuration.

The work was iterative. I implemented parts of the early trade-listing and creation
flow, asked Codex to review and complete them, and increasingly delegated coding
while directing the design and review. Test-first iterations were used for much of
the feature work. I asked for explanations, challenged complexity and reviewed
critical flows. I also operated the cloud deployments, tested with separate browser
sessions and supplied performance measurements for diagnosis.

## Design input and AI influence

| My input and decisions | How Codex contributed |
| --- | --- |
| Chose familiar tooling: Hono, React/Vite, pnpm, PostgreSQL/Prisma; selected Zod for contracts. | Scaffolded the project, implemented validation and refined boundaries between contracts, routes and repositories. |
| Proposed an atomic update with the expected version in the WHERE clause. | Worked through concurrent-change cases and implemented guarded updates and conflict responses. |
| Proposed a transactional outbox and required immediate client updates. | Helped compare SSE and WebSockets, then implemented post-commit delivery, retries, broadcasting and version-aware Query cache updates. |
| Defined individual accounts, ownership/read-only permissions, terminal cancellation and the workspace layout. | Implemented server/UI checks, shared action panels, forms, accessible controls and interaction tests. |
| Prioritized readability, small reviewable changes and explicit scope limits. | Simplified pagination/event contracts, reorganized modules/tests, and documented current limits and the production scaling path. |

## Suggestions accepted, refined or rejected

- **Accepted:** REST + SSE, full trade/summary snapshots, fresh snapshots after
  reconnects, database sessions and a broker-free outbox for one API instance.
- **Simplified:** signed/query-fingerprinted and bidirectional cursors became
  forward-only cursors, with Previous handled by frontend cursor history.
- **Rejected:** parallel event-format versions; one event contract retains the
  independent trade and summary versions needed for correctness.
- **Revised:** periodic outbox polling became post-commit wakes, startup recovery
  and one-shot retries. I accepted the documented missed-wake limitation.
- **Removed:** the instance-local login limiter; federation and shared rate limiting
  remain documented production work.

## Example prompts

- “write the test then I implement them after you scaffold it”
- “Let's connect the frontend to SSE and update the trade table through the TanStack Query cache next. Keep it small, test first, and walk me through the changes.”
- “Keep server-side sorting and filtering, use forward-only cursors with Previous handled by the frontend.”

See the [Prompt Log](prompt-log.md) for significant prompts and summarized outcomes.

## Verification and limits

The latest local runs passed **772 tests**: 444 backend, 317 frontend and 11 seed
helpers. Type checks, builds and frontend lint also passed. I manually checked
deployed login, session restoration and two-client live updates.

Database fakes and JSDOM tests do not prove real PostgreSQL concurrency/rollback,
SQL trigger enforcement or full browser E2E behavior. Individual browser timing
checks are separate from load-test percentiles, which remain unmeasured.
