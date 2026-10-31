import { describe, expect, it } from "vitest";
import { buildInvoicePayload, draftInvoiceSchema } from "@/lib/invoices/build";
import { DemoInvoiceStore } from "./demo";

const NOTIFY = { send_to_invoicer: false, send_to_recipient: true };

function draftPayload() {
  return buildInvoicePayload(
    draftInvoiceSchema.parse({
      recipientEmail: "new@client.example",
      recipientName: "New Client",
      items: [{ name: "Consulting", quantity: 2, unitPrice: 150 }],
    }),
  );
}

describe("DemoInvoiceStore", () => {
  it("seeds a mix of paid, open and overdue invoices", async () => {
    const store = new DemoInvoiceStore();
    const invoices = await store.listInvoices();
    expect(invoices.length).toBeGreaterThanOrEqual(5);
    expect(invoices.some((i) => i.status === "PAID")).toBe(true);
  });

  it("creates a draft with a computed total, then sends it", async () => {
    const store = new DemoInvoiceStore();
    const draft = await store.createDraft(draftPayload());
    expect(draft.status).toBe("DRAFT");
    expect(draft.amount?.value).toBe("300.00");

    await store.sendInvoice(draft.id, NOTIFY);
    expect((await store.getInvoice(draft.id)).status).toBe("SENT");
    expect(store.recentEvents().map((e) => e.type)).toEqual(["send", "create"]);
  });

  it("does not mutate invoice objects returned earlier", async () => {
    const store = new DemoInvoiceStore();
    const draft = await store.createDraft(draftPayload());
    await store.sendInvoice(draft.id, NOTIFY);
    expect(draft.status).toBe("DRAFT");
  });

  it("refuses invalid transitions", async () => {
    const store = new DemoInvoiceStore();
    const draft = await store.createDraft(draftPayload());
    await expect(store.remindInvoice(draft.id, NOTIFY)).rejects.toThrow(/Cannot remind/);
    await expect(store.cancelInvoice(draft.id, NOTIFY)).rejects.toThrow(/Cannot cancel/);
    const paid = (await store.listInvoices()).find((i) => i.status === "PAID")!;
    await expect(store.sendInvoice(paid.id, NOTIFY)).rejects.toThrow(/Cannot send/);
  });

  it("cancels an open invoice and logs reminder notes", async () => {
    const store = new DemoInvoiceStore();
    const open = (await store.listInvoices()).find((i) => i.status === "SENT")!;
    await store.remindInvoice(open.id, { ...NOTIFY, note: "Friendly nudge" });
    await store.cancelInvoice(open.id, NOTIFY);
    expect((await store.getInvoice(open.id)).status).toBe("CANCELLED");
    expect(store.recentEvents()[1]).toMatchObject({ type: "remind", note: "Friendly nudge" });
  });

  it("throws for unknown ids", async () => {
    await expect(new DemoInvoiceStore().getInvoice("nope")).rejects.toThrow(/not found/);
  });
});
