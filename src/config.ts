/**
 * pi-interrogator — configuration module (P1.M1.T1.S2).
 *
 * The single source of truth for every hotkey, cap, and toggle in the
 * extension. pi exposes NO settings accessor to extensions (there is no
 * ctx.settings API — see plan/001_0d6760db6bc5/architecture/pi-api-validation.md
 * §Mismatch 4), so config is loaded by manually reading pi's settings files
 * and deep-merging, in precedence order:
 *
 *   DEFAULT_CONFIG  ←  global  <agentDir>/settings.json  ←  project  <cwd>/.pi/settings.json
 *
 * Both settings files are open-schema JSON; this extension's values live under
 * the top-level `"interrogator"` key. Loading is fully tolerant: missing
 * files, malformed JSON, non-object bodies, and missing or ill-typed keys
 * contribute nothing (the default survives). `loadConfig` NEVER throws.
 *
 * Consumers:
 *   - panel/keys.ts (P1.M3.T3.S1)            → config.keys
 *   - panel footer / widget / dialogs
 *     (P1.M3.T1.S2, P1.M6.T1.S1)             → resolveKeyLabels(config)
 *   - detect.ts (P1.M7.T4.S1)                → config.roundDetection
 *   - compaction.ts (P1.M7.T2.S1)            → config.compactionPreservation
 *   - README config reference (P1.M7.T7.S1)  → the JSDoc below (Mode A docs)
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

/** How the /interrogate panel sources its text editor. */
export type EditorMode =
  /** Interrogator composes its own editor experience around the draft. */
  | "composed"
  /** Defer to pi's stock editor behavior for text entry. */
  | "stock";

/**
 * Every bindable interrogator action — the field names of `InterrogatorConfig.keys`.
 * Matching against actual key events happens in panel/keys.ts (P1.M3.T3.S1)
 * via pi's key utilities; this module only stores the accelerator strings.
 *
 * NOTE (breakOut removal): there is deliberately NO `breakOut` action. The
 * historical ctrl+shift+q global shortcut + in-panel accelerator was
 * removed — on many desktop environments that chord never reaches the
 * terminal at all (the window manager claims it to close windows), so no
 * default ships and none is rebindable. Suspending is `esc` (fixed key,
 * view-descent ladder); resuming is `/interrogate` (immediate invoke).
 */
export type KeyAction =
  | "deep"
  | "overview"
  | "elaborate"
  | "batchNote"
  | "submit"
  | "chat"
  | "externalEditor"
  | "prevQuestion"
  | "nextQuestion";

/**
 * The resolved interrogator configuration. Every user-visible string naming a
 * key and every toggle in the extension flows from here (PRD h2.52:
 * display strings must be generated from the resolved config — never
 * hardcoded; see {@link resolveKeyLabels}).
 *
 * NO CAPS (CAPS-OUT-001, 2026-10-08 owner ruling): the former
 * `interrogator.caps` block (description/ramification/options/questions/
 * goal limits and floors) is DELETED — no limits are imposed on anything.
 */
export interface InterrogatorConfig {
  /**
   * Accelerator strings per action, in pi's lowercase form (e.g. "ctrl+shift+m").
   * Display labels are derived via {@link resolveKeyLabels}.
   */
  keys: Record<KeyAction, string>;
  /** FR-9: warn on panel submit when foundational gate-group questions are unanswered. Default true. */
  gateWarnings: boolean;
  /** Enable detection of interrogation rounds (P1.M7.T4.S1). Default true. */
  roundDetection: boolean;
  /**
   * Summarize mid-interrogation compaction with the interrogation
   * preservation instructions prepended (P1.M7.T2.S1, FR-29/h2.42).
   * Default true.
   */
  compactionPreservation: boolean;
  /** Which editor the panel composes for text entry. Default "composed". */
  editorMode: EditorMode;
  escExitWindowMs: number;
  /**
   * Side-chat model override, "provider/model-id" (SIDECHAT-003). Absent,
   * blank, or ill-typed → undefined → the session's current model at chat
   * open. Deliberately NOT in DEFAULT_CONFIG: a defaulted key would defeat
   * absent-vs-set detection through the deep merge (coerceConfig could
   * never yield undefined).
   */
  sideChatModel?: string;
  /** Side-chat answer proposals apply without the inline confirm (SIDECHAT-004). Default false. */
  sideChatAutoApply: boolean;
}

/** All KeyActions in a stable iteration order (drives coercion + label maps). */
const KEY_ACTIONS = [
  "deep",
  "overview",
  "elaborate",
  "batchNote",
  "submit",
  "chat",
  "externalEditor",
  "prevQuestion",
  "nextQuestion",
] as const satisfies readonly KeyAction[];

