"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";
import { money, safePayPalUrl, shortDate } from "@/lib/format";
import type { InvoiceRow, RiskLevel } from "@/lib/invoices/summary";

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeQuartz.withParams({
  backgroundColor: "#fffdf8",
  foregroundColor: "#1c2a22",
  headerBackgroundColor: "#ece3d1",
  headerTextColor: "#1c2a22",
  borderColor: "#d9cfbb",
  rowHoverColor: "#f5efe3",
  accentColor: "#14532d",
  fontFamily: "var(--font-plex-sans)",
  headerFontWeight: 600,
  fontSize: 13,
  rowHeight: 46,
  wrapperBorderRadius: 16,
});

const RISK_STYLE: Record<RiskLevel, { label: string; className: string }> = {
  paid: { label: "Paid", className: "bg-forest-soft text-forest" },
  on_track: { label: "On track", className: "bg-paper-deep text-ink" },
  due_soon: { label: "Due soon", className: "bg-saffron/20 text-[#8a5a07]" },
  overdue: { label: "Overdue", className: "bg-clay-soft text-clay" },
  at_risk: { label: "At risk", className: "bg-clay text-paper" },
  draft: { label: "Draft", className: "border border-dashed border-ink-soft text-ink-soft" },
  closed: { label: "Closed", className: "bg-line/60 text-ink-soft" },
};

function RiskCell({ data }: ICellRendererParams<InvoiceRow>) {
  if (!data) return null;
  const style = RISK_STYLE[data.risk];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.className}`}>
      {style.label}
      {data.daysOverdue > 0 && <span className="ml-1 opacity-80">· {data.daysOverdue}d</span>}
    </span>
  );
}

interface InvoiceGridProps {
  rows: InvoiceRow[];
  onAsk: (prompt: string) => void;
}

export function InvoiceGrid({ rows, onAsk }: InvoiceGridProps) {
  const columns = useMemo<ColDef<InvoiceRow>[]>(
    () => [
      { field: "number", headerName: "Invoice", width: 110, cellClass: "font-mono" },
      { field: "client", headerName: "Client", flex: 1.4, minWidth: 150 },
      {
        field: "total",
        headerName: "Amount",
        width: 120,
        type: "rightAligned",
        cellClass: "font-mono tabular",
        valueFormatter: (p) => (p.data ? money(p.data.total, p.data.currency) : ""),
      },
      { field: "dueDate", headerName: "Due", width: 95, valueFormatter: (p) => shortDate(p.value ?? null) },
      { field: "risk", headerName: "Status", width: 140, cellRenderer: RiskCell, sort: "desc", comparator: (_a, _b, nodeA, nodeB) => (nodeA.data?.daysOverdue ?? 0) - (nodeB.data?.daysOverdue ?? 0) },
      {
        headerName: "",
        width: 150,
        sortable: false,
        cellRenderer: ({ data }: ICellRendererParams<InvoiceRow>) => {
          if (!data) return null;
          const href = safePayPalUrl(data.payUrl);
          return (
            <div className="flex h-full items-center gap-2">
              {data.daysOverdue > 0 && (
                <button
                  type="button"
                  onClick={() => onAsk(`Draft a payment reminder for ${data.number} (${data.client}).`)}
                  className="rounded-md bg-forest px-2.5 py-1 text-xs font-medium text-paper transition hover:bg-[#0f3f22] focus-visible:outline-2 focus-visible:outline-saffron"
                >
                  Chase
                </button>
              )}
              {href && data.status !== "DRAFT" && (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-sky underline-offset-2 hover:underline">
                  Pay page
                </a>
              )}
            </div>
          );
        },
      },
    ],
    [onAsk],
  );

  return (
    <div className="w-full">
      <AgGridReact<InvoiceRow>
        theme={gridTheme}
        domLayout="autoHeight"
        rowData={rows}
        columnDefs={columns}
        getRowId={(p) => p.data.id}
        defaultColDef={{ sortable: true, resizable: true }}
        animateRows
        overlayNoRowsTemplate="No invoices yet - ask KaziPay to bill a client."
      />
    </div>
  );
}
