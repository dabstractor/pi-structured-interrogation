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
import { afterEach, describe, expect, test, vi } from "vitest";
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

test("test_deep_merge_project_keys_override_and_global_sibling_survives", async () => {
  const g = await writeSettings(JSON.stringify({ interrogator: { keys: { deep: "ctrl+e" } } }));
  const p = await writeSettings(JSON.stringify({ interrogator: { keys: { submit: "ctrl+enter" } } }));
  const cfg = await loadConfigFrom({ global: g, project: p });
  expect(cfg.keys.deep).toBe("ctrl+e");
  expect(cfg.keys.submit).toBe("ctrl+enter");
  expect(cfg.keys).toEqual({ ...DEFAULT_CONFIG.keys, deep: "ctrl+e", submit: "ctrl+enter" });
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

test("test_numeric_string_toggle_values_still_coerce_via_booleans", async () => {
  // (the former numeric-string caps coercion tests are gone with caps —
  // CAPS-OUT-001: no limits, no caps config block)
  const p = await writeSettings(JSON.stringify({ interrogator: { gateWarnings: "yes" } }));
  const cfg = await loadConfigFrom({ global: p, project: await missingPath() });
  expect(cfg.gateWarnings).toBe(true);
});

test("test_toggles_coerce_bad_values_to_defaults_and_keep_false", async () => {
  const bad = await writeSettings(
    JSON.stringify({ interrogator: { gateWarnings: "yes", roundDetection: 0 } }),
  );
  const cfg = await loadConfigFrom({ global: bad, project: await missingPath() });
  expect(cfg.gateWarnings).toBe(true);
  expect(cfg.roundDetection).toBe(true);
  // DIGIT-OUT-001: digitQuickSelect is deleted from the schema. A settings
  // file still carrying it loads cleanly — coerceConfig rebuilds the config
  // field-by-field, so the unknown key contributes nothing and is ABSENT
  // from the resolved object (AC-3).
  const stale = await writeSettings(
    JSON.stringify({ interrogator: { gateWarnings: false, digitQuickSelect: false } }),
  );
  const cfg2 = await loadConfigFrom({ global: stale, project: await missingPath() });
  expect(cfg2.gateWarnings).toBe(false);
  expect("digitQuickSelect" in cfg2).toBe(false);
  expect(Object.keys(cfg2)).not.toContain("digitQuickSelect");
  expect(cfg2).toEqual({ ...DEFAULT_CONFIG, gateWarnings: false });
});

test("test_editor_mode_accepts_stock_and_rejects_unknown", async () => {
  const stock = await writeSettings(JSON.stringify({ interrogator: { editorMode: "stock" } }));
  const cfg = await loadConfigFrom({ global: stock, project: await missingPath() });
  expect(cfg.editorMode).toBe("stock");
  const bogus = await writeSettings(JSON.stringify({ interrogator: { editorMode: "fancy" } }));
  const cfg2 = await loadConfigFrom({ global: bogus, project: await missingPath() });
  expect(cfg2.editorMode).toBe(DEFAULT_CONFIG.editorMode);
});

test("test_resolve_key_labels_covers_all_actions_with_default_config", async () => {
  const labels = resolveKeyLabels(DEFAULT_CONFIG);
  expect(Object.keys(labels).sort()).toEqual(Object.keys(DEFAULT_CONFIG.keys).sort());
  expect(Object.keys(labels)).toHaveLength(9);
  expect(labels.deep).toBe("d");
  expect(labels.overview).toBe("i");
  expect(labels.elaborate).toBe("e");
  expect(labels.batchNote).toBe("n");
  expect(labels.submit).toBe("Ctrl+S");
  expect(labels.chat).toBe("c");
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
  expect(labels.deep).toBe("d");
});

test("test_load_config_from_with_no_paths_returns_defaults", async () => {
  const cfg = await loadConfigFrom({});
  expect(cfg).toEqual(DEFAULT_CONFIG);
});

// ------------------ focusText→elaborate legacy alias (BAREKEYS-001 compat)

describe("focusText→elaborate legacy alias (BAREKEYS-001)", () => {
  test("test_alias_legacy_focusText_feeds_elaborate_when_new_name_absent", async () => {
    const g = await writeSettings(JSON.stringify({ interrogator: { keys: { focusText: "ctrl+j" } } }));
    const cfg = await loadConfigFrom({ global: g, project: await missingPath() });
    expect(cfg.keys.elaborate).toBe("ctrl+j");
    expect(resolveKeyLabels(cfg).elaborate).toBe("Ctrl+J"); // footer label inherits
    // The raw legacy name never leaks into the resolved key surface.
    expect((cfg.keys as Record<string, unknown>).focusText).toBeUndefined();
  });

  test("test_alias_explicit_elaborate_wins_over_focusText", async () => {
    const g = await writeSettings(
      JSON.stringify({ interrogator: { keys: { focusText: "ctrl+j", elaborate: "ctrl+k" } } }),
    );
    const cfg = await loadConfigFrom({ global: g, project: await missingPath() });
    expect(cfg.keys.elaborate).toBe("ctrl+k");
    expect(resolveKeyLabels(cfg).elaborate).toBe("Ctrl+K");
  });

  test("test_alias_explicit_elaborate_equal_to_default_still_wins", async () => {
    // The alias contract is PRESENCE-based ("an explicit keys.elaborate
    // always wins"), not value-based: a user rebind to exactly the default
    // is still an explicit new-name binding and beats a stale legacy
    // focusText in the same settings (presence is read from the raw
    // pre-DEFAULT-merge user map, where absence is observable).
    const g = await writeSettings(
      JSON.stringify({
        interrogator: { keys: { focusText: "ctrl+j", elaborate: DEFAULT_CONFIG.keys.elaborate } },
      }),
    );
    const cfg = await loadConfigFrom({ global: g, project: await missingPath() });
    expect(cfg.keys.elaborate).toBe(DEFAULT_CONFIG.keys.elaborate);
    expect(resolveKeyLabels(cfg).elaborate).toBe("e");
  });

  test("test_alias_invalid_elaborate_does_not_win_over_focusText", async () => {
    // An INVALID new-name value never beats a valid legacy binding.
    for (const bad of ["", "   ", 42, null]) {
      const g = await writeSettings(
        JSON.stringify({ interrogator: { keys: { focusText: "ctrl+j", elaborate: bad } } }),
      );
      const cfg = await loadConfigFrom({ global: g, project: await missingPath() });
      expect(cfg.keys.elaborate, `elaborate=${JSON.stringify(bad)}`).toBe("ctrl+j");
    }
  });

  test("test_alias_no_legacy_name_yields_default_elaborate", async () => {
    // Value-agnostic default assertion (asserting DEFAULT_CONFIG survives
    // the T2 default flip unchanged).
    for (const keys of [{}, { focusText: "" }, { focusText: 42 }, { elaborate: "" }]) {
      const g = await writeSettings(JSON.stringify({ interrogator: { keys } }));
      const cfg = await loadConfigFrom({ global: g, project: await missingPath() });
      expect(cfg.keys.elaborate, `keys=${JSON.stringify(keys)}`).toBe(DEFAULT_CONFIG.keys.elaborate);
    }
  });

  test("test_alias_is_silent_no_console_output", async () => {
    // Silence is contractual (tolerant-coercion posture) — zero warns/logs.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const g = await writeSettings(
        JSON.stringify({ interrogator: { keys: { focusText: "ctrl+j" } } }),
      );
      await loadConfigFrom({ global: g, project: await missingPath() });
      expect(warn).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      info.mockRestore();
      error.mockRestore();
    }
  });

  test("test_alias_applies_after_global_project_deep_merge", async () => {
    // Merge-level: the alias runs on the DEEP-MERGED raw keys map, so a
    // global legacy binding survives a project file that touches other keys.
    const g = await writeSettings(JSON.stringify({ interrogator: { keys: { focusText: "ctrl+j" } } }));
    const p = await writeSettings(JSON.stringify({ interrogator: { keys: { submit: "ctrl+enter" } } }));
    const cfg = await loadConfigFrom({ global: g, project: p });
    expect(cfg.keys.elaborate).toBe("ctrl+j");
    expect(cfg.keys.submit).toBe("ctrl+enter"); // the project override still applies
  });
});

