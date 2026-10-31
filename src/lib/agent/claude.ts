import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AgentProviderError, FALLBACK_REPLY, MAX_TOOL_ROUNDS, SYSTEM_PROMPT, type ChatHistory } from "./prompt";
import type { AgentTool } from "./tools";

const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_TOKENS = 16_000;

let client: Anthropic | null = null;

export async function runClaude(history: ChatHistory, tools: AgentTool[]): Promise<string> {
  client ??= new Anthropic();
  try {
    const final = await client.beta.messages.toolRunner({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      max_iterations: MAX_TOOL_ROUNDS,
      system: SYSTEM_PROMPT,
      output_config: { effort: "medium" },
      // Retry on another model if a safety classifier declines a legitimate billing request.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tools: tools.map((t) =>
        betaZodTool({ name: t.name, description: t.description, inputSchema: t.inputSchema as never, run: t.run }),
      ),
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    });

    if (final.stop_reason === "refusal") return "Sorry, I can't help with that request.";
    const text = final.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    return text || FALLBACK_REPLY;
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new AgentProviderError("The AI is busy - try again in a moment.", 429);
    if (error instanceof Anthropic.AuthenticationError) throw new AgentProviderError("The Anthropic API key was rejected.", 503);
    if (error instanceof Anthropic.APIError) {
      console.error("Claude API error", error.status, error.message);
      throw new AgentProviderError("The AI service returned an error. Try again.", 502);
    }
    throw error;
  }
}
