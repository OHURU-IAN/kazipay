import "server-only";
import { PayPalClient } from "./client";
import { DemoInvoiceStore } from "./demo";
import type { InvoiceGateway } from "./types";

// Module-level singletons survive across requests within one server process.
let gateway: InvoiceGateway | null = null;

/**
 * Returns the PayPal sandbox/live client when credentials are configured,
 * otherwise an in-memory demo store so the app still runs end to end.
 */
export function getGateway(): InvoiceGateway {
  if (gateway) return gateway;

  // Trim: keys pasted into hosting dashboards often pick up a stray space or newline.
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  const env = process.env.PAYPAL_ENV?.trim() === "live" ? "live" : "sandbox";

  // KAZIPAY_DEMO=1 forces sample data even when PayPal keys are present (screenshots, offline demos).
  const forceDemo = process.env.KAZIPAY_DEMO?.trim() === "1";
  gateway =
    clientId && clientSecret && !forceDemo ? new PayPalClient({ clientId, clientSecret, env }) : new DemoInvoiceStore();
  return gateway;
}

export function getPayPalClient(): PayPalClient | null {
  const g = getGateway();
  return g instanceof PayPalClient ? g : null;
}