/**
 * Built-in defaults — VERBATIM from PRD h2.52. Any user override merges on
 * top of this (project settings beat global settings beat these defaults).
 */
export const DEFAULT_CONFIG: InterrogatorConfig = {
  keys: {
    deep: "d",
    overview: "i",
    elaborate: "e",
    batchNote: "n",
    submit: "ctrl+s",
    chat: "c",
    externalEditor: "ctrl+g",
    prevQuestion: "tab",
    nextQuestion: "shift+tab",
  },
  gateWarnings: true,
  roundDetection: true,
  compactionPreservation: true,
  editorMode: "composed",
  escExitWindowMs: 500,
  sideChatAutoApply: false,
};

/** The settings.json key under which this extension's config lives (open-schema; stable). */
const SETTINGS_KEY = "interrogator";

/**
 * True for plain objects only (typeof "object", not null, not an array).
 * The config schema contains no arrays, so anything non-object replaces
 * wholesale during merge instead of recursing.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `override` onto `base`, returning a NEW object (never mutates
 * either input). Recursion happens only when BOTH sides are plain objects;
 * any other override value (scalar, array, null) replaces the base value
 * wholesale. Unlike pi-file-injector's shallow spread (PRD h2.18 explicitly
 * requires deep merge), nested objects like `keys` merge per-key.
 */
function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(override)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(override)) {
    const v = override[key];
    out[key] = isPlainObject(v) && isPlainObject(out[key]) ? deepMerge(out[key], v) : v;
  }
  return out as T;
}

/**
 * Tolerant namespaced read of a pi settings.json (pi-file-injector
 * tryReadNamespaced pattern, file-injector.ts:337–344): parse the file, guard
 * that it is a plain object, take the `"interrogator"` sub-object (same
 * guard), and return it — or `{}` on ANY failure (missing file, malformed
 * JSON, non-object body, non-object "interrogator" value). NEVER throws.
 */
async function tryReadInterrogator(p: string): Promise<Partial<InterrogatorConfig>> {
  try {
    const v: unknown = JSON.parse((await readFile(p, "utf8")).trim() || "{}");
    if (!isPlainObject(v)) return {};
    const sub = v[SETTINGS_KEY];
    return isPlainObject(sub) ? (sub as Partial<InterrogatorConfig>) : {};
  } catch {
    return {};
  }
}

/** Coerce a numeric cap: numbers pass through; numeric strings ("2000") coerce via Number(); anything NaN-ish falls back to the default. */
function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Coerce a toggle: booleans pass through; "true"/"false" strings coerce; anything else falls back to the default. */
function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/** Coerce the keys map: non-string or empty accelerators fall back to the default for that action. */
function coerceKeys(raw: unknown, userKeys?: unknown): Record<KeyAction, string> {
  const src = isPlainObject(raw) ? raw : {};
  // Legacy alias (BAREKEYS-001 rename): a pre-rename keys.focusText binding
  // silently feeds keys.elaborate when the user has not set the new name;
  // never logged. Presence is checked on userKeys — the RAW pre-merge user
  // map threaded through coerceConfig — because loadConfigFrom deep-merges
  // DEFAULT_CONFIG first, so the merged map cannot distinguish "absent"
  // from "explicitly rebound to the default". The alias contract
  // (P1.M1.T1.S2) is presence-based: an explicit valid keys.elaborate
  // ALWAYS wins, even when it happens to equal the default.
  const user = isPlainObject(userKeys) ? userKeys : {};
  const elaborateExplicit = typeof user.elaborate === "string" && user.elaborate.trim() !== "";
  const legacyValid = typeof src.focusText === "string" && src.focusText.trim() !== "";
  // Legacy alias (SIDECHAT-001 rename): a pre-rename keys.discuss binding
  // silently feeds keys.chat when the user has not set the new name; never
  // logged. Same presence-based contract as the focusText alias above — an
  // explicit valid keys.chat ALWAYS wins, even when equal to the default.
  const chatExplicit = typeof user.chat === "string" && user.chat.trim() !== "";
  const discussValid = typeof src.discuss === "string" && src.discuss.trim() !== "";
  let effSrc = src;
  if (!elaborateExplicit && legacyValid) effSrc = { ...effSrc, elaborate: src.focusText };
  if (!chatExplicit && discussValid) effSrc = { ...effSrc, chat: src.discuss };
  const out = {} as Record<KeyAction, string>;
  for (const action of KEY_ACTIONS) {
    const v = effSrc[action];
    out[action] = typeof v === "string" && v.trim() !== "" ? v : DEFAULT_CONFIG.keys[action];
  }
  return out;
}

