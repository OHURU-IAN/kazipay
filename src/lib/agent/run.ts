import "server-only";
import type { InvoiceGateway } from "@/lib/paypal/types";
import { runClaude } from "./claude";
import { runGemini } from "./gemini";
import { withDate, type AgentResult, type ChatHistory } from "./prompt";
import { resolveProvider } from "./provider";
import { buildTools, type ToolContext } from "./tools";

export { AgentConfigError, AgentProviderError, chatHistorySchema, type AgentResult } from "./prompt";

export async function runAgent(history: ChatHistory, gateway: InvoiceGateway, now: Date = new Date()): Promise<AgentResult> {
  const provider = resolveProvider();
  const ctx: ToolContext = { gateway, now, proposals: [], createdDraftIds: [] };
  const tools = buildTools(ctx);
  const dated = withDate(history, now);

  const reply = provider === "gemini" ? await runGemini(dated, tools) : await runClaude(dated, tools);
  return { reply, proposals: ctx.proposals, createdDraftIds: ctx.createdDraftIds };
}
