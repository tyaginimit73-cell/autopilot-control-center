import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SseParser } from "../transport/events.js";

describe("SseParser", () => {
  it("parses event + data frames", () => {
    const parser = new SseParser();
    const events = parser.push('event: command\ndata: {"id":"1"}\n\n');
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "command");
    assert.equal(events[0].data, '{"id":"1"}');
  });

  it("handles chunk splits mid-frame and CRLF", () => {
    const parser = new SseParser();
    assert.equal(parser.push("event: hel").length, 0);
    assert.equal(parser.push("lo\r\ndata: {\"a\":").length, 0);
    const events = parser.push("1}\r\n\r\n");
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "hello");
    assert.equal(events[0].data, '{"a":1}');
  });

  it("ignores comment keepalives and tracks ids", () => {
    const parser = new SseParser();
    const events = parser.push(": keepalive\n\nid: 42\nevent: command\ndata: {}\n\n");
    assert.equal(events.length, 1);
    assert.equal(events[0].id, "42");
    assert.equal(parser.lastEventId, "42");
  });

  it("joins multi-line data with newlines", () => {
    const parser = new SseParser();
    const events = parser.push("event: command\ndata: line1\ndata: line2\n\n");
    assert.equal(events.length, 1);
    assert.equal(events[0].data, "line1\nline2");
  });

  it("dispatches multiple frames from one chunk", () => {
    const parser = new SseParser();
    const events = parser.push("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n");
    assert.deepEqual(
      events.map((e) => e.event),
      ["a", "b"],
    );
  });
});
