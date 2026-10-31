"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AgentResult } from "@/lib/agent/prompt";
import { ProposalCard } from "./ProposalCard";
import { RichText } from "./RichText";
import { postJson, type ChatMessage } from "./types";

const MAX_SENT_MESSAGES = 20;

const STARTERS = [
  "Who owes me money right now?",
  "Bill Priya at priya@acme.example $450 for 10 hours of API work, due in 7 days",
  "Chase everyone who is overdue",
  "What will I get paid over the next month?",
];

interface ChatPanelProps {
  pendingPrompt: string | null;
  onPromptConsumed: () => void;
  onInvoicesChanged: () => void;
}

export function ChatPanel({ pendingPrompt, onPromptConsumed, onInvoicesChanged }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);

    // Only plain text goes back to the server; errors and cards stay client-side.
    const history = next
      .filter((m) => !m.isError)
      .slice(-MAX_SENT_MESSAGES)
      .map(({ role, content: c }) => ({ role, content: c }));
    while (history.length > 0 && history[0].role !== "user") history.shift();

    try {
      const result = await postJson<AgentResult>("/api/chat", { messages: history });
      setMessages((prev) => [...prev, { role: "assistant", content: result.reply, proposals: result.proposals }]);
      if (result.createdDraftIds.length > 0) onInvoicesChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong";
      setMessages((prev) => [...prev, { role: "assistant", content: message, isError: true }]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (pendingPrompt) {
      onPromptConsumed();
      void send(pendingPrompt);
    }
    // send is intentionally excluded: we only react to a new prompt arriving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <section aria-label="KaziPay assistant" className="flex h-full min-h-[560px] flex-col rounded-2xl border border-line bg-card">
      <header className="border-b border-line px-5 py-4">
        <h2 className="font-display text-xl">Ask KaziPay</h2>
        <p className="text-xs text-ink-soft">Bill, chase and forecast in plain words. Nothing is sent until you approve it.</p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                className="block w-full rounded-xl border border-dashed border-line px-3 py-2 text-left text-sm text-ink-soft transition hover:border-forest hover:bg-forest-soft/50 hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div
              className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "rounded-br-sm bg-forest text-paper"
                  : m.isError
                    ? "bg-clay-soft text-clay"
                    : "rounded-bl-sm bg-paper-deep/70"
              }`}
            >
              {m.role === "assistant" && !m.isError ? <RichText text={m.content} /> : m.content}
            </div>
            {m.proposals?.map((p) => <ProposalCard key={p.id} proposal={p} onDone={onInvoicesChanged} />)}
          </div>
        ))}

        {busy && (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <span className="inline-block size-2 animate-pulse rounded-full bg-saffron" /> Checking your PayPal invoices…
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 border-t border-line p-3">
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <input
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          placeholder="e.g. Bill Lumen Studio $300 for the logo"
          className="min-w-0 flex-1 rounded-xl border border-line bg-paper/60 px-3.5 py-2.5 text-sm focus:border-forest focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-xl bg-saffron px-4 py-2.5 text-sm font-semibold text-ink transition hover:brightness-95 active:scale-[0.98] disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}
