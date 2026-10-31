import { describe, expect, it } from "vitest";
import { AgentConfigError } from "./prompt";
import { resolveProvider } from "./provider";

describe("resolveProvider", () => {
  it("honours AI_PROVIDER when its key is present", () => {
    expect(resolveProvider({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toBe("gemini");
    expect(resolveProvider({ AI_PROVIDER: "Anthropic", ANTHROPIC_API_KEY: "a" })).toBe("anthropic");
  });

  it("falls back to whichever key exists, preferring Anthropic", () => {
    expect(resolveProvider({ GEMINI_API_KEY: "g" })).toBe("gemini");
    expect(resolveProvider({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" })).toBe("anthropic");
  });

  it("explains which key is missing", () => {
    expect(() => resolveProvider({ AI_PROVIDER: "gemini" })).toThrow(/GEMINI_API_KEY is not set/);
    expect(() => resolveProvider({})).toThrow(AgentConfigError);
  });
});
