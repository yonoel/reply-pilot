import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ensureDesktopApiToken,
  loadDesktopConfig,
  publicDesktopConfig,
  saveDesktopConfig
} from "../src/desktop/desktop-config.js";

test("desktop config loads defaults and saves project local desktop preferences", () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-desktop-"));
  try {
    const initial = loadDesktopConfig({ cwd });
    assert.equal(initial.theme, "pixel");
    assert.deepEqual(initial.position, {
      mode: "free",
      x: 1320,
      y: 820,
      corner: "bottom-right"
    });

    saveDesktopConfig(
      {
        ...initial,
        position: {
          mode: "free",
          x: 100,
          y: 200,
          corner: "bottom-right"
        }
      },
      { cwd }
    );

    const saved = loadDesktopConfig({ cwd });
    assert.equal(saved.position.x, 100);
    assert.equal(saved.position.y, 200);
    assert.equal(saved.approval.instructionMode, "rules");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("desktop config persists api token and omits it from public config", () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-desktop-"));
  try {
    const first = ensureDesktopApiToken({ cwd });
    const second = ensureDesktopApiToken({ cwd });

    assert.match(first, /^rp_/);
    assert.equal(second, first);
    assert.equal(loadDesktopConfig({ cwd }).apiToken, first);
    assert.equal(publicDesktopConfig(loadDesktopConfig({ cwd })).apiToken, undefined);
    assert.equal(statSync(join(cwd, ".reply-pilot", "desktop.json")).mode & 0o777, 0o600);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("desktop config falls back to defaults when the config file is corrupted", () => {
  const cwd = mkdtempSync(join(tmpdir(), "reply-pilot-desktop-"));
  try {
    saveDesktopConfig({ theme: "pixel" }, { cwd });
    writeFileSync(join(cwd, ".reply-pilot", "desktop.json"), "{");

    const config = loadDesktopConfig({ cwd });

    assert.equal(config.theme, "pixel");
    assert.equal(config.apiPort, 3017);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
