import { describe, it, expect } from "vitest";
import { buildPong, buildPongFromChallenge } from "@/protocol/pongs";

describe("pongs", () => {
  it("echoes the challenge verbatim (non-empty)", () => {
    const pong = buildPong({
      type: "PING",
      seq: 1,
      challenge: "a1b2c3",
    });
    expect(pong).toEqual({ type: "PONG", echo: "a1b2c3" });
  });

  it("echoes an empty challenge verbatim (chaos mode)", () => {
    const pong = buildPong({
      type: "PING",
      seq: 7,
      challenge: "",
    });
    expect(pong).toEqual({ type: "PONG", echo: "" });
  });

  it("buildPongFromChallenge always returns a typed PONG", () => {
    expect(buildPongFromChallenge("xyz")).toEqual({ type: "PONG", echo: "xyz" });
    expect(buildPongFromChallenge("")).toEqual({ type: "PONG", echo: "" });
  });

  it("preserves unicode in the challenge", () => {
    const pong = buildPongFromChallenge("\u00e9\u00e8\u00ea");
    expect(pong.echo).toBe("\u00e9\u00e8\u00ea");
  });
});
