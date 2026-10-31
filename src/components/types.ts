import type { Proposal } from "@/lib/agent/proposals";
import type { CashflowSummary, InvoiceRow } from "@/lib/invoices/summary";

export interface InvoicesPayload {
  mode: "sandbox" | "live" | "demo";
  rows: InvoiceRow[];
  summary: CashflowSummary;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  proposals?: Proposal[];
  isError?: boolean;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json?.success || json.data === null) {
    throw new Error(json?.error ?? `Request failed (${res.status})`);
  }
  return json.data;
}
