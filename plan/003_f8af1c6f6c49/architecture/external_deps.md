# External dependencies — delta 003

No new external dependencies. The delta touches only first-party panel/schema code within the existing stack:
- `@earendil-works/pi-tui` ^0.85.1 (panel TUI), `typebox` 1.3.7 (tool schema), `vitest` ^1 (tests), `typescript` ^5 (typecheck).
No external services, no network, no new APIs. All isolation is local: scripted vitest with the existing panel test harness; nothing to mock beyond the panel's own test doubles (see plan/001 AUTOMATION-POLICY).
