import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maskPairingCode, normalizePairingCode } from "../credentials/store.js";
import { maskToken } from "../transport/client.js";

describe("normalizePairingCode", () => {
  it("accepts canonical codes", () => {
    assert.equal(normalizePairingCode("PAIR-AB12-CD34"), "PAIR-AB12-CD34");
  });

  it("trims and uppercases before validating", () => {
    assert.equal(normalizePairingCode("  pair-ab12-cd34\n"), "PAIR-AB12-CD34");
  });

  it("rejects malformed codes without echoing them", () => {
    for (const bad of ["", "PAIR-ABC", "PAIR-AB12-CD3", "PAIR-AB12-CD345", "XAIR-AB12-CD34", "PAIR AB12 CD34", "supersecretcode123"]) {
      assert.throws(() => normalizePairingCode(bad), /Invalid pairing code/, `should reject ${JSON.stringify(bad)}`);
      try {
        normalizePairingCode(bad);
        assert.fail("must throw");
      } catch (error) {
        const message = (error as Error).message;
        if (bad.length > 9) assert.ok(!message.includes(bad), `error must not echo input: ${message}`);
        assert.match(message, /PAIR-XXXX-XXXX/);
      }
    }
  });
});

describe("maskPairingCode", () => {
  it("shows the last block only", () => {
    assert.equal(maskPairingCode("PAIR-AB12-CD34"), "PAIR-••••-CD34");
  });

  it("never returns its input", () => {
    for (const input of ["PAIR-AB12-CD34", "short", "x".repeat(64)]) {
      const masked = maskPairingCode(input);
      assert.ok(!masked.includes(input), `mask leaked input: ${masked}`);
    }
    assert.equal(maskPairingCode(""), "PAIR-••••-••••");
  });
});

describe("maskToken", () => {
  it("masks while keeping a debuggable prefix", () => {
    assert.equal(maskToken(null), "(none)");
    assert.equal(maskToken(undefined), "(none)");
    assert.equal(maskToken("abc"), "abc…");
    assert.equal(maskToken("apd_9c1c12c5_deadbeefcafef00d"), "apd_9c1c12c5…");
  });

  it("never returns the full token", () => {
    const token = "apd_9c1c12c5_0123456789abcdef0123456789abcdef0123456789abcdef";
    const masked = maskToken(token);
    assert.ok(!masked.includes(token.slice(12)), `mask leaked token material: ${masked}`);
  });
});
