import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildInvoicePayload, draftInvoiceSchema } from "@/lib/invoices/build";
import { primaryCurrency, summarizeCashflow, toInvoiceRow, type InvoiceRow } from "@/lib/invoices/summary";
import type { InvoiceGateway } from "@/lib/paypal/types";
import { checkTransition, proposalActionSchema, type Proposal } from "./proposals";

const STATUS_FILTERS = {
  open: (r: InvoiceRow) => r.outstanding > 0,
  overdue: (r: InvoiceRow) => r.daysOverdue > 0,
  paid: (r: InvoiceRow) => r.risk === "paid",
  draft: (r: InvoiceRow) => r.status === "DRAFT",
  all: () => true,
} as const;

export interface ToolContext {
  gateway: InvoiceGateway;
  now: Date;
  /** Collects actions the agent wants the user to approve; nothing is sent by the agent itself. */
  proposals: Proposal[];
  createdDraftIds: string[];
}

/** Provider-neutral tool: each AI provider adapter turns these into its own tool format. */
export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  inputSchema: S;
  run: (input: z.infer<S>) => Promise<string>;
}

function defineTool<S extends z.ZodType>(tool: AgentTool<S>): AgentTool {
  return tool as unknown as AgentTool;
}

function errorText(error: unknown): string {
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

/** Wraps a tool body so failures go back to the model as text instead of crashing the loop. */
function safely<T>(fn: (input: T) => Promise<string>): (input: T) => Promise<string> {
  return async (input) => {
    try {
      return await fn(input);
    } catch (error) {
      return errorText(error);
    }
  };
}

async function loadRows(ctx: ToolContext): Promise<InvoiceRow[]> {
  const invoices = await ctx.gateway.listInvoices();
  return invoices.map((inv) => toInvoiceRow(inv, ctx.now));
}

export function buildTools(ctx: ToolContext): AgentTool[] {
  const listInvoices = defineTool({
    name: "list_invoices",
    description:
      "List the freelancer's PayPal invoices with client, amount, status, due date, days overdue and a risk label " +
      "(on_track, due_soon, overdue, at_risk = 30+ days late, paid, draft, closed).",
    inputSchema: z.object({
      filter: z.enum(["open", "overdue", "paid", "draft", "all"]).default("all"),
    }),
    run: safely(async ({ filter }) => {
      const rows = (await loadRows(ctx)).filter(STATUS_FILTERS[filter]);
      // Pay links are long and useless to the model; leave them out to save tokens.
      return JSON.stringify(rows.map((row) => ({ ...row, payUrl: undefined })));
    }),
  });

  const getInvoice = defineTool({
    name: "get_invoice",
    description: "Get full details of one invoice, including line items and notes.",
    inputSchema: z.object({ invoiceId: z.string() }),
    run: safely(async ({ invoiceId }) => {
      const invoice = await ctx.gateway.getInvoice(invoiceId);
      return JSON.stringify({ ...toInvoiceRow(invoice, ctx.now), items: invoice.items, note: invoice.detail.note });
    }),
  });

  const createDraft = defineTool({
    name: "create_draft_invoice",
    description:
      "Create a DRAFT PayPal invoice. Drafts are not sent to anyone. After creating one, call propose_action " +
      "with action=send so the user can review and approve sending it.",
    inputSchema: draftInvoiceSchema,
    run: safely(async (input) => {
      const invoice = await ctx.gateway.createDraft(buildInvoicePayload(input, ctx.now));
      ctx.createdDraftIds.push(invoice.id);
      return JSON.stringify(toInvoiceRow(invoice, ctx.now));
    }),
  });

  const proposeAction = defineTool({
    name: "propose_action",
    description:
      "Queue an action on an invoice for the user to approve with one click: send a draft, send a payment " +
      "reminder, or cancel an invoice. This does NOT perform the action. For reminders, write the note yourself: " +
      "warm and short when 1-14 days late, firmer when later, always polite, mentioning the invoice number and amount.",
    inputSchema: z.object({
      action: proposalActionSchema,
      invoiceId: z.string(),
      subject: z.string().max(200).optional().describe("Email subject line"),
      note: z.string().max(4000).optional().describe("Message to the client"),
      reason: z.string().max(300).describe("One sentence for the user on why you suggest this"),
    }),
    run: safely(async ({ action, invoiceId, subject, note, reason }) => {
      const row = toInvoiceRow(await ctx.gateway.getInvoice(invoiceId), ctx.now);
      const invalid = checkTransition(action, row.status);
      if (invalid) return `Error: ${invalid}`;
      if (ctx.proposals.some((p) => p.invoiceId === invoiceId && p.action === action)) {
        return "Already queued for approval.";
      }
      ctx.proposals.push({
        id: randomUUID(),
        action,
        invoiceId,
        subject,
        note,
        reason,
        invoiceNumber: row.number,
        client: row.client,
        amount: `${row.currency} ${row.total.toFixed(2)}`,
      });
      return "Queued. The user will see an approval card; tell them it is waiting for their click.";
    }),
  });

  const forecast = defineTool({
    name: "cashflow_forecast",
    description:
      "Outstanding, overdue and paid totals plus expected income for the next 4 weeks. Overdue invoices are " +
      "assumed to arrive this week; invoices 30+ days late are excluded as at-risk.",
    inputSchema: z.object({
      currency: z.string().regex(/^[A-Z]{3}$/).optional().describe("Defaults to the main currency"),
    }),
    run: safely(async ({ currency }) => {
      const rows = await loadRows(ctx);
      return JSON.stringify(summarizeCashflow(rows, ctx.now, currency ?? primaryCurrency(rows)));
    }),
  });

  return [listInvoices, getInvoice, createDraft, proposeAction, forecast];
}
