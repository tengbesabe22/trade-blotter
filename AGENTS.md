# Project collaboration

## Delivery and readability

- Work in small, reviewable feature slices. Prioritize clear names, explicit units, useful whitespace, and comments explaining non-obvious decisions.
- Use semicolons consistently in JavaScript and TypeScript. Backend local imports are extension-free and are resolved by its bundler.
- Keep persistence queries in typed feature stores; keep startup focused on wiring dependencies and starting the server.
- Keep product code and documentation free of recruiting context.
- Do not commit or push unless the user requests it.

## Test-driven development

- For new behavior and bug fixes, first write a focused test of the required observable behavior. Run it and confirm it fails for the intended reason.
- Implement the smallest change that makes the test pass, then refactor while keeping the checks green.
- Test business rules, error paths, and boundary conditions. Avoid tests that merely repeat implementation details.
- Use fake stores and an injectable clock for authentication tests. Do not introduce real-database integration tests unless the user asks for them.
- For documentation, formatting, and build-only changes, use relevant validation/build/runtime checks rather than inventing behavioral tests.
- Run checks appropriate to the change; report what actually ran and material limitations.

## AI collaboration

- Keep `docs/ai-usage.md` current with meaningful contributions, developer decisions/revisions, and verified results.
- Distinguish implemented behavior from planned architecture. Record TDD from its actual adoption; do not describe earlier work as test-first.
- Help the user understand and defend each decision. Interview practice should ask one question at a time when requested.
