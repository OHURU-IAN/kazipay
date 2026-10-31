import { ApiError, GoogleGenAI, type Content, type FunctionCall, type FunctionDeclaration, type Part } from "@google/genai";
import { z } from "zod";
import { AgentProviderError, FALLBACK_REPLY, MAX_TOOL_ROUNDS, SYSTEM_PROMPT, type ChatHistory } from "./prompt";
import type { AgentTool } from "./tools";

// Lite models answer in seconds on the free tier; the larger flash models were 16-60s under load (Oct 2026).
const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const REQUEST_TIMEOUT_MS = 45_000;
// Overloaded (503) or rate-limited (429): worth trying the next model.
const RETRYABLE_STATUSES = new Set([429, 503]);

let client: GoogleGenAI | null = null;

/** GEMINI_MODEL (comma-separated allowed) overrides the default fallback chain. */
export function modelChain(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.GEMINI_MODEL?.split(",").map((m) => m.trim()).filter(Boolean);
  return configured?.length ? configured : DEFAULT_MODELS;
}

/** Converts a tool's Zod schema to the JSON Schema Gemini expects for function parameters. */
export function toFunctionDeclaration(tool: AgentTool): FunctionDeclaration {
  // "input" mode: fields with defaults are optional for the caller, matching how we parse them.
  const schema = { ...(z.toJSONSchema(tool.inputSchema, { io: "input" }) as Record<string, unknown>), $schema: undefined };
  return { name: tool.name, description: tool.description, parametersJsonSchema: JSON.parse(JSON.stringify(schema)) };
}

/** Validates the model's arguments with the tool's schema, runs it, and wraps the result for Gemini. */
export async function executeCall(call: FunctionCall, tools: ReadonlyMap<string, AgentTool>): Promise<Part> {
  const tool = call.name ? tools.get(call.name) : undefined;
  let result: string;
  if (!tool) {
    result = `Error: unknown tool ${call.name ?? ""}`;
  } else {
    const parsed = tool.inputSchema.safeParse(call.args ?? {});
    result = parsed.success
      ? await tool.run(parsed.data)
      : `Error: invalid arguments - ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
  }
  return { functionResponse: { id: call.id, name: call.name, response: { result } } };
}

type GenerateParams = Parameters<GoogleGenAI["models"]["generateContent"]>[0];

/**
 * Calls the first model in the chain that isn't overloaded. Once a model answers,
 * the rest of the conversation sticks to it (thought signatures are model-specific).
 */
async function generateWithFallback(ai: GoogleGenAI, models: string[], params: Omit<GenerateParams, "model">) {
  let lastError: unknown;
  for (const [i, model] of models.entries()) {
    try {
      const response = await ai.models.generateContent({ ...params, model });
      return { response, model };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ApiError && RETRYABLE_STATUSES.has(error.status);
      if (!retryable || i === models.length - 1) throw error;
    }
  }
  throw lastError;
}

export async function runGemini(history: ChatHistory, tools: AgentTool[]): Promise<string> {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const config = {
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: tools.map(toFunctionDeclaration) }],
  };

  let contents: Content[] = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  let models = modelChain();

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { response, model } = await generateWithFallback(client, models, { contents, config });
      models = [model];

      const calls = response.functionCalls ?? [];
      if (calls.length === 0) return response.text?.trim() || FALLBACK_REPLY;

      // The model turn goes back unchanged: it carries thought signatures Gemini needs on the next call.
      const modelTurn = response.candidates?.[0]?.content;
      // Run sequentially: propose_action de-duplicates against earlier calls in the same turn.
      const results: Part[] = [];
      for (const call of calls) results.push(await executeCall(call, byName));

      contents = [...contents, ...(modelTurn ? [modelTurn] : []), { role: "user", parts: results }];
    }
    return "I stopped after several steps without finishing - try asking more specifically.";
  } catch (error) {
    if (error instanceof ApiError) {
      console.error("Gemini API error", error.status, error.message);
      if (RETRYABLE_STATUSES.has(error.status)) {
        throw new AgentProviderError("Google's free AI tier is busy right now - wait a minute and try again.", 429);
      }
      if (error.status === 400 || error.status === 403) {
        throw new AgentProviderError("The Gemini API key or model was rejected - check GEMINI_API_KEY / GEMINI_MODEL.", 503);
      }
      throw new AgentProviderError("The AI service returned an error. Try again.", 502);
    }
    throw error;
  }
}