/** Coerce editorMode: only "composed"/"stock" are valid; anything else falls back to the default. */
function coerceEditorMode(value: unknown): EditorMode {
  return value === "stock" || value === "composed" ? value : DEFAULT_CONFIG.editorMode;
}

/**
 * Post-merge shape enforcement: walk the merged value and coerce every field
 * to its contractual type, falling back to the h2.52 default for anything
 * ill-typed (bad booleans, unknown editorMode, non-object
 * sections). Guarantees the returned value always satisfies InterrogatorConfig.
 */
function coerceConfig(raw: unknown, userRaw?: unknown): InterrogatorConfig {
  const src = isPlainObject(raw) ? raw : {};
  return {
    keys: coerceKeys(src.keys, isPlainObject(userRaw) ? userRaw.keys : undefined),
    gateWarnings: coerceBoolean(src.gateWarnings, DEFAULT_CONFIG.gateWarnings),
    roundDetection: coerceBoolean(src.roundDetection, DEFAULT_CONFIG.roundDetection),
    compactionPreservation: coerceBoolean(src.compactionPreservation, DEFAULT_CONFIG.compactionPreservation),
    editorMode: coerceEditorMode(src.editorMode),
    escExitWindowMs: Math.max(0, coerceNumber(src.escExitWindowMs, DEFAULT_CONFIG.escExitWindowMs)),
    sideChatModel:
      typeof src.sideChatModel === "string" && src.sideChatModel.trim() !== ""
        ? src.sideChatModel
        : undefined,
    sideChatAutoApply: coerceBoolean(src.sideChatAutoApply, DEFAULT_CONFIG.sideChatAutoApply),
  };
}

/** Explicit settings file paths — the testable seam for {@link loadConfig} (unit tests inject temp-dir paths and never read the real ~/.pi). */
export interface ConfigPaths {
  /** Global settings.json path; omit to skip the global read entirely. */
  global?: string;
  /** Project settings.json path; omit to skip the project read entirely. */
  project?: string;
}

/**
 * Testable core of {@link loadConfig}: reads whichever paths are provided,
 * deep-merges project over global over {@link DEFAULT_CONFIG}, and enforces
 * the config shape (numeric coercion — `"2000"` → 2000, NaN-ish →
 * default; boolean coercion for toggles; strict editorMode). Never throws.
 * Exported so tests can inject explicit paths instead of the real home dir.
 */
export async function loadConfigFrom(paths: ConfigPaths): Promise<InterrogatorConfig> {
  const global = paths.global !== undefined ? await tryReadInterrogator(paths.global) : {};
  const project = paths.project !== undefined ? await tryReadInterrogator(paths.project) : {};
  // The raw user map (pre-DEFAULT merge) rides along so coerceKeys can
  // distinguish "keys.elaborate absent" from "explicitly set to the
  // default" — the legacy focusText alias contract is presence-based.
  const user = deepMerge(global, project);
  return coerceConfig(deepMerge(DEFAULT_CONFIG, user), user);
}

