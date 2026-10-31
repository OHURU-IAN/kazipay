import { describe, expect, it } from "vitest";
import { buildInvoicePayload, draftInvoiceSchema, payloadTotal } from "./build";

const TODAY = new Date("2026-11-01T09:00:00Z");

describe("draftInvoiceSchema", () => {
  it("applies defaults for currency, due days and quantity", () => {
    const parsed = draftInvoiceSchema.parse({
      recipientEmail: "tom@example.com",
      recipientName: "Tom Okafor",
      items: [{ name: "Logo", unitPrice: 300 }],
    });
    expect(parsed.currency).toBe("USD");
    expect(parsed.dueInDays).toBe(14);
    expect(parsed.items[0].quantity).toBe(1);
  });

  it("rejects an invalid email and an empty item list", () => {
    expect(() =>
      draftInvoiceSchema.parse({ recipientEmail: "nope", recipientName: "X", items: [] }),
    ).toThrow();
  });

  it("rejects lowercase or non-ISO currency codes", () => {
    expect(() =>
      draftInvoiceSchema.parse({
        recipientEmail: "a@b.com",
        recipientName: "A",
        currency: "usd",
        items: [{ name: "x", unitPrice: 1 }],
      }),
    ).toThrow();
  });
});

describe("buildInvoicePayload", () => {
  it("maps input to a PayPal draft with due date, split name and 2dp amounts", () => {
    const input = draftInvoiceSchema.parse({
      recipientEmail: "priya@acme.example",
      recipientName: "Priya Raj Shah",
      businessName: "Acme Analytics",
      currency: "EUR",
      dueInDays: 7,
      note: "Thanks!",
      items: [{ name: "API work", quantity: 20, unitPrice: 45 }],
    });

    const payload = buildInvoicePayload(input, TODAY);

    expect(payload.detail).toMatchObject({
      currency_code: "EUR",
      invoice_date: "2026-11-01",
      note: "Thanks!",
      payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: "2026-11-08" },
    });
    expect(payload.primary_recipients[0].billing_info).toEqual({
      name: { given_name: "Priya", surname: "Raj Shah" },
      business_name: "Acme Analytics",
      email_address: "priya@acme.example",
    });
    expect(payload.items[0]).toMatchObject({
      quantity: "20",
      unit_amount: { currency_code: "EUR", value: "45.00" },
    });
    expect(payloadTotal(payload)).toBe(900);
  });

  it("omits surname for single-word names", () => {
    const input = draftInvoiceSchema.parse({
      recipientEmail: "a@b.com",
      recipientName: "Madonna",
      items: [{ name: "x", unitPrice: 10 }],
    });
    expect(buildInvoicePayload(input, TODAY).primary_recipients[0].billing_info.name).toEqual({
      given_name: "Madonna",
    });
  });
});
