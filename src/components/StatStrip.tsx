import { money } from "@/lib/format";
import type { CashflowSummary } from "@/lib/invoices/summary";

interface StatStripProps {
  summary: CashflowSummary;
}

export function StatStrip({ summary }: StatStripProps) {
  const max = Math.max(...summary.weeks.map((w) => w.expected), 1);
  const c = summary.currency;

  return (
    <section aria-label="Cash flow summary" className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-[1.4fr_1fr_1.6fr]">
      <div className="rise rounded-2xl bg-forest p-6 text-paper shadow-[0_10px_30px_-12px_rgb(20_83_45/0.6)]">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-paper/70">Owed to you</p>
        <p className="font-display tabular mt-2 text-5xl leading-none">{money(summary.outstanding, c)}</p>
        <p className="mt-3 text-sm text-paper/80">
          across {summary.openCount} open invoice{summary.openCount === 1 ? "" : "s"} · {money(summary.paidTotal, c)} collected
        </p>
      </div>

      <div
        className="rise rounded-2xl border border-clay/30 bg-clay-soft p-6"
        style={{ animationDelay: "60ms" }}
      >
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-clay">Overdue</p>
        <p className="font-display tabular mt-2 text-4xl leading-none text-clay">{money(summary.overdue, c)}</p>
        <p className="mt-3 text-sm text-ink-soft">
          {summary.overdueCount === 0 ? "Nobody is late. Nice." : `${summary.overdueCount} client${summary.overdueCount === 1 ? "" : "s"} past due`}
        </p>
      </div>

      <div className="rise rounded-2xl border border-line bg-card p-6 sm:col-span-2 2xl:col-span-1" style={{ animationDelay: "120ms" }}>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-soft">Expected next 4 weeks</p>
        <ol className="mt-4 flex h-24 items-end gap-3">
          {summary.weeks.map((w, i) => (
            <li key={w.startDate} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="font-mono tabular text-[11px] text-ink-soft">{w.expected > 0 ? money(w.expected, c) : "-"}</span>
              <span
                className={`w-full rounded-t-md ${i === 0 ? "bg-saffron" : "bg-forest/70"}`}
                style={{ height: `${Math.max(4, (w.expected / max) * 56)}px` }}
              />
              <span className="text-[11px] text-ink-soft">{w.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