/**
 * Load the resolved interrogator config for `cwd` — NEVER throws.
 *
 * Reads pi's two settings files (there is no ctx.settings API) and
 * deep-merges: project wins over global, global wins over defaults.
 * Only the `"interrogator"` key of each file is considered; missing files,
 * malformed JSON, non-object values, and ill-typed keys contribute nothing.
 *
 * @param cwd Project directory whose `.pi/settings.json` is the project scope.
 * @returns The fully resolved, shape-guaranteed {@link InterrogatorConfig}.
 *
 * ## Config reference (source of truth for the README — P1.M7.T7.S1, Mode A docs)
 *
 * Set overrides under a top-level `"interrogator"` object in either
 * `~/.pi/agent/settings.json` (global) or `<cwd>/.pi/settings.json` (project).
 * Nested objects merge per-key; scalars replace. 9 keys + 4 toggles
 * (gateWarnings/roundDetection/compactionPreservation/sideChatAutoApply) +
 * editorMode + escExitWindowMs + sideChatModel (optional string — absent/
 * blank/ill-typed → undefined) (defaults = PRD h2.52 as amended by the
 * breakOut removal):
 *
 * ### keys — accelerator strings, pi lowercase form
 * | field           | default         | purpose                                        | label consumer |
 * |-----------------|-----------------|------------------------------------------------|----------------|
 * | `deep`          | `"d"`           | Open the deep-dive/ramification view           | footer, dialogs |
 * | `overview`      | `"i"`           | Open the question overview list                | footer, dialogs |
 * | `elaborate`     | `"e"`           | Enter the editor: elaboration on the selection / write-in duty (FR-12) | footer          |
 * | `batchNote`     | `"n"`           | Attach a batch note                            | footer, dialogs |
 * | `submit`        | `"ctrl+s"`      | Submit answers / close the panel               | footer, widget  |
 * | `chat`         | `"c"`           | Open the per-question side chat                | footer, dialogs |
 * | `externalEditor`| `"ctrl+g"`      | Open the draft in an external editor           | footer, widget  |
 * | `prevQuestion`  | `"tab"`         | Move to the previous question                  | footer          |
 * | `nextQuestion`  | `"shift+tab"`   | Move to the next question                      | footer          |
 *
 * Two-tier intercept (h2.74/BAREKEYS-001, ui-spec:70): bare keys (single
 * printable char, no modifier) intercept only from non-editor focus and
 * always forward while the embedded editor holds focus — a bare key must
 * be typeable. Modifier chords intercept in every focus state. The two
 * surviving default chords are load-bearing (decisions :113-115): `ctrl+s`
 * submit — "submit must fire from text focus — a bare `s` could never be
 * typed" — and `ctrl+g` externalEditor — "its only valid context is editor
 * focus, where a bare key must type — a bare `g` would be permanently
 * unpressable".
 *
 * ### toggles
 * | field              | default | purpose                                              | consumer |
 * |--------------------|---------|------------------------------------------------------|----------|
 * | `gateWarnings`     | true    | FR-9 panel submit warning for unanswered gate questions | panel/actions.ts (P1.M3.T2.S2) |
 * | `roundDetection`   | true    | Detect interrogation rounds                          | detect.ts (P1.M7.T4.S1) |
 * | `compactionPreservation` | true | Prepend preservation instructions to mid-interrogation compaction summaries | compaction.ts (P1.M7.T2.S1) |
 *
 * ### escExitWindowMs
 * Double-esc window (milliseconds) for closing the embedded explain/note
 * editor without suspending the panel (ESC-002). While the editor holds
 * focus a single esc forwards to the editor itself (pi-vim insert-mode
 * exit); a second esc within the window closes the prompt box only (draft
 * write-through + blur back to options). `0` disables the double-esc exit
 * (single esc still forwards; close via the `elaborate` toggle or enter).
 * Negative values coerce to 0. Default 500.
 *
 * ### editorMode
 * `"composed"` (default) — the panel composes its own editor experience —
 * or `"stock"` — defer to pi's stock editor behavior. Any other value falls
 * back to `"composed"`.
 */
export async function loadConfig(cwd: string): Promise<InterrogatorConfig> {
  return loadConfigFrom({
    global: path.join(getAgentDir(), "settings.json"),
    project: path.join(cwd, CONFIG_DIR_NAME, "settings.json"),
  });
}

/**
 * Normalize one accelerator string into a display label. BARE keys (no
 * "+") render EXACTLY as bound — a lowercase `d` displays as `d`, never
 * `D`: a capitalized hint implies shift and lies about the binding
 * (KEYMNEMONICS-001 amendment, 2026-10-19). Chords title-case each token
 * for readability — "ctrl+shift+m" → "Ctrl+Shift+M"; "tab" → "Tab" —
 * harmless there because modifier chords normalize letter case at match
 * time.
 */
function labelFor(accelerator: string): string {
  const tokens = accelerator.split("+").map((token) => token.trim().toLowerCase());
  // BARE single-LETTER keys render verbatim — "d" is not "D": a
  // capitalized letter implies shift and lies about the binding
  // (KEYMNEMONICS-001 amendment, 2026-10-19). Named keys (tab, f9) and
  // chords keep title-case typography — names, not shifted letters.
  if (tokens.length === 1) {
    const t = tokens[0] ?? "";
    return t.length === 1 ? t : t.charAt(0).toUpperCase() + t.slice(1);
  }
  return tokens
    .map((t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t))
    .join("+");
}

/**
 * Display labels for every {@link KeyAction}, derived from the resolved
 * (possibly rebound) `config.keys` — e.g. `{ submit: "ctrl+enter" }` labels
 * submit as "Ctrl+Enter", while bare keys display verbatim (`d` stays `d` —
 * a capitalized bare letter would imply shift). Guarantees one label per
 * action so that NO display string in the extension ever hardcodes a key
 * name (PRD h2.52).
 *
 * Consumers: panel footer (P1.M3.T1.S2), widget (P1.M6.T1.S1), dialogs.
 */
export function resolveKeyLabels(config: InterrogatorConfig): Record<KeyAction, string> {
  const out = {} as Record<KeyAction, string>;
  for (const action of KEY_ACTIONS) {
    out[action] = labelFor(config.keys[action]);
  }
  return out;
}
