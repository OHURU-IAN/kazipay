import { primaryCurrency, summarizeCashflow, toInvoiceRow } from "@/lib/invoices/summary";
import { fail, ok } from "@/lib/http";
import { PayPalError } from "@/lib/paypal/client";
import { getGateway } from "@/lib/paypal/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gateway = getGateway();
  try {
    const now = new Date();
    const rows = (await gateway.listInvoices()).map((inv) => toInvoiceRow(inv, now));
    const summary = summarizeCashflow(rows, now, primaryCurrency(rows));
    return ok({ mode: gateway.mode, rows, summary });
  } catch (error) {
    if (error instanceof PayPalError) return fail(`PayPal: ${error.message}`, 502);
    console.error("Listing invoices failed", error);
    return fail("Could not load invoices", 500);
  }
}
