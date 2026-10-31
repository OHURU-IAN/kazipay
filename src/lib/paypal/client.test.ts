import { describe, expect, it, vi } from "vitest";
import { PayPalClient, PayPalError } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeClient(responses: Response[]) {
  const fetchImpl = vi.fn<typeof fetch>();
  responses.forEach((r) => fetchImpl.mockResolvedValueOnce(r));
  const client = new PayPalClient({ clientId: "id", clientSecret: "secret", env: "sandbox", fetchImpl });
  return { client, fetchImpl };
}

const token = () => jsonResponse({ access_token: "tok", expires_in: 3600 });

describe("PayPalClient", () => {
  it("fetches an OAuth token once and reuses it", async () => {
    const draft = { id: "INV2-1", status: "DRAFT", detail: { currency_code: "USD" } };
    const { client, fetchImpl } = makeClient([token(), jsonResponse({ items: [draft] }), jsonResponse({ items: [] })]);

    expect(await client.listInvoices()).toEqual([draft]);
    await client.listInvoices();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0];
    expect(tokenUrl).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect((tokenInit?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("id:secret").toString("base64")}`,
    );
    const [, listInit] = fetchImpl.mock.calls[1];
    expect((listInit?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("fills in pay-page links for sent invoices, keeping the list item if a lookup fails", async () => {
    const sent = (id: string) => ({ id, status: "SENT", detail: { currency_code: "USD", metadata: {} } });
    const { client, fetchImpl } = makeClient([
      token(),
      jsonResponse({ items: [sent("INV2-A"), sent("INV2-B"), { id: "INV2-C", status: "DRAFT", detail: { currency_code: "USD" } }] }),
      jsonResponse({ ...sent("INV2-A"), detail: { currency_code: "USD", metadata: { recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#A" } } }),
      jsonResponse({ message: "boom" }, 500),
    ]);

    const invoices = await client.listInvoices();

    expect(invoices.map((i) => i.id)).toEqual(["INV2-A", "INV2-B", "INV2-C"]);
    expect(invoices[0].detail.metadata?.recipient_view_url).toBe("https://www.sandbox.paypal.com/invoice/p/#A");
    expect(invoices[1]).toEqual(sent("INV2-B"));
    expect(fetchImpl).toHaveBeenCalledTimes(4); // token, list, 2 detail lookups - none for the draft
  });

  it("creates drafts with return=representation and posts the payload", async () => {
    const { client, fetchImpl } = makeClient([token(), jsonResponse({ id: "INV2-NEW", status: "DRAFT" }, 201)]);
    const payload = { detail: { currency_code: "USD" }, primary_recipients: [], items: [] };

    const created = await client.createDraft(payload);

    expect(created.id).toBe("INV2-NEW");
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v2/invoicing/invoices");
    expect((init?.headers as Record<string, string>).Prefer).toBe("return=representation");
    expect(JSON.parse(init?.body as string)).toEqual(payload);
  });

  it("handles empty 202 bodies on send", async () => {
    const { client, fetchImpl } = makeClient([token(), new Response(null, { status: 202 })]);
    await expect(
      client.sendInvoice("INV2-ABCD-1234", { send_to_invoicer: false, send_to_recipient: true }),
    ).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[1][0]).toBe(
      "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-ABCD-1234/send",
    );
  });

  it("surfaces PayPal error message, detail and debug id", async () => {
    const { client } = makeClient([
      token(),
      jsonResponse(
        { message: "Request is not well-formed", debug_id: "dbg1", details: [{ issue: "MISSING_FIELD", description: "items is required" }] },
        400,
      ),
    ]);
    const err = await client.getInvoice("INV2-X").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({
      message: "Request is not well-formed: items is required",
      status: 400,
      debugId: "dbg1",
    });
  });

  it("rejects invoice ids that could alter the URL path", async () => {
    const { client, fetchImpl } = makeClient([]);
    await expect(client.getInvoice("../v1/oauth2")).rejects.toThrow(/Invalid invoice id/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a clear error when authentication fails", async () => {
    const { client } = makeClient([jsonResponse({ error: "invalid_client" }, 401)]);
    await expect(client.listInvoices()).rejects.toThrow(/authentication failed/);
  });

  it("verifies webhooks only when all signature headers are present", async () => {
    const { client, fetchImpl } = makeClient([token(), jsonResponse({ verification_status: "SUCCESS" })]);
    const headers = new Headers({
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
      "paypal-transmission-id": "t1",
      "paypal-transmission-sig": "sig",
      "paypal-transmission-time": "2026-11-01T00:00:00Z",
    });

    expect(await client.verifyWebhook({ headers, webhookId: "WH-1", event: { id: "E1" } })).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[1][1]?.body as string)).toMatchObject({
      webhook_id: "WH-1",
      transmission_id: "t1",
      webhook_event: { id: "E1" },
    });

    expect(await client.verifyWebhook({ headers: new Headers(), webhookId: "WH-1", event: {} })).toBe(false);
  });
});
