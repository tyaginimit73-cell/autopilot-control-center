import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED, findProfile, validate } from "../security/allowlist.js";

describe("allowlist", () => {
  it("supports exactly the 27 protocol action types", () => {
    assert.equal(ALLOWED.length, 27);
    for (const type of ["MOVE_MOUSE", "TYPE_TEXT", "OPEN_URL", "OPEN_APPLICATION", "WAIT", "REPEAT", "CONDITION", "STOP"]) {
      assert.ok((ALLOWED as readonly string[]).includes(type), type);
    }
  });

  it("accepts a well-formed dry-run command", () => {
    const report = validate({ id: "cmd-1", type: "MOVE_MOUSE", parameters: { x: 10, y: 20 }, timeoutMs: 5000, dryRun: true });
    assert.equal(report.ok, true);
    assert.equal(report.command?.type, "MOVE_MOUSE");
  });

  it("rejects unknown action types (no shell escape hatch)", () => {
    for (const type of ["EXEC_SHELL", "RUN_SCRIPT", "POWERSHELL", "OPEN_URLS"]) {
      const report = validate({ id: "cmd-x", type, parameters: {}, timeoutMs: 5000, dryRun: true });
      assert.equal(report.ok, false, type);
    }
  });

  it("rejects non-allowlisted keys", () => {
    const bad = validate({ id: "cmd-k", type: "PRESS_KEY", parameters: { key: "PRINTSCREEN" }, timeoutMs: 5000, dryRun: true });
    assert.equal(bad.ok, false);
    const good = validate({ id: "cmd-k2", type: "PRESS_KEY", parameters: { key: "ENTER" }, timeoutMs: 5000, dryRun: true });
    assert.equal(good.ok, true);
  });

  it("accepts compound modifier presets leg-by-leg", () => {
    const report = validate({
      id: "cmd-h",
      type: "HOTKEY",
      parameters: { modifiers: ["CTRL+ALT"], key: "TAB" },
      timeoutMs: 5000,
      dryRun: true,
    });
    assert.equal(report.ok, true);
    const evil = validate({
      id: "cmd-h2",
      type: "HOTKEY",
      parameters: { modifiers: ["CTRL+EVIL"], key: "TAB" },
      timeoutMs: 5000,
      dryRun: true,
    });
    assert.equal(evil.ok, false);
  });

  it("rejects non-http(s) URLs", () => {
    const report = validate({
      id: "cmd-u",
      type: "OPEN_URL",
      parameters: { url: "file:///etc/passwd" },
      timeoutMs: 5000,
      dryRun: true,
    });
    assert.equal(report.ok, false);
  });

  it("rejects suspicious locators", () => {
    const report = validate({
      id: "cmd-s",
      type: "CLICK_ELEMENT",
      parameters: { selectorType: "css", selector: "javascript:alert(1)" },
      timeoutMs: 5000,
      dryRun: true,
    });
    assert.equal(report.ok, false);
  });

  it("resolves OPEN_APPLICATION against caller-supplied profiles only", () => {
    const profiles = [{ id: "app-chrome", name: "Chrome", executablePath: "chrome.exe", arguments: [], enabled: true }];
    const ok = validate(
      { id: "cmd-a", type: "OPEN_APPLICATION", parameters: { applicationId: "app-chrome" }, timeoutMs: 5000, dryRun: true },
      profiles,
    );
    assert.equal(ok.ok, true);
    // Empty profile list: nothing is launchable (no undefined-variable crash).
    const denied = validate(
      { id: "cmd-a2", type: "OPEN_APPLICATION", parameters: { applicationId: "app-chrome" }, timeoutMs: 5000, dryRun: true },
      [],
    );
    assert.equal(denied.ok, false);
    assert.match(denied.reason ?? "", /not configured on this machine/);
    assert.equal(findProfile("Chrome", profiles)?.id, "app-chrome");
    assert.equal(findProfile("nope", profiles), null);
  });

  it("rejects commands without an id", () => {
    const report = validate({ type: "WAIT", parameters: { milliseconds: 10 }, timeoutMs: 5000, dryRun: true });
    assert.equal(report.ok, false);
  });
});
