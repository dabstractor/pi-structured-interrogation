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
 *   - tool.ts caps engine (P1.M1.T3.S3)      → config.caps
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
  | "focusText"
  | "batchNote"
  | "submit"
  | "discuss"
  | "externalEditor"
  | "prevQuestion"
  | "nextQuestion";

/** Character limits and result caps enforced by the interrogate tool (P1.M1.T3.S3). */
export interface CapsConfig {
  /** Max characters for the free-text description answer. Default 1200. */
  description: number;
  /** Max characters for ramification / deep-dive text. Default 600. */
  ramification: number;
  /**
   * Quality floor (2026-09-15 deep-view pin): a PROVIDED description shorter
   * than this warns in the upsert result (soft lint — never rejects). 0
   * disables. Default 200.
   */
  minDescription: number;
  /**
   * Quality floor (2026-09-15 deep-view pin): a PROVIDED option ramification
   * shorter than this warns in the upsert result. 0 disables. Default 120.
   */
  minRamification: number;
  /** Max number of multiple-choice options per question. Default 7. */
  options: number;
  /** Max number of questions in one interrogation. Default 40. */
  questions: number;
  /** Max characters for the goal statement. Default 400. */
  goal: number;
  /** Max percentage of the context window budgeted for interrogator content. Default 4. */
  contextBudgetPct: number;
}

/**
 * The resolved interrogator configuration. Every user-visible string naming a
 * key and every cap/toggle in the extension flows from here (PRD h2.52:
 * display strings must be generated from the resolved config — never
 * hardcoded; see {@link resolveKeyLabels}).
 */
export interface InterrogatorConfig {
  /**
   * Accelerator strings per action, in pi's lowercase form (e.g. "ctrl+shift+m").
   * Display labels are derived via {@link resolveKeyLabels}.
   */
  keys: Record<KeyAction, string>;
  /** Character limits and result caps — see {@link CapsConfig}. */
  caps: CapsConfig;
  /** FR-9: warn on panel submit when foundational gate-group questions are unanswered. Default true. */
  gateWarnings: boolean;
  /** Enable detection of interrogation rounds (P1.M7.T4.S1). Default true. */
  roundDetection: boolean;
  /** Allow pressing 1–9 to quick-select an option. Default true. */
  digitQuickSelect: boolean;
  /**
   * Summarize mid-interrogation compaction with the interrogation
   * preservation instructions prepended (P1.M7.T2.S1, FR-29/h2.42).
   * Default true.
   */
  compactionPreservation: boolean;
  /** Which editor the panel composes for text entry. Default "composed". */
  editorMode: EditorMode;
  /**
   * Double-esc window (ms) for closing the embedded explain/note editor
   * without suspending the panel (ESC-002): while the editor holds focus,
   * a SINGLE esc forwards to the editor (pi-vim insert-mode exit etc.); a
   * SECOND esc within this window closes the prompt box only (draft
   * write-through + blur back to options). 0 disables the double-esc exit
   * (single esc still forwards; close via the focusText toggle or enter).
   * Default 500.
   */
  escExitWindowMs: number;
}

/** All KeyActions in a stable iteration order (drives coercion + label maps). */
const KEY_ACTIONS = [
  "deep",
  "overview",
  "focusText",
  "batchNote",
  "submit",
  "discuss",
  "externalEditor",
  "prevQuestion",
  "nextQuestion",
] as const satisfies readonly KeyAction[];

/** All CapsConfig fields in a stable iteration order (drives coercion). */
const CAP_KEYS = [
  "description",
  "ramification",
  "minDescription",
  "minRamification",
  "options",
  "questions",
  "goal",
  "contextBudgetPct",
] as const satisfies readonly (keyof CapsConfig)[];

/**
 * Built-in defaults — VERBATIM from PRD h2.52. Any user override merges on
 * top of this (project settings beat global settings beat these defaults).
 */
