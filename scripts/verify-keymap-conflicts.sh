#!/usr/bin/env bash
#
# scripts/verify-keymap-conflicts.sh — keymap conflict regression guard (P1.M7.T7.S2).
#
# Re-runs the build-time keymap conflict verification demanded by PRD h2.34:
# every DEFAULT key in src/config.ts (DEFAULT_CONFIG.keys) is checked against
# (a) the curated AVOIDED list — keys known to be taken by extensions or by
#     pi transcript-level features (the README "Keymap conflict
#     re-verification" section records why each is avoided), and
# (b) a LIVE grep for `pi.registerShortcut("<key>"` across the installed
#     extension trees — so a newly installed/updated extension that grabs one
#     of our defaults fails this script immediately.
#
# Pi's own built-in bindings (docs/keybindings.md) are reported as INFO only:
# the panel-scoped defaults (ctrl+d/l/t/s/g, tab/shift+tab) INTENTIONALLY
# reuse pi built-ins — safe because the panel's custom() component consumes
# input first (intercept-before-forward, src/panel/keys.ts) — so a built-in
# hit must not fail the check. Only genuinely global claims fail.
#
# Exit codes: 0 = all defaults clear; 1 = at least one default collides with
# an avoided key or a live extension shortcut registration; 2 = the config
# file could not be read/parsed (environmental failure).
#
# Known limitation (by design, keep it cheap): the live grep only sees STRING
# LITERAL first arguments. Variable-indirect registrations (pi-web-access
# resolves DEFAULT_SHORTCUTS at index.ts:99; pi-subagents uses a Key.ctrlAlt
# constant) are covered by the curated AVOIDED list instead — re-check them
# manually when touching keys (README re-run instructions).
#
# Usage: bash scripts/verify-keymap-conflicts.sh   # from anywhere

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="$ROOT/src/config.ts"

# ---------------------------------------------------------------------------
# Curated avoided list — keys a default must NEVER be set to. Each entry is
# "<key>|owner|reason". Keep in sync with src/keymap-guard.test.ts and the
# README "Keymap conflict re-verification" table.
# ---------------------------------------------------------------------------
AVOIDED=(
	"ctrl+b|pi-patty-bg-tasks|global shortcut (shortcuts.ts:28)"
	"ctrl+shift+b|pi-patty-bg-tasks|global shortcut (shortcuts.ts:34)"
	"ctrl+shift+j|pi-patty-bg-tasks|global shortcut (shortcuts.ts:39)"
	"shift+down|pi-patty-bg-tasks|global shortcut (shortcuts.ts:44)"
	"ctrl+shift+x|pi-patty-bg-tasks|global shortcut (shortcuts.ts:49)"
	"ctrl+shift+s|pi-web-access|curate shortcut (DEFAULT_SHORTCUTS index.ts:99, registerShortcut index.ts:1044)"
	"ctrl+shift+w|pi-web-access|activity shortcut (DEFAULT_SHORTCUTS index.ts:99, registerShortcut index.ts:1057)"
	"ctrl+m|terminal|ctrl+m sends \r (carriage return) — unusable as a modifier chord"
	"ctrl+shift+f|pi built-in|tui.altScreen.search — transcript search (docs/keybindings.md:114)"
	"ctrl+shift+up|pi built-in|tui.altScreen.previousPrompt — transcript nav (docs/keybindings.md:112)"
	"ctrl+shift+down|pi built-in|tui.altScreen.nextPrompt — transcript nav (docs/keybindings.md:113)"
)

# Extension trees scanned for live `pi.registerShortcut("<key>"` claims.
# Do NOT hardcode a single pi install path — scan every tree that exists.
EXT_TREES=("$HOME/.pi/agent/npm/node_modules" "$HOME/.pi/agent/git" "$HOME/.pi/extensions")

# Pi built-in defaults doc — check both known install layouts, degrade to a
# warning when neither is readable (machine-local path; must not fail).
PI_DOCS=""
for candidate in \
	"$HOME/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md" \
	"$HOME/.pi/agent/npm/node_modules/@earendil-works/pi-coding-agent/docs/keybindings.md"; do
	if [[ -r "$candidate" ]]; then PI_DOCS="$candidate"; break; fi
done

[[ -r "$CONFIG_FILE" ]] || {
	echo "FAIL: cannot read $CONFIG_FILE" >&2
	exit 2
}