// ------------------ discuss→chat legacy alias (SIDECHAT-001 compat)

describe("discuss→chat legacy alias (SIDECHAT-001)", () => {
  test("test_alias_legacy_discuss_feeds_chat_when_new_name_absent", async () => {
    const g = await writeSettings(JSON.stringify({ interrogator: { keys: { discuss: "ctrl+shift+d" } } }));
    const cfg = await loadConfigFrom({ global: g, project: await missingPath() });
    expect(cfg.keys.chat).toBe("ctrl+shift+d");
    expect(resolveKeyLabels(cfg).chat).toBe("Ctrl+Shift+D"); // footer label inherits
    // The raw legacy name never leaks into the resolved key surface.
    expect((cfg.keys as Record<string, unknown>).discuss).toBeUndefined();
  });

  test("test_alias_explicit_chat_wins_over_discuss", async () => {
    const g = await writeSettings(
      JSON.stringify({ interrogator: { keys: { discuss: "ctrl+shift+d", chat: "ctrl+k" } } }),
    );
    const cfg = await loadConfigFrom({ global: g, project: await missingPath() });
    expect(cfg.keys.chat).toBe("ctrl+k");
    expect(resolveKeyLabels(cfg).chat).toBe("Ctrl+K");
  });

  test("test_alias_explicit_chat_equal_to_default_still_wins", async () => {
    // PRESENCE-based (the whole reason userKeys is threaded): a user rebind
    // of chat to exactly the default "e" is still an explicit new-name
    // binding and beats a stale legacy discuss in the same settings —
    // presence is read from the raw pre-DEFAULT-merge user map, where
    // absence is observable.
    const g = await writeSettings(
      JSON.stringify({
        interrogator: { keys: { discuss: "ctrl+shift+d", chat: DEFAULT_CONFIG.keys.chat } },
      }),
    );
    const cfg = await loadConfigFrom({ global: g, project: await missingPath() });
    expect(cfg.keys.chat).toBe(DEFAULT_CONFIG.keys.chat);
    expect(resolveKeyLabels(cfg).chat).toBe(resolveKeyLabels(DEFAULT_CONFIG).chat);
  });

  test("test_alias_invalid_discuss_ignored_yields_default_chat", async () => {
    // A blank/invalid legacy binding contributes nothing → the default.
    for (const bad of ["", "   ", 42, null]) {
      const g = await writeSettings(JSON.stringify({ interrogator: { keys: { discuss: bad } } }));
      const cfg = await loadConfigFrom({ global: g, project: await missingPath() });
      expect(cfg.keys.chat, `discuss=${JSON.stringify(bad)}`).toBe(DEFAULT_CONFIG.keys.chat);
    }
  });

  test("test_chat_alias_is_silent_no_console_output", async () => {
    // Silence is contractual (tolerant-coercion posture) — zero warns/logs.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const g = await writeSettings(
        JSON.stringify({ interrogator: { keys: { discuss: "ctrl+shift+d" } } }),
      );
      await loadConfigFrom({ global: g, project: await missingPath() });
      expect(warn).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      info.mockRestore();
      error.mockRestore();
    }
  });

  test("test_chat_alias_applies_after_global_project_deep_merge", async () => {
    // Merge-level: the alias runs on the DEEP-MERGED raw keys map, so a
    // global legacy binding survives a project file that touches other keys.
    const g = await writeSettings(JSON.stringify({ interrogator: { keys: { discuss: "ctrl+shift+d" } } }));
    const p = await writeSettings(JSON.stringify({ interrogator: { keys: { submit: "ctrl+enter" } } }));
    const cfg = await loadConfigFrom({ global: g, project: p });
    expect(cfg.keys.chat).toBe("ctrl+shift+d");
    expect(cfg.keys.submit).toBe("ctrl+enter"); // the project override still applies
  });

  test("test_both_aliases_compose_independently", async () => {
    // The two aliases are INDEPENDENT per action: one settings file can
    // carry both legacy bindings and each feeds its own new name.
    const g = await writeSettings(
      JSON.stringify({ interrogator: { keys: { focusText: "ctrl+j", discuss: "ctrl+shift+d" } } }),
    );
    const cfg = await loadConfigFrom({ global: g, project: await missingPath() });
    expect(cfg.keys.elaborate).toBe("ctrl+j");
    expect(cfg.keys.chat).toBe("ctrl+shift+d");
  });
});

