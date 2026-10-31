import { fail, ok } from "@/lib/http";
import { getPayPalClient } from "@/lib/paypal/gateway";

export const runtime = "nodejs";

const HANDLED_EVENTS = new Set([
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.REFUNDED",
]);

/**
 * PayPal webhook receiver. Signature is verified with PayPal before anything is trusted.
 * The dashboard reads invoice state live from PayPal, so this only records the event.
 */
export async function POST(req: Request) {
  const client = getPayPalClient();
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!client || !webhookId) return fail("Webhooks are not configured", 503);

  const event = await req.json().catch(() => null);
  if (!event || typeof event !== "object") return fail("Invalid payload", 400);

  const verified = await client.verifyWebhook({ headers: req.headers, webhookId, event }).catch(() => false);
  if (!verified) return fail("Signature verification failed", 401);

  const { event_type: type, resource } = event as { event_type?: string; resource?: { invoice?: { id?: string } } };
  if (type && HANDLED_EVENTS.has(type)) {
    console.info("PayPal webhook", type, resource?.invoice?.id ?? "");
  }
  return ok({ received: true });
}
