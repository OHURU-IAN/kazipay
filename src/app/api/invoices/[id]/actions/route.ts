import { checkTransition, proposalSchema } from "@/lib/agent/proposals";
import { clientKey, fail, ok, rateLimited } from "@/lib/http";
import { PayPalError } from "@/lib/paypal/client";
import { getGateway } from "@/lib/paypal/gateway";

export const runtime = "nodejs";

const ACTION_LIMIT_PER_WINDOW = 30;

/** Runs an action the user approved in the UI. This is the only path that sends, reminds or cancels. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (rateLimited(`action:${clientKey(req)}`, ACTION_LIMIT_PER_WINDOW)) {
    return fail("Too many actions - please wait a few minutes.", 429);
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = proposalSchema.safeParse({ ...body, invoiceId: id });
  if (!parsed.success) return fail("Invalid action request", 400);

  const { action, subject, note } = parsed.data;
  const gateway = getGateway();
  const notify = { subject, note, send_to_invoicer: true, send_to_recipient: true };

  try {
    const invoice = await gateway.getInvoice(id);
    const invalid = checkTransition(action, invoice.status);
    if (invalid) return fail(invalid, 409);

    if (action === "send") await gateway.sendInvoice(id, notify);
    else if (action === "remind") await gateway.remindInvoice(id, notify);
    else await gateway.cancelInvoice(id, notify);

    return ok({ invoiceId: id, action });
  } catch (error) {
    if (error instanceof PayPalError) return fail(`PayPal: ${error.message}`, error.status >= 500 ? 502 : 400);
    console.error("Invoice action failed", error);
    return fail(error instanceof Error ? error.message : "Action failed", 500);
  }
}