// ------------------------------------------- side chat settings (SIDECHAT-001…005)

describe("side chat config — sideChatModel + sideChatAutoApply", () => {
  test("test_sideChatAutoApply_coercion_matrix", async () => {
    // Booleans pass; "true"/"false" strings coerce; anything ill-typed or
    // absent falls back to the default false.
    const cases: Array<[unknown, boolean]> = [
      [true, true],
      ["true", true],
      [false, false],
      ["false", false],
      ["yes", false],
      [1, false],
    ];
    for (const [value, expected] of cases) {
      const p = await writeSettings(JSON.stringify({ interrogator: { sideChatAutoApply: value } }));
      const cfg = await loadConfigFrom({ global: p, project: await missingPath() });
      expect(cfg.sideChatAutoApply, `sideChatAutoApply=${JSON.stringify(value)}`).toBe(expected);
    }
    const absent = await loadConfigFrom({ global: await missingPath(), project: await missingPath() });
    expect(absent.sideChatAutoApply).toBe(false);
  });

  test("test_sideChatModel_valid_string_passes_through_untrimmed", async () => {
    // The ORIGINAL string is stored — only the blank CHECK trims, never the
    // stored value.
    const p = await writeSettings(
      JSON.stringify({ interrogator: { sideChatModel: "anthropic/claude-sonnet-4" } }),
    );
    const cfg = await loadConfigFrom({ global: p, project: await missingPath() });
    expect(cfg.sideChatModel).toBe("anthropic/claude-sonnet-4");
  });

  test("test_sideChatModel_whitespace_only_is_undefined", async () => {
    const p = await writeSettings(JSON.stringify({ interrogator: { sideChatModel: "   " } }));
    const cfg = await loadConfigFrom({ global: p, project: await missingPath() });
    expect(cfg.sideChatModel).toBeUndefined();
  });

  test("test_sideChatModel_absent_is_undefined", async () => {
    // The absence semantics are the POINT: DEFAULT_CONFIG carries NO
    // sideChatModel key, so deep-merge + coercion leave it undefined —
    // "use the session's current model at chat open".
    const cfg = await loadConfigFrom({ global: await missingPath(), project: await missingPath() });
    expect(cfg.sideChatModel).toBeUndefined();
  });

  test("test_sideChatModel_non_string_is_undefined", async () => {
    const p = await writeSettings(JSON.stringify({ interrogator: { sideChatModel: 42 } }));
    const cfg = await loadConfigFrom({ global: p, project: await missingPath() });
    expect(cfg.sideChatModel).toBeUndefined();
  });

  test("test_sidechat_defaults_shape", () => {
    // DEFAULT_CONFIG regression: the boolean default exists; the optional
    // string must NOT (a defaulted key would defeat absent-vs-set via the
    // deep merge — coerceConfig could never yield undefined).
    expect(DEFAULT_CONFIG.sideChatAutoApply).toBe(false);
    expect("sideChatModel" in DEFAULT_CONFIG).toBe(false);
  });
});
