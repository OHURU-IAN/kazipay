import type {
  Invoice,
  InvoiceCreatePayload,
  InvoiceGateway,
  NotifyPayload,
} from "./types";

const BASE_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

// Refresh the OAuth token this long before PayPal says it expires.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const LIST_PAGE_SIZE = 100;
// Detail lookups per list call, to stay well inside PayPal rate limits.
const MAX_DETAIL_LOOKUPS = 25;

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  env: "sandbox" | "live";
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

/** Thin, typed client over the PayPal REST APIs used by KaziPay. */
export class PayPalClient implements InvoiceGateway {
  readonly mode: "sandbox" | "live";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token: CachedToken | null = null;

  constructor(private readonly config: PayPalConfig) {
    this.mode = config.env;
    this.baseUrl = BASE_URLS[config.env];
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async listInvoices(): Promise<Invoice[]> {
    const data = await this.request<{ items?: Invoice[] }>(
      "GET",
      `/v2/invoicing/invoices?page=1&page_size=${LIST_PAGE_SIZE}&total_required=true&fields=amount`,
    );
    return this.withPayLinks(data.items ?? []);
  }

  /**
   * The list endpoint omits metadata.recipient_view_url (the client's pay page),
   * so fetch details for the most recent sent invoices. A failed lookup keeps the list item.
   */
  private async withPayLinks(items: Invoice[]): Promise<Invoice[]> {
    const needsLink = new Set(
      items
        .filter((inv) => inv.status !== "DRAFT" && !inv.detail.metadata?.recipient_view_url)
        .slice(0, MAX_DETAIL_LOOKUPS)
        .map((inv) => inv.id),
    );
    return Promise.all(
      items.map((inv) =>
        needsLink.has(inv.id) ? this.getInvoice(inv.id).catch(() => inv) : Promise.resolve(inv),
      ),
    );
  }

  async getInvoice(id: string): Promise<Invoice> {
    return this.request<Invoice>("GET", `/v2/invoicing/invoices/${encodeId(id)}`);
  }

  async createDraft(payload: InvoiceCreatePayload): Promise<Invoice> {
    return this.request<Invoice>("POST", "/v2/invoicing/invoices", payload, {
      Prefer: "return=representation",
    });
  }

  async sendInvoice(id: string, notify: NotifyPayload): Promise<void> {
    await this.request("POST", `/v2/invoicing/invoices/${encodeId(id)}/send`, notify);
  }

  async remindInvoice(id: string, notify: NotifyPayload): Promise<void> {
    await this.request("POST", `/v2/invoicing/invoices/${encodeId(id)}/remind`, notify);
  }

  async cancelInvoice(id: string, notify: NotifyPayload): Promise<void> {
    await this.request("POST", `/v2/invoicing/invoices/${encodeId(id)}/cancel`, notify);
  }

  /** Verifies a webhook delivery with PayPal. Returns true only on SUCCESS. */
  async verifyWebhook(params: {
    headers: Headers;
    webhookId: string;
    event: unknown;
  }): Promise<boolean> {
    const h = params.headers;
    const body = {
      auth_algo: h.get("paypal-auth-algo"),
      cert_url: h.get("paypal-cert-url"),
      transmission_id: h.get("paypal-transmission-id"),
      transmission_sig: h.get("paypal-transmission-sig"),
      transmission_time: h.get("paypal-transmission-time"),
      webhook_id: params.webhookId,
      webhook_event: params.event,
    };
    if (Object.values(body).some((v) => v === null)) return false;
    const result = await this.request<{ verification_status?: string }>(
      "POST",
      "/v1/notifications/verify-webhook-signature",
      body,
    );
    return result.verification_status === "SUCCESS";
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;

    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      "base64",
    );
    const res = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new PayPalError("PayPal authentication failed - check your client ID and secret", res.status);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
    return this.token.value;
  }

  private async request<T = unknown>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    const data = text ? safeJson(text) : {};
    if (!res.ok) {
      const err = data as { message?: string; debug_id?: string; details?: { issue?: string; description?: string }[] };
      const detail = err.details?.[0]?.description ?? err.details?.[0]?.issue;
      throw new PayPalError(
        [err.message ?? `PayPal request failed (${res.status})`, detail].filter(Boolean).join(": "),
        res.status,
        err.debug_id,
      );
    }
    return data as T;
  }
}

function encodeId(id: string): string {
  if (!/^[A-Z0-9-]+$/i.test(id)) throw new PayPalError(`Invalid invoice id: ${id}`, 400);
  return encodeURIComponent(id);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}
