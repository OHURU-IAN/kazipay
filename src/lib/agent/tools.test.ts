import { describe, expect, it } from "vitest";
import { DemoInvoiceStore } from "@/lib/paypal/demo";
import { buildTools, type ToolContext } from "./tools";

function setup() {
  const ctx: ToolContext = { gateway: new DemoInvoiceStore(), now: new Date(), proposals: [], createdDraftIds: [] };
  const tools = Object.fromEntries(buildTools(ctx).map((t) => [t.name, t]));
  // run() receives validated input; parse here the same way the provider adapters do.
  const call = async (name: string, input: unknown) => {
    const tool = tools[name];
    return tool.run(tool.inputSchema.parse(input));
  };
  return { ctx, call };
}

describe("agent tools", () => {
  it("lists only overdue invoices when filtered", async () => {
    const { call } = setup();
    const rows = JSON.parse(await call("list_invoices", { filter: "overdue" }));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: { daysOverdue: number }) => r.daysOverdue > 0)).toBe(true);
    expect(rows[0]).not.toHaveProperty("payUrl");
  });

  it("creates a draft and records its id", async () => {
    const { ctx, call } = setup();
    const row = JSON.parse(
      await call("create_draft_invoice", {
        recipientEmail: "jo@client.example",
        recipientName: "Jo Client",
        items: [{ name: "Logo", unitPrice: 300 }],
      }),
    );
    expect(row.status).toBe("DRAFT");
    expect(ctx.createdDraftIds).toEqual([row.id]);
  });

  it("queues a send proposal for a draft but never sends it", async () => {
    const { ctx, call } = setup();
    const draft = JSON.parse(
      await call("create_draft_invoice", {
        recipientEmail: "jo@client.example",
        recipientName: "Jo Client",
        items: [{ name: "Logo", unitPrice: 300 }],
      }),
    );

    const result = await call("propose_action", { action: "send", invoiceId: draft.id, reason: "New invoice" });

    expect(result).toMatch(/Queued/);
    expect(ctx.proposals).toHaveLength(1);
    expect(ctx.proposals[0]).toMatchObject({ action: "send", amount: "USD 300.00", client: "Jo Client" });
    expect((await ctx.gateway.getInvoice(draft.id)).status).toBe("DRAFT");
  });

  it("rejects invalid transitions and duplicate proposals", async () => {
    const { ctx, call } = setup();
    const paid = (await ctx.gateway.listInvoices()).find((i) => i.status === "PAID")!;
    expect(await call("propose_action", { action: "remind", invoiceId: paid.id, reason: "x" })).toMatch(/^Error: Cannot remind/);

    const open = (await ctx.gateway.listInvoices()).find((i) => i.status === "SENT")!;
    await call("propose_action", { action: "remind", invoiceId: open.id, reason: "late" });
    expect(await call("propose_action", { action: "remind", invoiceId: open.id, reason: "late" })).toMatch(/Already queued/);
    expect(ctx.proposals).toHaveLength(1);
  });

  it("returns tool errors as text instead of throwing", async () => {
    const { call } = setup();
    expect(await call("get_invoice", { invoiceId: "missing" })).toMatch(/^Error: .*not found/);
  });

  it("forecasts cash flow in the main currency", async () => {
    const { call } = setup();
    const summary = JSON.parse(await call("cashflow_forecast", {}));
    expect(summary.currency).toBe("USD");
    expect(summary.weeks).toHaveLength(4);
    expect(summary.overdueCount).toBeGreaterThan(0);
  });
});
