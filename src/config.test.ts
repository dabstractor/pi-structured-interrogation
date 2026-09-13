/**
 * Unit tests for src/config.ts (P1.M1.T1.S2).
 *
 * All tests run through loadConfigFrom({ global, project }) with paths inside
 * os.tmpdir() fixtures — the real ~/.pi is NEVER read. afterEach removes the
 * temp trees.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, expect, test } from "vitest";
import { DEFAULT_CONFIG, loadConfigFrom, resolveKeyLabels } from "./config";

const cleanup: string[] = [];

afterEach(async () => {
  const dirs = cleanup.splice(0);
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

/** Make a fresh temp dir that is removed in afterEach. */
async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-interrogator-cfg-"));
  cleanup.push(dir);
  return dir;
}

/** Write a settings.json under a fresh temp dir; returns its path. */
async function writeSettings(body: string): Promise<string> {
  const dir = await tmpDir();
  const p = path.join(dir, "settings.json");
  await fs.writeFile(p, body, "utf8");
  return p;
}

/** Path inside a fresh temp dir that is never created (missing-file fixture). */
async function missingPath(): Promise<string> {
  const dir = await tmpDir();
  return path.join(dir, "does-not-exist.json");
}

test("test_no_files_anywhere_returns_defaults_exactly", async () => {
  const cfg = await loadConfigFrom({ global: await missingPath(), project: await missingPath() });
  expect(cfg).toEqual(DEFAULT_CONFIG);
});

test("test_global_only_keys_override_changes_only_that_key", async () => {
  const g = await writeSettings(JSON.stringify({ interrogator: { keys: { submit: "ctrl+enter" } } }));
  const cfg = await loadConfigFrom({ global: g, project: await missingPath() });
  expect(cfg.keys.submit).toBe("ctrl+enter");
  // every other default survives untouched
  const expected = { ...DEFAULT_CONFIG, keys: { ...DEFAULT_CONFIG.keys, submit: "ctrl+enter" } };
  expect(cfg).toEqual(expected);
});

test("test_deep_merge_project_caps_description_only_and_global_keys_survive", async () => {
  const g = await writeSettings(JSON.stringify({ interrogator: { keys: { deep: "ctrl+e" } } }));
  const p = await writeSettings(JSON.stringify({ interrogator: { caps: { description: 2000 } } }));
  const cfg = await loadConfigFrom({ global: g, project: p });
  // project nested override applied…
  expect(cfg.caps.description).toBe(2000);
  // …while sibling caps fields keep their defaults (deep, not wholesale replace)…
  expect(cfg.caps.ramification).toBe(DEFAULT_CONFIG.caps.ramification);
  expect(cfg.caps.options).toBe(DEFAULT_CONFIG.caps.options);
  expect(cfg.caps.questions).toBe(DEFAULT_CONFIG.caps.questions);
  expect(cfg.caps.goal).toBe(DEFAULT_CONFIG.caps.goal);
  expect(cfg.caps.contextBudgetPct).toBe(DEFAULT_CONFIG.caps.contextBudgetPct);
  // …and the global keys override survives the second merge.
  expect(cfg.keys.deep).toBe("ctrl+e");
  expect(cfg.keys).toEqual({ ...DEFAULT_CONFIG.keys, deep: "ctrl+e" });
});

test("test_project_wins_over_global_on_same_key", async () => {
  const g = await writeSettings(JSON.stringify({ interrogator: { keys: { submit: "ctrl+g" } } }));
  const p = await writeSettings(JSON.stringify({ interrogator: { keys: { submit: "ctrl+enter" } } }));
  const cfg = await loadConfigFrom({ global: g, project: p });
  expect(cfg.keys.submit).toBe("ctrl+enter");
});

test("test_malformed_json_file_falls_back_to_defaults_without_throwing", async () => {
  const bad = await writeSettings("{ not valid json !!!");
  const cfg = await loadConfigFrom({ global: bad, project: await missingPath() });
  expect(cfg).toEqual(DEFAULT_CONFIG);
});

test("test_non_object_interrogator_values_contribute_nothing", async () => {
  for (const value of [[1, 2, 3], "nope", null, 42, true]) {
    const p = await writeSettings(JSON.stringify({ interrogator: value }));
    const cfg = await loadConfigFrom({ global: p, project: await missingPath() });
    expect(cfg, `interrogator=${JSON.stringify(value)}`).toEqual(DEFAULT_CONFIG);
  }
});

test("test_settings_without_interrogator_key_yield_defaults", async () => {
  const p = await writeSettings(JSON.stringify({ theme: "dark", otherExt: { a: 1 } }));
  const cfg = await loadConfigFrom({ global: p, project: await missingPath() });
  expect(cfg).toEqual(DEFAULT_CONFIG);
});

