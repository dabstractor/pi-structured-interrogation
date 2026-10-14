# External dependencies — delta 004 (keymap trilogy)

None new. No external technology enters this delta; all work is internal to the existing stack:

- `@earendil-works/pi-tui` ^0.85.1 — already used for key handling (`Key`, `matchesKey`, `parseAccelerator`, `parseKey` in `src/panel/keys.ts`). The two-tier classifier and hjkl aliases build on these existing primitives; no upstream docs research required.
- `typebox`, `vitest`, `tsc` — unchanged roles (schema, scripted tests, typecheck gates).
- `scripts/verify-keymap-conflicts.sh` — in-repo conflict checker (parses `DEFAULT_CONFIG.keys`); re-run, not replaced.

No web research was needed; the authoritative external contract is the in-repo spec corpus synced at `8c5f870` (read-only for this delta).
