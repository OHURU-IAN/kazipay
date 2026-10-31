import { z } from "zod";
import type { InvoiceStatus } from "@/lib/paypal/types";

export const proposalActionSchema = z.enum(["send", "remind", "cancel"]);
export type ProposalAction = z.infer<typeof proposalActionSchema>;

export const proposalSchema = z.object({
  action: proposalActionSchema,
  invoiceId: z.string().regex(/^[A-Z0-9-]+$/i),
  subject: z.string().max(200).optional(),
  note: z.string().max(4000).optional(),
});
export type ProposalInput = z.infer<typeof proposalSchema>;

export interface Proposal extends ProposalInput {
  id: string;
  invoiceNumber: string;
  client: string;
  amount: string;
  reason: string;
}

const ALLOWED_FROM: Record<ProposalAction, ReadonlySet<InvoiceStatus>> = {
  send: new Set(["DRAFT"]),
  remind: new Set(["SENT", "UNPAID", "PARTIALLY_PAID"]),
  cancel: new Set(["SENT", "UNPAID", "PARTIALLY_PAID", "SCHEDULED"]),
};

/** Returns an error message when the action is not valid for the invoice's status. */
export function checkTransition(action: ProposalAction, status: InvoiceStatus): string | null {
  return ALLOWED_FROM[action].has(status)
    ? null
    : `Cannot ${action} invoice in status ${status}. Allowed from: ${[...ALLOWED_FROM[action]].join(", ")}`;
}
