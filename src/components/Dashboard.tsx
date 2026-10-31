"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { InvoiceGrid } from "./InvoiceGrid";
import { StatStrip } from "./StatStrip";
import type { ApiEnvelope, InvoicesPayload } from "./types";

const MODE_BADGE = {
  demo: { label: "Demo data", className: "bg-saffron/25 text-[#7a4f05]" },
  sandbox: { label: "PayPal Sandbox", className: "bg-sky/15 text-sky" },
  live: { label: "PayPal Live", className: "bg-forest text-paper" },
} as const;

export function Dashboard() {
  const [data, setData] = useState<InvoicesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/invoices", { cache: "no-store" });
      const json = (await res.json()) as ApiEnvelope<InvoicesPayload>;
      if (!json.success || !json.data) throw new Error(json.error ?? "Could not load invoices");
      setData(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load invoices");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ask = useCallback((prompt: string) => setPendingPrompt(prompt), []);
  const consumePrompt = useCallback(() => setPendingPrompt(null), []);

  const badge = data ? MODE_BADGE[data.mode] : null;

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 md:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-ink-soft">Kazi · Swahili for work</p>
          <h1 className="font-display text-5xl leading-[0.95] md:text-6xl">
            Kazi<span className="text-forest">Pay</span>
          </h1>
          <p className="mt-2 max-w-md text-sm text-ink-soft">
            Your AI billing desk. Bill clients through PayPal, chase late payers, and see what&apos;s coming in.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {badge && <span className={`rounded-full px-3 py-1 text-xs font-medium ${badge.className}`}>{badge.label}</span>}
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-full border border-line bg-card px-3 py-1 text-xs hover:border-forest"
          >
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-6 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
          {error}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          {data ? <StatStrip summary={data.summary} /> : <div className="h-40 animate-pulse rounded-2xl bg-paper-deep" />}
          <section aria-label="Invoices">
            <h2 className="mb-3 font-display text-2xl">Invoices</h2>
            <InvoiceGrid rows={data?.rows ?? []} onAsk={ask} />
          </section>
        </div>
        <div className="h-[640px] xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)]">
          <ChatPanel pendingPrompt={pendingPrompt} onPromptConsumed={consumePrompt} onInvoicesChanged={() => void refresh()} />
        </div>
      </div>

      <footer className="mt-12 text-xs text-ink-soft">
        Built with the PayPal Invoicing API, Google Gemini (or Claude), and AG Grid · PayPal AI Hackathon 2026
      </footer>
    </main>
  );
}
