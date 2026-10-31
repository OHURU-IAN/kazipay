"use client";

import { useState } from "react";
import type { Proposal } from "@/lib/agent/proposals";
import { postJson } from "./types";

const ACTION_LABEL = { send: "Send invoice", remind: "Send reminder", cancel: "Cancel invoice" } as const;

type CardState = { kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "dismissed" } | { kind: "error"; message: string };

interface ProposalCardProps {
  proposal: Proposal;
  onDone: () => void;
}

export function ProposalCard({ proposal, onDone }: ProposalCardProps) {
  const [state, setState] = useState<CardState>({ kind: "idle" });
  const [note, setNote] = useState(proposal.note ?? "");
  const destructive = proposal.action === "cancel";

  async function approve() {
    setState({ kind: "busy" });
    try {
      await postJson(`/api/invoices/${encodeURIComponent(proposal.invoiceId)}/actions`, {
        action: proposal.action,
        subject: proposal.subject,
        note: note.trim() || undefined,
      });
      setState({ kind: "done" });
      onDone();
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Failed" });
    }
  }

  if (state.kind === "dismissed") return null;

  return (
    <article className="rise mt-2 rounded-xl border border-line bg-card p-3.5 shadow-[0_4px_14px_-8px_rgb(28_42_34/0.35)]">
      <header className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {ACTION_LABEL[proposal.action]} · <span className="font-mono">{proposal.invoiceNumber}</span>
        </h4>
        <span className="font-mono tabular text-xs text-ink-soft">{proposal.amount}</span>
      </header>
      <p className="mt-0.5 text-xs text-ink-soft">
        {proposal.client} - {proposal.reason}
      </p>

      {proposal.action !== "cancel" && (
        <label className="mt-2 block">
          <span className="sr-only">Message to client</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={state.kind !== "idle" && state.kind !== "error"}
            rows={note.length > 160 ? 5 : 3}
            placeholder="Optional message to the client"
            className="w-full resize-y rounded-lg border border-line bg-paper/60 p-2 text-sm leading-snug focus:border-forest focus:outline-none"
          />
        </label>
      )}

      {state.kind === "done" ? (
        <p className="mt-2 text-sm font-medium text-forest">✓ Done via PayPal</p>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={approve}
            disabled={state.kind === "busy"}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium text-paper transition active:scale-[0.98] disabled:opacity-60 ${
              destructive ? "bg-clay hover:bg-[#963a22]" : "bg-forest hover:bg-[#0f3f22]"
            }`}
          >
            {state.kind === "busy" ? "Working…" : `Approve - ${ACTION_LABEL[proposal.action].toLowerCase()}`}
          </button>
          <button
            type="button"
            onClick={() => setState({ kind: "dismissed" })}
            className="rounded-lg px-2.5 py-1.5 text-sm text-ink-soft hover:bg-paper-deep"
          >
            Dismiss
          </button>
        </div>
      )}
      {state.kind === "error" && <p className="mt-1.5 text-xs text-clay">{state.message}</p>}
    </article>
  );
}
