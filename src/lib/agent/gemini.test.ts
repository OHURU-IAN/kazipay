import { describe, expect, it } from "vitest";
import { DemoInvoiceStore } from "@/lib/paypal/demo";
import { executeCall, modelChain, toFunctionDeclaration } from "./gemini";
import { buildTools, type ToolContext } from "./tools";

function setup() {
  const ctx: ToolContext = { gateway: new DemoInvoiceStore(), now: new Date(), proposals: [], createdDraftIds: [] };
  const tools = buildTools(ctx);
  return { ctx, tools, byName: new Map(tools.map((t) => [t.name, t])) };
}

describe("toFunctionDeclaration", () => {
  it("emits a JSON schema without $schema and with defaulted fields optional", () => {
    const { tools } = setup();
    const draft = toFunctionDeclaration(tools.find((t) => t.name === "create_draft_invoice")!);
    const schema = draft.parametersJsonSchema as { type: string; required: string[]; $schema?: string; properties: Record<string, unknown> };

    expect(draft.name).toBe("create_draft_invoice");
    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(["recipientEmail", "recipientName", "items"]));
    expect(schema.required).not.toContain("currency");
    expect(schema.properties).toHaveProperty("dueInDays");
  });
});

describe("modelChain", () => {
  it("uses the lite fallback chain by default and honours a comma-separated override", () => {
    expect(modelChain({})).toEqual(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
    expect(modelChain({ GEMINI_MODEL: "gemini-3.8-flash, gemini-3.5-flash" })).toEqual(["gemini-3.8-flash", "gemini-3.5-flash"]);
    expect(modelChain({ GEMINI_MODEL: " , " })).toEqual(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  });
});

describe("executeCall", () => {
  it("runs a tool and wraps the result as a functionResponse with the call id", async () => {
    const { ctx, byName } = setup();
    const part = await executeCall(
      {
        id: "call-1",
        name: "create_draft_invoice",
        args: { recipientEmail: "jo@client.example", recipientName: "Jo", items: [{ name: "Logo", unitPrice: 300 }] },
      },
      byName,
    );

    expect(part.functionResponse?.id).toBe("call-1");
    expect(part.functionResponse?.name).toBe("create_draft_invoice");
    expect(JSON.parse(String(part.functionResponse?.response?.result)).status).toBe("DRAFT");
    expect(ctx.createdDraftIds).toHaveLength(1);
  });

  it("returns validation errors to the model instead of running the tool", async () => {
    const { ctx, byName } = setup();
    const part = await executeCall(
      { name: "create_draft_invoice", args: { recipientEmail: "bad", recipientName: "Jo", items: [] } },
      byName,
    );
    expect(String(part.functionResponse?.response?.result)).toMatch(/^Error: invalid arguments - .*recipientEmail/);
    expect(ctx.createdDraftIds).toHaveLength(0);
  });

  it("reports unknown tools", async () => {
    const { byName } = setup();
    const part = await executeCall({ name: "delete_everything", args: {} }, byName);
    expect(part.functionResponse?.response?.result).toBe("Error: unknown tool delete_everything");
  });
});
