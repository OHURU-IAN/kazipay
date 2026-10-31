import { AgentConfigError, AgentProviderError, chatHistorySchema, runAgent } from "@/lib/agent/run";
import { clientKey, fail, ok, rateLimited } from "@/lib/http";
import { PayPalError } from "@/lib/paypal/client";
import { getGateway } from "@/lib/paypal/gateway";

export const runtime = "nodejs";
export const maxDuration = 120;

const CHAT_LIMIT_PER_WINDOW = Number(process.env.CHAT_RATE_LIMIT ?? 30);

export async function POST(req: Request) {
  if (rateLimited(`chat:${clientKey(req)}`, CHAT_LIMIT_PER_WINDOW)) {
    return fail("Too many messages - please wait a few minutes.", 429);
  }

  const body = await req.json().catch(() => null);
  const parsed = chatHistorySchema.safeParse(body?.messages);
  if (!parsed.success) return fail("Invalid chat history", 400);

  try {
    return ok(await runAgent(parsed.data, getGateway()));
  } catch (error) {
    if (error instanceof AgentConfigError) return fail(error.message, 503);
    if (error instanceof AgentProviderError) return fail(error.message, error.status);
    if (error instanceof PayPalError) return fail(`PayPal: ${error.message}`, 502);
    console.error("Chat failed", error);
    return fail("Something went wrong. Try again.", 500);
  }
}
