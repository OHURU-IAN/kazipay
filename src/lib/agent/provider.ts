import { AgentConfigError } from "./prompt";

export type Provider = "anthropic" | "gemini";

/** AI_PROVIDER wins; otherwise use whichever key is present, preferring Anthropic. */
export function resolveProvider(env: Record<string, string | undefined> = process.env): Provider {
  const requested = env.AI_PROVIDER?.toLowerCase();
  const provider: Provider | null =
    requested === "gemini" || requested === "anthropic"
      ? requested
      : env.ANTHROPIC_API_KEY
        ? "anthropic"
        : env.GEMINI_API_KEY
          ? "gemini"
          : null;

  if (!provider) {
    throw new AgentConfigError("No AI key set. Add GEMINI_API_KEY (free) or ANTHROPIC_API_KEY to .env.local.");
  }
  const keyName = provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  if (!env[keyName]) {
    throw new AgentConfigError(`${keyName} is not set. Add it to .env.local to enable the assistant.`);
  }
  return provider;
}
