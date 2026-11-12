# Project collaboration

## Delivery and readability

- Work in small, reviewable feature slices. Prioritize clear names, explicit units, useful whitespace, and comments explaining non-obvious decisions.
- Use semicolons consistently in JavaScript and TypeScript. Backend local imports are extension-free and are resolved by its bundler.
- Keep persistence queries in typed feature repositories; keep startup focused on wiring dependencies and starting the server.
- Use clear, product-focused wording in code and documentation.
- Do not commit or push unless the user requests it.

## Test-driven development

- For new behavior and bug fixes, first write a focused test of the required observable behavior. Run it and confirm it fails for the intended reason.
- Implement the smallest change that makes the test pass, then refactor while keeping the checks green.
- Test business rules, error paths, and boundary conditions. Avoid tests that merely repeat implementation details.
- Use fake repositories and an injectable clock for authentication tests. Do not introduce real-database integration tests unless the user asks for them.
- For documentation, formatting, and build-only changes, use relevant validation/build/runtime checks rather than inventing behavioral tests.
- Run checks appropriate to the change; report what actually ran and material limitations.

## Collaboration

- Distinguish implemented behavior from planned architecture.
- Explain key decisions and tradeoffs clearly; keep reviews manageable.
