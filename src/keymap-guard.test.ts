/**
 * src/keymap-guard.test.ts — keymap conflict regression guard (P1.M7.T7.S2).
 *
 * Machine-checked companion to `scripts/verify-keymap-conflicts.sh` and the
 * README "Keymap conflict re-verification" record (PRD h2.34/h2.50):
 *
 *   1. NO default in `DEFAULT_CONFIG.keys` may sit on a key that is known to
 *      be TAKEN — extension-registered global shortcuts (pi-patty-bg-tasks,
 *      pi-web-access), terminal-level dead keys (`ctrl+m` sends `\r`), or pi
 *      transcript-level features (altScreen search / prompt nav). Adding or
 *      rebinding a default onto one of these fails CI here.
 *
 *      Deliberately NOT in the avoided list: pi's own panel-scoped built-ins
 *      (`ctrl+d/l/t/s/g`, `tab`, `shift+tab`). The panel reuses them ON
 *      PURPOSE — its `custom()` component intercepts input before pi's
 *      binding layer sees it (intercept-before-forward, src/panel/keys.ts),
 *      so the built-ins are shadowed only while the panel is open. Those are
 *      verified live by the shell script, not forbidden here.
 *
 *   2. Every default must be a syntactically valid accelerator — pi's
 *      lowercase "modifier+…+base" grammar (see `parseAccelerator` in
 *      src/panel/keys.ts:155-168): "+"-separated tokens, modifier prefixes
 *      from {ctrl, shift, alt, super}, final token a base key name.
 *
 *   3. The keys map must stay COMPLETE: exactly the 10 configured KeyActions
 *      (fixed keys enter/esc/arrows/digits are intentionally absent from
 *      config — h2.34 — so they are NOT checked here).
 *
 * The shell script additionally re-greps the installed extension trees at
 * build time (extensions drift; this static list cannot). Run it before
 * shipping any key change — README "Keymap conflict re-verification".
 */
import { describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, type KeyAction } from "./config.js";

/** All KeyActions that must have a default binding (config.ts KEY_ACTIONS order). */
const ALL_ACTIONS: KeyAction[] = [
	"deep",
	"overview",
	"focusText",
	"batchNote",
	"submit",
	"breakOut",
	"discuss",
	"externalEditor",
	"prevQuestion",
	"nextQuestion",
];

/**
 * Keys that are TAKEN — a default must never be any of these.
 * Keep in sync with scripts/verify-keymap-conflicts.sh (AVOIDED array) and
 * the README "Keymap conflict re-verification" table.
 */
const AVOIDED_KEYS: ReadonlyArray<{ key: string; owner: string; reason: string }> = [
	{ key: "ctrl+b", owner: "pi-patty-bg-tasks", reason: "global shortcut (src/shortcuts.ts:28)" },
	{ key: "ctrl+shift+b", owner: "pi-patty-bg-tasks", reason: "global shortcut (src/shortcuts.ts:34)" },
	{ key: "ctrl+shift+j", owner: "pi-patty-bg-tasks", reason: "global shortcut (src/shortcuts.ts:39)" },
	{ key: "shift+down", owner: "pi-patty-bg-tasks", reason: "global shortcut (src/shortcuts.ts:44)" },
	{ key: "ctrl+shift+x", owner: "pi-patty-bg-tasks", reason: "global shortcut (src/shortcuts.ts:49)" },
	{
		key: "ctrl+shift+s",
		owner: "pi-web-access",
		reason: "curate shortcut (DEFAULT_SHORTCUTS index.ts:99, registerShortcut index.ts:1044)",
	},
	{
		key: "ctrl+shift+w",
		owner: "pi-web-access",
		reason: "activity shortcut (DEFAULT_SHORTCUTS index.ts:99, registerShortcut index.ts:1057)",
	},
	{ key: "ctrl+m", owner: "terminal", reason: "ctrl+m sends \\r (carriage return) — unusable as a chord" },
	{ key: "ctrl+shift+f", owner: "pi built-in", reason: "tui.altScreen.search — transcript search (docs/keybindings.md:114)" },
	{ key: "ctrl+shift+up", owner: "pi built-in", reason: "tui.altScreen.previousPrompt — transcript nav (docs/keybindings.md:112)" },
	{ key: "ctrl+shift+down", owner: "pi built-in", reason: "tui.altScreen.nextPrompt — transcript nav (docs/keybindings.md:113)" },
];

/** Pi accelerator grammar (lowercase form, src/panel/keys.ts parseAccelerator). */
const ACCELERATOR_GRAMMAR = /^([a-z0-9]+\+)*[a-z0-9]+$/;

describe("keymap conflict guard (P1.M7.T7.S2, PRD h2.34/h2.50)", () => {
	test("test_no_default_key_is_on_a_taken_or_avoided_key", () => {
		const taken = new Map(AVOIDED_KEYS.map((a) => [a.key, a]));
		for (const [action, key] of Object.entries(DEFAULT_CONFIG.keys)) {
			const hit = taken.get(key);
			expect(
				hit,
				`keys.${action} = "${key}" sits on a TAKEN key — owned by ${hit?.owner ?? "?"}: ${hit?.reason ?? "?"}. Rebind it (PRD h2.34 keymap verification).`,
			).toBeUndefined();
		}
	});

	test("test_every_default_matches_the_pi_accelerator_grammar", () => {
		for (const [action, key] of Object.entries(DEFAULT_CONFIG.keys)) {
			expect(
				key,
				`keys.${action} = ${JSON.stringify(key)} is not a valid pi accelerator (lowercase "modifier+…+base", see src/panel/keys.ts parseAccelerator)`,
			).toMatch(ACCELERATOR_GRAMMAR);
		}
	});

	test("test_keys_map_stays_complete_over_all_ten_actions", () => {
		for (const action of ALL_ACTIONS) {
			const key = DEFAULT_CONFIG.keys[action];
			expect(key, `keys.${action} lost its default binding`).toBeTruthy();
			expect(typeof key, `keys.${action} default must be a string`).toBe("string");
		}
		expect(Object.keys(DEFAULT_CONFIG.keys).sort()).toEqual([...ALL_ACTIONS].sort());
	});

	test("test_guard_list_stays_curated_and_actionable", () => {
		// The guard is only as good as its list: it must be non-empty, deduplicated,
		// and every entry must carry an owner + reason (so failures are actionable).
		expect(AVOIDED_KEYS.length).toBeGreaterThanOrEqual(11);
		const keys = AVOIDED_KEYS.map((a) => a.key);
		expect(new Set(keys).size, "avoided list must not contain duplicates").toBe(keys.length);
		for (const entry of AVOIDED_KEYS) {
			expect(entry.owner, `avoided entry ${entry.key} needs an owner`).toBeTruthy();
			expect(entry.reason, `avoided entry ${entry.key} needs a reason`).toBeTruthy();
		}
	});
});