# ---------------------------------------------------------------------------
# Parse the 10 defaults out of DEFAULT_CONFIG.keys in src/config.ts —
# `    action: "accelerator",` lines inside the `keys: { ... },` block.
# ---------------------------------------------------------------------------
mapfile -t DEFAULT_LINES < <(
	sed -n '/^export const DEFAULT_CONFIG/,/^};/p' "$CONFIG_FILE" \
		| sed -n '/^  keys: {/,/^  },/p' \
		| grep -oE '^    [a-zA-Z]+: "[^"]+"' || true
)

if [[ ${#DEFAULT_LINES[@]} -eq 0 ]]; then
	echo "FAIL: could not parse DEFAULT_CONFIG.keys from $CONFIG_FILE (format changed?)" >&2
	exit 2
fi

# ---------------------------------------------------------------------------
# Live extension shortcut claims: collect every string-literal accelerator
# passed to registerShortcut( across the extension trees. Exclude pi's own
# tree (docs/CHANGELOG example mentions, not real registrations).
# ---------------------------------------------------------------------------
live_claims=""
for tree in "${EXT_TREES[@]}"; do
	[[ -d "$tree" ]] || continue
	live_claims+="$(grep -rnE 'registerShortcut\(\s*"[^"]+"' "$tree" 2>/dev/null \
		| grep -v 'pi-coding-agent' || true)"$'\n'
done

failures=0
checked=0

printf '%-18s %-9s %s\n' "KEY" "STATUS" "DETAIL"
printf '%-18s %-9s %s\n' "------------------" "---------" "--------------------------------------------------"

for line in "${DEFAULT_LINES[@]}"; do
	action="${line%%:*}"
	action="${action// /}"
	key="$(sed -E 's/.*"([^"]+)".*/\1/' <<<"$line")"
	checked=$((checked + 1))

	# 1. Curated avoided list.
	avoided_hit=""
	for entry in "${AVOIDED[@]}"; do
		if [[ "${entry%%|*}" == "$key" ]]; then
			avoided_hit="${entry#*|}"
			break
		fi
	done
	if [[ -n "$avoided_hit" ]]; then
		printf '%-18s %-9s %s\n' "$key ($action)" "FAIL" "AVOIDED — taken by ${avoided_hit%%|*}: ${avoided_hit#*|}"
		failures=$((failures + 1))
		continue
	fi

	# 2. Live extension registerShortcut claims (string literals only).
	live_evidence="$(grep -F "registerShortcut(\"$key\"" <<<"$live_claims" | head -1 || true)"
	if [[ -n "$live_evidence" ]]; then
		printf '%-18s %-9s %s\n' "$key ($action)" "FAIL" "LIVE claim: ${live_evidence//$HOME/~}"
		failures=$((failures + 1))
		continue
	fi

	# 3. Pi built-in ownership — INFO only (panel-safe reuse by design).
	#    -F (fixed-string) match so "+" in key names stays literal; the second
	#    grep keeps only table-row first columns (binding ids), skipping the
	#    prose bullets in docs/keybindings.md.
	detail="(no pi built-in; no extension claim)"
	if [[ -n "$PI_DOCS" ]]; then
		owners="$(grep -F "\`$key\`" "$PI_DOCS" 2>/dev/null \
			| grep -oE '^ *\| *`[^`]+`' \
			| sed -E 's/^ *\| *`//; s/`$//' \
			| awk 'BEGIN { ORS=""; sep="" } { print sep $0; sep="; " }' || true)"
		if [[ -n "$owners" ]]; then
			detail="panel-safe reuse — pi built-in(s): $owners"
		fi
	fi
	printf '%-18s %-9s %s\n' "$key ($action)" "ok" "$detail"
done

echo
if [[ -z "$PI_DOCS" ]]; then
	echo "WARN: pi docs/keybindings.md not found in the known install locations — built-in INFO column may be incomplete (this is not a failure)."
fi
echo "Checked $checked default key(s) from src/config.ts against ${#AVOIDED[@]} avoided keys + live extension registerShortcut claims."

if [[ "$failures" -gt 0 ]]; then
	echo "FAIL: $failures default key(s) collide with taken/avoided keys. Rebind them in src/config.ts (DEFAULT_CONFIG.keys)."
	exit 1
fi
echo "PASS: no default key collides with an avoided or extension-claimed key."
