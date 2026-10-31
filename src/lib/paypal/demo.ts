import { addDays, toPayPalDate } from "@/lib/invoices/build";
import type {
  Invoice,
  InvoiceCreatePayload,
  InvoiceGateway,
  InvoiceStatus,
  NotifyPayload,
} from "./types";

const SEND_ALLOWED: ReadonlySet<InvoiceStatus> = new Set(["DRAFT"]);
const REMIND_ALLOWED: ReadonlySet<InvoiceStatus> = new Set(["SENT", "UNPAID", "PARTIALLY_PAID"]);
const CANCEL_ALLOWED: ReadonlySet<InvoiceStatus> = new Set(["SENT", "UNPAID", "PARTIALLY_PAID", "SCHEDULED"]);

interface SeedSpec {
  number: string;
  client: string;
  contact: string;
  email: string;
  item: string;
  amount: number;
  status: InvoiceStatus;
  issuedDaysAgo: number;
  dueInDays: number;
}

const SEED: SeedSpec[] = [
  { number: "KZ-0001", client: "Nordlicht GmbH", contact: "Lena Vogel", email: "lena@nordlicht.example", item: "Landing page redesign", amount: 1200, status: "PAID", issuedDaysAgo: 40, dueInDays: -26 },
  { number: "KZ-0002", client: "Brightside Media", contact: "Tom Okafor", email: "tom@brightside.example", item: "Monthly social media retainer", amount: 450, status: "SENT", issuedDaysAgo: 21, dueInDays: -7 },
  { number: "KZ-0003", client: "Acme Analytics", contact: "Priya Shah", email: "priya@acme.example", item: "Dashboard API integration (20 hrs)", amount: 900, status: "SENT", issuedDaysAgo: 10, dueInDays: 4 },
  { number: "KZ-0004", client: "Lumen Studio", contact: "Carlos Diaz", email: "carlos@lumen.example", item: "Logo & brand kit", amount: 300, status: "SENT", issuedDaysAgo: 50, dueInDays: -36 },
  { number: "KZ-0005", client: "Harbor Coffee Co.", contact: "Amy Chen", email: "amy@harbor.example", item: "Shopify store setup", amount: 650, status: "SENT", issuedDaysAgo: 3, dueInDays: 11 },
  { number: "KZ-0006", client: "Nordlicht GmbH", contact: "Lena Vogel", email: "lena@nordlicht.example", item: "SEO audit", amount: 350, status: "SENT", issuedDaysAgo: 12, dueInDays: 2 },
];

function seedInvoice(spec: SeedSpec, index: number, now: Date): Invoice {
  const [given, ...rest] = spec.contact.split(" ");
  const id = `INV2-DEMO-${String(index + 1).padStart(4, "0")}`;
  const value = spec.amount.toFixed(2);
  return {
    id,
    status: spec.status,
    detail: {
      invoice_number: spec.number,
      currency_code: "USD",
      invoice_date: toPayPalDate(addDays(now, -spec.issuedDaysAgo)),
      payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: toPayPalDate(addDays(now, spec.dueInDays)) },
      metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${id}` },
    },
    primary_recipients: [
      { billing_info: { business_name: spec.client, name: { given_name: given, surname: rest.join(" ") }, email_address: spec.email } },
    ],
    items: [{ name: spec.item, quantity: "1", unit_amount: { currency_code: "USD", value } }],
    amount: { currency_code: "USD", value },
    payments: spec.status === "PAID" ? { paid_amount: { currency_code: "USD", value } } : undefined,
  };
}

export interface DemoEvent {
  at: string;
  type: "send" | "remind" | "cancel" | "create";
  invoiceId: string;
  note?: string;
}

/**
 * In-memory stand-in for PayPal so the app runs with no credentials.
 * Invoices are replaced, never mutated in place.
 */
export class DemoInvoiceStore implements InvoiceGateway {
  readonly mode = "demo" as const;
  private invoices: Invoice[];
  private events: DemoEvent[] = [];
  private counter: number;

  constructor(now: Date = new Date()) {
    this.invoices = SEED.map((spec, i) => seedInvoice(spec, i, now));
    this.counter = this.invoices.length;
  }

  async listInvoices(): Promise<Invoice[]> {
    return [...this.invoices];
  }

  async getInvoice(id: string): Promise<Invoice> {
    const found = this.invoices.find((inv) => inv.id === id);
    if (!found) throw new Error(`Invoice ${id} not found`);
    return found;
  }

  async createDraft(payload: InvoiceCreatePayload): Promise<Invoice> {
    this.counter += 1;
    const id = `INV2-DEMO-${String(this.counter).padStart(4, "0")}`;
    const total = payload.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_amount.value), 0);
    const invoice: Invoice = {
      id,
      status: "DRAFT",
      detail: {
        ...payload.detail,
        invoice_number: `KZ-${String(this.counter).padStart(4, "0")}`,
        metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${id}` },
      },
      primary_recipients: payload.primary_recipients,
      items: payload.items,
      amount: { currency_code: payload.detail.currency_code, value: total.toFixed(2) },
    };
    this.invoices = [invoice, ...this.invoices];
    this.log("create", id);
    return invoice;
  }

  async sendInvoice(id: string, notify: NotifyPayload): Promise<void> {
    await this.transition(id, SEND_ALLOWED, "SENT", "send");
    this.log("send", id, notify.note);
  }

  async remindInvoice(id: string, notify: NotifyPayload): Promise<void> {
    const invoice = await this.getInvoice(id);
    if (!REMIND_ALLOWED.has(invoice.status)) throw new Error(`Cannot remind an invoice in status ${invoice.status}`);
    this.log("remind", id, notify.note);
  }

  async cancelInvoice(id: string, notify: NotifyPayload): Promise<void> {
    await this.transition(id, CANCEL_ALLOWED, "CANCELLED", "cancel");
    this.log("cancel", id, notify.note);
  }

  recentEvents(): DemoEvent[] {
    return [...this.events];
  }

  private async transition(id: string, allowed: ReadonlySet<InvoiceStatus>, next: InvoiceStatus, action: string) {
    const invoice = await this.getInvoice(id);
    if (!allowed.has(invoice.status)) throw new Error(`Cannot ${action} an invoice in status ${invoice.status}`);
    this.invoices = this.invoices.map((inv) => (inv.id === id ? { ...inv, status: next } : inv));
  }

  private log(type: DemoEvent["type"], invoiceId: string, note?: string) {
    this.events = [{ at: new Date().toISOString(), type, invoiceId, note }, ...this.events];
  }
}
