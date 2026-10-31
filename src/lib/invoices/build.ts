import { z } from "zod";
import type { InvoiceCreatePayload } from "@/lib/paypal/types";

const MAX_DUE_DAYS = 365;
const MAX_ITEMS = 20;

export const draftInvoiceSchema = z.object({
  recipientEmail: z.email().describe("Client's email address"),
  recipientName: z.string().min(1).max(100).describe("Client contact's full name"),
  businessName: z.string().max(100).optional().describe("Client's company name, if any"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("USD")
    .describe("ISO 4217 currency code, e.g. USD, EUR, GBP"),
  dueInDays: z.number().int().min(0).max(MAX_DUE_DAYS).default(14),
  note: z.string().max(1000).optional().describe("Friendly note shown to the client on the invoice"),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        quantity: z.number().positive().max(10_000).default(1),
        unitPrice: z.number().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(MAX_ITEMS),
});

export type DraftInvoiceInput = z.infer<typeof draftInvoiceSchema>;

/** Formats a date as YYYY-MM-DD in UTC, the format PayPal invoicing expects. */
export function toPayPalDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function splitName(fullName: string): { given_name: string; surname?: string } {
  const parts = fullName.trim().split(/\s+/);
  const [given, ...rest] = parts;
  return rest.length > 0 ? { given_name: given, surname: rest.join(" ") } : { given_name: given };
}

/** Turns validated agent/user input into a PayPal draft-invoice payload. */
export function buildInvoicePayload(input: DraftInvoiceInput, today: Date = new Date()): InvoiceCreatePayload {
  const currency = input.currency;
  return {
    detail: {
      currency_code: currency,
      invoice_date: toPayPalDate(today),
      note: input.note,
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: toPayPalDate(addDays(today, input.dueInDays)),
      },
    },
    primary_recipients: [
      {
        billing_info: {
          name: splitName(input.recipientName),
          business_name: input.businessName,
          email_address: input.recipientEmail,
        },
      },
    ],
    items: input.items.map((item) => ({
      name: item.name,
      description: item.description,
      quantity: String(item.quantity),
      unit_amount: { currency_code: currency, value: item.unitPrice.toFixed(2) },
      unit_of_measure: "QUANTITY",
    })),
  };
}

export function payloadTotal(payload: InvoiceCreatePayload): number {
  return payload.items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unit_amount.value),
    0,
  );
}