test("test_empty_file_yields_defaults", async () => {
  const p = await writeSettings("   \n  ");
  const cfg = await loadConfigFrom({ global: p, project: await missingPath() });
  expect(cfg).toEqual(DEFAULT_CONFIG);
});

test("test_numeric_string_cap_is_coerced_to_number", async () => {
  const p = await writeSettings(JSON.stringify({ interrogator: { caps: { description: "2000" } } }));
  const cfg = await loadConfigFrom({ global: p, project: await missingPath() });
  expect(cfg.caps.description).toBe(2000);
  expect(typeof cfg.caps.description).toBe("number");
});

test("test_nan_ish_cap_values_fall_back_to_default", async () => {
  const p = await writeSettings(
    JSON.stringify({ interrogator: { caps: { description: "not-a-number", options: {} } } }),
  );
  const cfg = await loadConfigFrom({ global: p, project: await missingPath() });
  expect(cfg.caps.description).toBe(DEFAULT_CONFIG.caps.description);
  expect(cfg.caps.options).toBe(DEFAULT_CONFIG.caps.options);
});

test("test_toggles_coerce_bad_values_to_defaults_and_keep_false", async () => {
  const bad = await writeSettings(
    JSON.stringify({ interrogator: { gateWarnings: "yes", roundDetection: 0, digitQuickSelect: {} } }),
  );
  const cfg = await loadConfigFrom({ global: bad, project: await missingPath() });
  expect(cfg.gateWarnings).toBe(true);
  expect(cfg.roundDetection).toBe(true);
  expect(cfg.digitQuickSelect).toBe(true);
  const off = await writeSettings(JSON.stringify({ interrogator: { digitQuickSelect: false } }));
  const cfg2 = await loadConfigFrom({ global: off, project: await missingPath() });
  expect(cfg2.digitQuickSelect).toBe(false);
  expect(cfg2).toEqual({ ...DEFAULT_CONFIG, digitQuickSelect: false });
});

test("test_editor_mode_accepts_stock_and_rejects_unknown", async () => {
  const stock = await writeSettings(JSON.stringify({ interrogator: { editorMode: "stock" } }));
  const cfg = await loadConfigFrom({ global: stock, project: await missingPath() });
  expect(cfg.editorMode).toBe("stock");
  const bogus = await writeSettings(JSON.stringify({ interrogator: { editorMode: "fancy" } }));
  const cfg2 = await loadConfigFrom({ global: bogus, project: await missingPath() });
  expect(cfg2.editorMode).toBe(DEFAULT_CONFIG.editorMode);
});

test("test_non_object_section_replaces_then_recovers_via_coercion", async () => {
  // A non-object caps value replaces the section wholesale during merge;
  // shape enforcement must recover the defaults instead of crashing.
  const p = await writeSettings(JSON.stringify({ interrogator: { caps: 5 } }));
  const cfg = await loadConfigFrom({ global: p, project: await missingPath() });
  expect(cfg.caps).toEqual(DEFAULT_CONFIG.caps);
});

test("test_resolve_key_labels_covers_all_actions_with_default_config", async () => {
  const labels = resolveKeyLabels(DEFAULT_CONFIG);
  expect(Object.keys(labels).sort()).toEqual(Object.keys(DEFAULT_CONFIG.keys).sort());
  expect(Object.keys(labels)).toHaveLength(10);
  expect(labels.deep).toBe("Ctrl+D");
  expect(labels.overview).toBe("Ctrl+L");
  expect(labels.focusText).toBe("Ctrl+T");
  expect(labels.batchNote).toBe("Ctrl+Shift+M");
  expect(labels.submit).toBe("Ctrl+S");
  expect(labels.breakOut).toBe("Ctrl+Shift+Q");
  expect(labels.discuss).toBe("Ctrl+Shift+E");
  expect(labels.externalEditor).toBe("Ctrl+G");
  expect(labels.prevQuestion).toBe("Tab");
  expect(labels.nextQuestion).toBe("Shift+Tab");
});

test("test_resolve_key_labels_reflects_rebound_keys", async () => {
  const rebound = {
    ...DEFAULT_CONFIG,
    keys: { ...DEFAULT_CONFIG.keys, submit: "ctrl+enter", overview: "ctrl+shift+l" },
  };
  const labels = resolveKeyLabels(rebound);
  expect(labels.submit).toBe("Ctrl+Enter");
  expect(labels.overview).toBe("Ctrl+Shift+L");
  // untouched actions still labeled from config
  expect(labels.deep).toBe("Ctrl+D");
});

test("test_load_config_from_with_no_paths_returns_defaults", async () => {
  const cfg = await loadConfigFrom({});
  expect(cfg).toEqual(DEFAULT_CONFIG);
});
