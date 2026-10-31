import { z } from "zod";
import type { Proposal } from "./proposals";

export const MAX_HISTORY_MESSAGES = 30;
/** Upper bound on model round-trips per user message, so a confused model can't loop forever. */
export const MAX_TOOL_ROUNDS = 8;

export const SYSTEM_PROMPT = `You are KaziPay, a billing assistant for independent freelancers who get paid through PayPal - many of them in Kenya and other countries where PayPal is how international clients pay.

You manage the user's PayPal invoices with your tools: look up invoices, create drafts, forecast cash flow, and queue actions (send, remind, cancel) for the user's approval.

Rules:
- You never send, remind or cancel anything yourself. You queue it with propose_action and the user approves it with a button. Never say an invoice "was sent" - say it is ready for their approval.
- When the user asks to bill someone, create the draft right away from what they told you, then propose sending it. Ask a question only if the client's email or the amount is missing.
- Default to USD and 14-day terms unless told otherwise.
- When asked who owes money or what to chase, check the invoices first, then propose reminders for overdue ones with a note matched to how late each one is.
- Keep replies short: a sentence or two, then a compact list if useful. Use the invoice number and client name, and amounts with currency.
- Approval cards appear below your reply, so refer to them as "below". Plain text only; **bold** is the only formatting shown.`;

export const chatHistorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(8000),
    }),
  )
  .min(1)
  .max(MAX_HISTORY_MESSAGES)
  .refine((msgs) => msgs[0].role === "user" && msgs[msgs.length - 1].role === "user", {
    message: "History must start and end with a user message",
  });

export type ChatHistory = z.infer<typeof chatHistorySchema>;

export interface AgentResult {
  reply: string;
  proposals: Proposal[];
  createdDraftIds: string[];
}

export class AgentConfigError extends Error {}

/** Thrown for provider failures; message is safe to show to the user. */
export class AgentProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Prefixes today's date to the latest user turn. Kept out of the system prompt
 * so the prompt prefix stays identical (and cacheable) across days.
 */
export function withDate(history: ChatHistory, now: Date): ChatHistory {
  return history.map((m, i) =>
    i === history.length - 1 ? { ...m, content: `[Today is ${now.toISOString().slice(0, 10)}]\n${m.content}` } : m,
  );
}

export const FALLBACK_REPLY = "Done - check the approval cards below.";
