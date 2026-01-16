import { describe, expect, test } from "bun:test";
import {
  decodeMessage,
  encodeMessage,
  type Hello,
  type Ping,
} from "./protocol";

const sampleHello: Hello = {
  type: "hello",
  id: "client-123",
  host: "host1",
  os: "windows",
  arch: "amd64",
  version: "v1",
  user: "user1",
  monitors: 1,
  country: "US",
};

describe("protocol encode/decode", () => {
  test("round trips hello via msgpack", () => {
    const encoded = encodeMessage(sampleHello);
    const decoded = decodeMessage(encoded) as Hello;

    expect(decoded.type).toBe("hello");
    expect(decoded.id).toBe(sampleHello.id);
    expect(decoded.os).toBe(sampleHello.os);
    expect(decoded.arch).toBe(sampleHello.arch);
    expect(decoded.country).toBe(sampleHello.country);
  });

  test("decodes JSON strings for compatibility", () => {
    const pingJson = JSON.stringify({ type: "ping", ts: 123 } satisfies Ping);
    const decoded = decodeMessage(pingJson) as Ping;

    expect(decoded.type).toBe("ping");
    expect(decoded.ts).toBe(123);
  });
});
