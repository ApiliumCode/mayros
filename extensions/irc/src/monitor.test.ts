import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#mayros",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#mayros",
      rawTarget: "#mayros",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "mayros-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "mayros-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "mayros-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "mayros-bot",
      rawTarget: "mayros-bot",
    });
  });
});