export const DEFAULT_CONFIG: InterrogatorConfig = {
  keys: {
    deep: "ctrl+d",
    overview: "ctrl+l",
    focusText: "ctrl+t",
    batchNote: "ctrl+shift+m",
    submit: "ctrl+s",
    discuss: "ctrl+shift+e",
    externalEditor: "ctrl+g",
    prevQuestion: "tab",
    nextQuestion: "shift+tab",
  },
  caps: {
    description: 1200,
    ramification: 600,
    minDescription: 200,
    minRamification: 120,
    options: 7,
    questions: 40,
    goal: 400,
    contextBudgetPct: 4,
  },
  gateWarnings: true,
  roundDetection: true,
  digitQuickSelect: true,
  compactionPreservation: true,
  editorMode: "composed",
  escExitWindowMs: 500,
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
 * requires deep merge), nested objects like `keys` and `caps` merge per-key.
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
function coerceKeys(raw: unknown): Record<KeyAction, string> {
  const src = isPlainObject(raw) ? raw : {};
  const out = {} as Record<KeyAction, string>;
  for (const action of KEY_ACTIONS) {
    const v = src[action];
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
 * ill-typed (string caps, bad booleans, unknown editorMode, non-object
 * sections). Guarantees the returned value always satisfies InterrogatorConfig.
 */
function coerceConfig(raw: unknown): InterrogatorConfig {
  const src = isPlainObject(raw) ? raw : {};
  const capsSrc = isPlainObject(src.caps) ? src.caps : {};
  const caps = {} as CapsConfig;
  for (const key of CAP_KEYS) {
    caps[key] = coerceNumber(capsSrc[key], DEFAULT_CONFIG.caps[key]);
  }
  return {
    keys: coerceKeys(src.keys),
    caps,
    gateWarnings: coerceBoolean(src.gateWarnings, DEFAULT_CONFIG.gateWarnings),
    roundDetection: coerceBoolean(src.roundDetection, DEFAULT_CONFIG.roundDetection),
    digitQuickSelect: coerceBoolean(src.digitQuickSelect, DEFAULT_CONFIG.digitQuickSelect),
    compactionPreservation: coerceBoolean(src.compactionPreservation, DEFAULT_CONFIG.compactionPreservation),
    editorMode: coerceEditorMode(src.editorMode),
    escExitWindowMs: Math.max(0, coerceNumber(src.escExitWindowMs, DEFAULT_CONFIG.escExitWindowMs)),
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
 * the config shape (numeric coercion for caps — `"2000"` → 2000, NaN-ish →
 * default; boolean coercion for toggles; strict editorMode). Never throws.
 * Exported so tests can inject explicit paths instead of the real home dir.
 */
export async function loadConfigFrom(paths: ConfigPaths): Promise<InterrogatorConfig> {
  const global = paths.global !== undefined ? await tryReadInterrogator(paths.global) : {};
  const project = paths.project !== undefined ? await tryReadInterrogator(paths.project) : {};
  return coerceConfig(deepMerge(deepMerge(DEFAULT_CONFIG, global), project));
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
 * Nested objects merge per-key; scalars replace. 9 keys + 6 caps + 4 toggles
 * + editorMode + escExitWindowMs (defaults = PRD h2.52 as amended by the
 * breakOut removal):
 *
 * ### keys — accelerator strings, pi lowercase form
 * | field           | default         | purpose                                        | label consumer |
 * |-----------------|-----------------|------------------------------------------------|----------------|
 * | `deep`          | `"ctrl+d"`      | Open the deep-dive/ramification view           | footer, dialogs |
 * | `overview`      | `"ctrl+l"`      | Open the question overview list                | footer, dialogs |
 * | `focusText`     | `"ctrl+t"`      | Focus the text editor for the current question | footer          |
 * | `batchNote`     | `"ctrl+shift+m"`| Attach a batch note                            | footer, dialogs |
 * | `submit`        | `"ctrl+s"`      | Submit answers / close the panel               | footer, widget  |
 * | `discuss`       | `"ctrl+shift+e"`| Discuss the current question in chat           | footer, dialogs |
 * | `externalEditor`| `"ctrl+g"`      | Open the draft in an external editor           | footer, widget  |
 * | `prevQuestion`  | `"tab"`         | Move to the previous question                  | footer          |
 * | `nextQuestion`  | `"shift+tab"`   | Move to the next question                      | footer          |
 *
 * ### caps — limits enforced by the interrogate tool (P1.M1.T3.S3)
 * | field              | default | purpose                                                |
 * |--------------------|---------|--------------------------------------------------------|
 * | `description`      | 1200    | Max characters for the free-text description answer    |
 * | `ramification`     | 600     | Max characters for ramification/deep-dive text         |
 * | `minDescription`   | 200     | Soft floor: warn when a provided description is shorter |
 * | `minRamification`  | 120     | Soft floor: warn when a provided ramification is shorter |
 * | `options`          | 7       | Max multiple-choice options per question               |
 * | `questions`        | 40      | Max questions in one interrogation                     |
 * | `goal`             | 400     | Max characters for the goal statement                  |
 * | `contextBudgetPct` | 4       | Max % of the context window budgeted for this content  |
 *
 * Numeric caps arriving as strings ("2000") are coerced via Number();
 * non-finite results fall back to the default.
 *
 * ### toggles
 * | field              | default | purpose                                              | consumer |
 * |--------------------|---------|------------------------------------------------------|----------|
 * | `gateWarnings`     | true    | FR-9 panel submit warning for unanswered gate questions | panel/actions.ts (P1.M3.T2.S2) |
 * | `roundDetection`   | true    | Detect interrogation rounds                          | detect.ts (P1.M7.T4.S1) |
 * | `digitQuickSelect` | true    | Press 1–9 to quick-select an option                  | panel keys (P1.M3.T3.S1) |
 * | `compactionPreservation` | true | Prepend preservation instructions to mid-interrogation compaction summaries | compaction.ts (P1.M7.T2.S1) |
 *
 * ### escExitWindowMs
 * Double-esc window (milliseconds) for closing the embedded explain/note
 * editor without suspending the panel (ESC-002). While the editor holds
 * focus a single esc forwards to the editor itself (pi-vim insert-mode
 * exit); a second esc within the window closes the prompt box only (draft
 * write-through + blur back to options). `0` disables the double-esc exit
 * (single esc still forwards; close via the `focusText` toggle or enter).
 * Negative values coerce to 0. Default 500.
 *
 * ### editorMode
 * `"composed"` (default) — the panel composes its own editor experience —
 * or `"stock"` — defer to pi's stock editor behavior. Any other value falls
 * back to "composed".
 */
export async function loadConfig(cwd: string): Promise<InterrogatorConfig> {
  return loadConfigFrom({
    global: path.join(getAgentDir(), "settings.json"),
    project: path.join(cwd, CONFIG_DIR_NAME, "settings.json"),
  });
}

/**
 * Normalize one accelerator string into a display label: split on "+",
 * trim, lowercase, then capitalize each token. "ctrl+shift+m" →
 * "Ctrl+Shift+M"; "tab" → "Tab"; "shift+tab" → "Shift+Tab".
 */
function labelFor(accelerator: string): string {
  return accelerator
    .split("+")
    .map((token) => {
      const t = token.trim().toLowerCase();
      return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
    })
    .join("+");
}

/**
 * Display labels for every {@link KeyAction}, derived from the resolved
 * (possibly rebound) `config.keys` — e.g. `{ submit: "ctrl+enter" }` labels
 * submit as "Ctrl+Enter". Guarantees one label per action so that NO display
 * string in the extension ever hardcodes a key name (PRD h2.52).
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
