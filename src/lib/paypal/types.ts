// Subset of the PayPal Invoicing v2 schema that KaziPay reads and writes.
// Reference: https://developer.paypal.com/docs/api/invoicing/v2/

export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "SCHEDULED"
  | "PAID"
  | "MARKED_AS_PAID"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_PAID"
  | "PARTIALLY_REFUNDED"
  | "MARKED_AS_REFUNDED"
  | "UNPAID"
  | "PAYMENT_PENDING";

export interface Money {
  currency_code: string;
  value: string;
}

export interface InvoiceItem {
  name: string;
  description?: string;
  quantity: string;
  unit_amount: Money;
  unit_of_measure?: "QUANTITY" | "HOURS" | "AMOUNT";
}

export interface RecipientInfo {
  billing_info: {
    name?: { given_name?: string; surname?: string };
    business_name?: string;
    email_address: string;
  };
}

export interface InvoiceDetail {
  invoice_number?: string;
  invoice_date?: string;
  currency_code: string;
  note?: string;
  memo?: string;
  payment_term?: { term_type?: string; due_date?: string };
  metadata?: {
    create_time?: string;
    recipient_view_url?: string;
    invoicer_view_url?: string;
  };
}

export interface Invoice {
  id: string;
  status: InvoiceStatus;
  detail: InvoiceDetail;
  primary_recipients?: RecipientInfo[];
  items?: InvoiceItem[];
  amount?: Money;
  due_amount?: Money;
  payments?: { paid_amount?: Money };
}

/** Payload for POST /v2/invoicing/invoices (draft creation). */
export interface InvoiceCreatePayload {
  detail: InvoiceDetail;
  primary_recipients: RecipientInfo[];
  items: InvoiceItem[];
}

export interface NotifyPayload {
  subject?: string;
  note?: string;
  send_to_invoicer: boolean;
  send_to_recipient: boolean;
}

/** The operations KaziPay needs from PayPal; implemented by the HTTP client and the demo store. */
export interface InvoiceGateway {
  readonly mode: "sandbox" | "live" | "demo";
  listInvoices(): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice>;
  createDraft(payload: InvoiceCreatePayload): Promise<Invoice>;
  sendInvoice(id: string, notify: NotifyPayload): Promise<void>;
  remindInvoice(id: string, notify: NotifyPayload): Promise<void>;
  cancelInvoice(id: string, notify: NotifyPayload): Promise<void>;
}
