# Config + keymap rename surface (`keys.discuss` → `keys.chat`, 2 new fields)

## Rename touchpoints (verified at HEAD d18bc39)

**src/config.ts**
- :54 `KeyAction` union member `"discuss"` → `"chat"` (union :46–58)
- :97 `KEY_ACTIONS` entry (:91–101, `as const satisfies readonly KeyAction[]`)
- :114 `DEFAULT_CONFIG.keys.discuss: "e"` → `chat: "e"` (map :108–119)
- :289 loadConfig JSDoc keys-table row → `` `chat` | `"e"` | Open the per-question side chat | footer, dialogs ``
- :263 JSDoc count string — update to the TRUE final surface (9 keys + 3 toggles + editorMode + escExitWindowMs + 2 side-chat fields; the rename does not add a key)

**src/panel/keys.ts**
- :144–146 `RoutedActions.onDiscuss(p)` → `onChat(p)` (interface ends :148)
- :372–377 default no-op `onDiscuss` in `makeActions` (comment cites discussInChat host refinement — update; interim M1 state: still calls discussInChat until M2 swaps it)
- :414 `discuss: isBareBinding(b.discuss)` in the `bare` tier map (built once :405–417)
- :558–561 dispatch arm → `matchesKey(data, b.chat)`, `bare.chat && editorFocused → return false`, `actions.onChat(panel)` — two-tier shape is already correct, rename only
- :95, :120 JSDoc mentions

**src/panel/layout.ts** — :70 `ACTION_WORDS.discuss: "discuss"` → `chat: "chat"` (Record :64–74); per-view footer action sets :43–49/:61 (grep: only ACTION_WORDS today; M2 adds the chat-view footer set).

**src/panel/panel.ts** — :74 import of discussInChat (dies in M2.T7); :652–661 host refinement `routed.onDiscuss` → `onChat` (interim: keeps calling discussInChat; final: opens chat view); :224–225, :326, :941 comments.

**Tests** — `src/panel/keys.test.ts` :34 fixture, :149, :263, :393, :758, :814 (onDiscuss spies; :751 letter-vs-letter ordering pin deep-before-discuss → carry to chat); `src/config.test.ts` :145 `labels.discuss`; `src/config-surface.test.ts` :24, :100 (`DEFAULT_DATA.discuss`), :117 (`REMAPS.discuss`), :139 (`SPY_FOR.discuss: "onDiscuss"`), :152 (`WORDS.discuss`), :547/:551/:554 — all three `Record<KeyAction,…>` maps are exhaustively typed, TS forces the sweep; `src/panel/keymap-ac.test.ts` :37, :89; `src/panel/ac-panel.test.ts` :423/:426/:430; `src/panel/layout.test.ts` :79.

**Guard** — `src/keymap-guard.test.ts` :46 `ALL_ACTIONS` local list (:41–52); its exhaustiveness check (:89–100, `Object.keys(DEFAULT_CONFIG.keys)` vs `ALL_ACTIONS`) catches one-sided renames.

## Silent alias mechanism (copy verbatim from :194–205)

`coerceKeys(raw, userKeys)` receives the RAW pre-merge user keys map — threaded from `loadConfigFrom` :237 (`coerceKeys(src.keys, isPlainObject(userRaw) ? userRaw.keys : undefined)`) because `deepMerge(DEFAULT_CONFIG, user)` (:259–260) cannot distinguish absent from rebound-to-default:

```ts
const user = isPlainObject(userKeys) ? userKeys : {};
const chatExplicit = typeof user.chat === "string" && user.chat.trim() !== "";
const legacyValid = typeof src.discuss === "string" && src.discuss.trim() !== "";
const effSrc = !chatExplicit && legacyValid ? { ...src, chat: src.discuss } : src;
```

Presence-based, silent (never logged), explicit new name ALWAYS wins. Alias tests belong in
`src/config.test.ts` (check for the focusText alias tests there and mirror them).

## New-config recipe (precedent: `compactionPreservation`, M7)

1. Interface field + JSDoc in `InterrogatorConfig` (config.ts :81–86): `sideChatModel?: string`
   (JSDoc: override for the side-chat model; default = session model at chat open; invalid → notify
   + session model) and `sideChatAutoApply: boolean` (JSDoc: skip the answer confirm row; default false).
2. `DEFAULT_CONFIG`: `sideChatAutoApply: false` near :121; `sideChatModel` is the FIRST optional
   field — no `undefined`-default precedent exists; normalize in `coerceConfig`:
   `typeof v === "string" && v.trim() ? v : undefined` (new optional-string coercion path).
3. Coercion in `coerceConfig` (~:231): `sideChatAutoApply: coerceBoolean(src.sideChatAutoApply, false)`.
4. JSDoc config-reference rows (toggles table :303–311 area) + count string :263.
5. Tests: keys-surface fixtures in `config-surface.test.ts` stay keys-only; boolean/optional coercion
   tests in `src/config.test.ts` (toggle-test shape).

## Ordering notes

- Collision-order list (dispatch order is load-bearing): deep → overview → elaborate → batchNote →
  submit → discuss/chat → externalEditor (editor-focus gated) → prev/next. Keys.test :751 pins
  letter-vs-letter: deep earlier than discuss — carry the pin to `chat`, same key `e`.
- `scripts/verify-keymap-conflicts.sh`: `e` unchanged → passes untouched (bare panel-owned key);
  only the README record refreshes.
- Tier-2 rule: bare `e` intercepts ONLY from non-editor focus (`bare.chat && editorFocused → return
  false`); a chord remap automatically becomes tier-1 with zero extra code.
