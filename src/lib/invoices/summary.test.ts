import { describe, expect, it } from "vitest";
import type { Invoice } from "@/lib/paypal/types";
import { classifyRisk, primaryCurrency, summarizeCashflow, toInvoiceRow } from "./summary";

const NOW = new Date("2026-11-01T12:00:00Z");

function invoice(overrides: Partial<Invoice> & { due?: string; value?: string }): Invoice {
  const { due, value = "100.00", ...rest } = overrides;
  return {
    id: "INV2-TEST-0001",
    status: "SENT",
    detail: { currency_code: "USD", invoice_number: "KZ-1", payment_term: { due_date: due } },
    primary_recipients: [
      { billing_info: { name: { given_name: "Tom", surname: "Okafor" }, email_address: "tom@x.com" } },
    ],
    amount: { currency_code: "USD", value },
    ...rest,
  };
}

describe("classifyRisk", () => {
  it.each([
    ["PAID", 0, null, "paid"],
    ["DRAFT", 0, 10, "draft"],
    ["CANCELLED", 0, 10, "closed"],
    ["SENT", 31, -31, "at_risk"],
    ["SENT", 5, -5, "overdue"],
    ["SENT", 0, 3, "due_soon"],
    ["SENT", 0, 10, "on_track"],
  ] as const)("%s overdue=%d untilDue=%s → %s", (status, overdue, untilDue, expected) => {
    expect(classifyRisk(status, overdue, untilDue)).toBe(expected);
  });
});

describe("toInvoiceRow", () => {
  it("computes days overdue and outstanding for a late sent invoice", () => {
    const row = toInvoiceRow(invoice({ due: "2026-10-25", value: "450.00" }), NOW);
    expect(row).toMatchObject({
      client: "Tom Okafor",
      email: "tom@x.com",
      total: 450,
      outstanding: 450,
      daysOverdue: 7,
      risk: "overdue",
    });
  });

  it("prefers business name and treats paid invoices as zero outstanding", () => {
    const row = toInvoiceRow(
      invoice({
        status: "PAID",
        due: "2026-10-01",
        primary_recipients: [{ billing_info: { business_name: "Acme", email_address: "a@acme.com" } }],
      }),
      NOW,
    );
    expect(row.client).toBe("Acme");
    expect(row.outstanding).toBe(0);
    expect(row.daysOverdue).toBe(0);
    expect(row.risk).toBe("paid");
  });

  it("uses due_amount for partially paid invoices", () => {
    const row = toInvoiceRow(
      invoice({ status: "PARTIALLY_PAID", due: "2026-11-20", due_amount: { currency_code: "USD", value: "40.00" } }),
      NOW,
    );
    expect(row.outstanding).toBe(40);
    expect(row.risk).toBe("on_track");
  });

  it("falls back to summing items when amount is missing", () => {
    const row = toInvoiceRow(
      invoice({
        amount: undefined,
        due: "2026-11-20",
        items: [{ name: "a", quantity: "2", unit_amount: { currency_code: "USD", value: "25.50" } }],
      }),
      NOW,
    );
    expect(row.total).toBe(51);
  });
});

describe("summarizeCashflow", () => {
  it("buckets open invoices by due week, puts overdue in this week and skips at-risk", () => {
    const rows = [
      toInvoiceRow(invoice({ id: "A", due: "2026-10-28", value: "100.00" }), NOW), // overdue → this week
      toInvoiceRow(invoice({ id: "B", due: "2026-11-10", value: "200.00" }), NOW), // 9 days → week 2
      toInvoiceRow(invoice({ id: "C", due: "2026-09-01", value: "999.00" }), NOW), // at risk → excluded
      toInvoiceRow(invoice({ id: "D", status: "PAID", due: "2026-10-01", value: "50.00" }), NOW),
      toInvoiceRow(invoice({ id: "E", due: "2027-03-01", value: "70.00" }), NOW), // beyond horizon
    ];

    const summary = summarizeCashflow(rows, NOW, "USD");

    expect(summary.weeks.map((w) => w.expected)).toEqual([100, 200, 0, 0]);
    expect(summary.outstanding).toBe(1369);
    expect(summary.overdue).toBe(1099);
    expect(summary.overdueCount).toBe(2);
    expect(summary.paidTotal).toBe(50);
    expect(summary.weeks[0].label).toBe("This week");
  });

  it("ignores rows in other currencies", () => {
    const eur = toInvoiceRow(
      invoice({ due: "2026-11-05", amount: { currency_code: "EUR", value: "500.00" } }),
      NOW,
    );
    expect(summarizeCashflow([eur], NOW, "USD").outstanding).toBe(0);
  });
});

describe("primaryCurrency", () => {
  it("returns the currency with the largest total, or USD when empty", () => {
    const usd = toInvoiceRow(invoice({ due: "2026-11-05", value: "10.00" }), NOW);
    const eur = toInvoiceRow(invoice({ due: "2026-11-05", amount: { currency_code: "EUR", value: "90.00" } }), NOW);
    expect(primaryCurrency([usd, eur])).toBe("EUR");
    expect(primaryCurrency([])).toBe("USD");
  });
});
