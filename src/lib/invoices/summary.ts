import type { Invoice, InvoiceStatus } from "@/lib/paypal/types";

const DAY_MS = 86_400_000;
const FORECAST_WEEKS = 4;
const RISK_DUE_SOON_DAYS = 3;
const RISK_OVERDUE_LONG_DAYS = 30;

const OPEN_STATUSES: ReadonlySet<InvoiceStatus> = new Set([
  "SENT",
  "UNPAID",
  "PARTIALLY_PAID",
  "PAYMENT_PENDING",
  "SCHEDULED",
]);
const PAID_STATUSES: ReadonlySet<InvoiceStatus> = new Set(["PAID", "MARKED_AS_PAID"]);

export type RiskLevel = "paid" | "on_track" | "due_soon" | "overdue" | "at_risk" | "draft" | "closed";

export interface InvoiceRow {
  id: string;
  number: string;
  client: string;
  email: string;
  status: InvoiceStatus;
  currency: string;
  total: number;
  outstanding: number;
  issueDate: string | null;
  dueDate: string | null;
  daysOverdue: number;
  risk: RiskLevel;
  payUrl: string | null;
}

export interface ForecastWeek {
  label: string;
  startDate: string;
  expected: number;
}

export interface CashflowSummary {
  currency: string;
  outstanding: number;
  overdue: number;
  paidTotal: number;
  overdueCount: number;
  openCount: number;
  weeks: ForecastWeek[];
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function clientName(invoice: Invoice): { name: string; email: string } {
  const info = invoice.primary_recipients?.[0]?.billing_info;
  const person = [info?.name?.given_name, info?.name?.surname].filter(Boolean).join(" ");
  return {
    name: info?.business_name || person || info?.email_address || "Unknown client",
    email: info?.email_address ?? "",
  };
}

function itemsTotal(invoice: Invoice): number {
  return (invoice.items ?? []).reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unit_amount.value),
    0,
  );
}

export function classifyRisk(status: InvoiceStatus, daysOverdue: number, daysUntilDue: number | null): RiskLevel {
  if (PAID_STATUSES.has(status)) return "paid";
  if (status === "DRAFT") return "draft";
  if (!OPEN_STATUSES.has(status)) return "closed";
  if (daysOverdue > RISK_OVERDUE_LONG_DAYS) return "at_risk";
  if (daysOverdue > 0) return "overdue";
  if (daysUntilDue !== null && daysUntilDue <= RISK_DUE_SOON_DAYS) return "due_soon";
  return "on_track";
}

/** Flattens a PayPal invoice into the row shape used by the dashboard and the agent. */
export function toInvoiceRow(invoice: Invoice, now: Date = new Date()): InvoiceRow {
  const today = startOfUtcDay(now);
  const total = Number(invoice.amount?.value ?? itemsTotal(invoice));
  const paid = Number(invoice.payments?.paid_amount?.value ?? 0);
  const isPaid = PAID_STATUSES.has(invoice.status);
  const isOpen = OPEN_STATUSES.has(invoice.status);
  const outstanding = isPaid || !isOpen ? 0 : Number(invoice.due_amount?.value ?? total - paid);

  const due = parseDate(invoice.detail.payment_term?.due_date);
  const daysUntilDue = due ? Math.round((due.getTime() - today.getTime()) / DAY_MS) : null;
  const daysOverdue = isOpen && daysUntilDue !== null && daysUntilDue < 0 ? -daysUntilDue : 0;
  const { name, email } = clientName(invoice);

  return {
    id: invoice.id,
    number: invoice.detail.invoice_number ?? invoice.id,
    client: name,
    email,
    status: invoice.status,
    currency: invoice.amount?.currency_code ?? invoice.detail.currency_code,
    total: round2(total),
    outstanding: round2(outstanding),
    issueDate: invoice.detail.invoice_date ?? null,
    dueDate: invoice.detail.payment_term?.due_date ?? null,
    daysOverdue,
    risk: classifyRisk(invoice.status, daysOverdue, daysUntilDue),
    payUrl: invoice.detail.metadata?.recipient_view_url ?? null,
  };
}

/**
 * Expected inflows per week. Invoices count in the week they fall due; overdue
 * ones are assumed to land this week, at-risk ones (30+ days late) are excluded.
 */
export function summarizeCashflow(rows: readonly InvoiceRow[], now: Date = new Date(), currency = "USD"): CashflowSummary {
  const today = startOfUtcDay(now);
  const inCurrency = rows.filter((r) => r.currency === currency);
  const open = inCurrency.filter((r) => r.outstanding > 0);

  const weeks: ForecastWeek[] = Array.from({ length: FORECAST_WEEKS }, (_, i) => {
    const start = new Date(today.getTime() + i * 7 * DAY_MS);
    return { label: i === 0 ? "This week" : `Week ${i + 1}`, startDate: start.toISOString().slice(0, 10), expected: 0 };
  });

  const forecast = open.reduce((acc, row) => {
    if (row.risk === "at_risk") return acc;
    const due = parseDate(row.dueDate ?? undefined);
    const offsetDays = due ? Math.max(0, Math.floor((due.getTime() - today.getTime()) / DAY_MS)) : 0;
    const index = Math.floor(offsetDays / 7);
    if (index >= FORECAST_WEEKS) return acc;
    return acc.map((w, i) => (i === index ? { ...w, expected: round2(w.expected + row.outstanding) } : w));
  }, weeks);

  const overdueRows = open.filter((r) => r.daysOverdue > 0);
  return {
    currency,
    outstanding: round2(sum(open.map((r) => r.outstanding))),
    overdue: round2(sum(overdueRows.map((r) => r.outstanding))),
    paidTotal: round2(sum(inCurrency.filter((r) => r.risk === "paid").map((r) => r.total))),
    overdueCount: overdueRows.length,
    openCount: open.length,
    weeks: forecast,
  };
}

/** Picks the currency with the most outstanding money, falling back to USD. */
export function primaryCurrency(rows: readonly InvoiceRow[]): string {
  const totals = rows.reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.currency]: (acc[r.currency] ?? 0) + r.total }),
    {},
  );
  const [best] = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  return best?.[0] ?? "USD";
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
