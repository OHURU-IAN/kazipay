# KaziPay - an AI billing agent for freelancers

*Kazi* is Swahili for **work**. KaziPay lets freelancers bill clients, chase late payments and forecast cash flow by chatting, on top of **PayPal Invoicing** and an AI agent (**Google Gemini** on the free tier, or **Claude**).

> "Bill Priya at priya@acme.example $450 for 10 hours of API work, due in 7 days"
> → a real PayPal draft invoice appears, plus a one-click **Approve - send invoice** card.

## The problem

Millions of freelancers outside the US and Europe, in Kenya, Nigeria, the Philippines and elsewhere, are paid by international clients through PayPal. Most of them have no accountant or finance tool. Invoicing is manual, chasing late payers is awkward, and nobody knows what money is coming next month. Late payment is the top cash-flow problem for independent workers.

## What it does

| | |
|---|---|
| **Bill by chat** | Describe the job in plain words. The agent builds a valid PayPal invoice (line items, currency, due date, note) as a **draft**. |
| **Human in the loop** | The agent can never send, remind or cancel on its own. It *proposes* each action, and you approve it with one click (and can edit the message first). |
| **Smart chasing** | "Chase everyone who is overdue" makes the agent read your invoices and write a reminder for each late client, with the tone matched to how late they are. |
| **Cash-flow forecast** | Outstanding, overdue and expected income for the next 4 weeks. Invoices 30+ days late are flagged *at risk* and left out of the forecast. |
| **AG Grid ledger** | Every invoice with a status/risk badge, a **Chase** button for late ones, and a link to the PayPal pay page. |
| **Webhooks** | `/api/webhooks/paypal` verifies PayPal's signature before trusting `INVOICING.INVOICE.PAID` events. |

## How PayPal and AI are used

**PayPal (Invoicing v2 REST API, Sandbox)**
- `POST /v1/oauth2/token`: client-credentials auth, with the token cached.
- `POST /v2/invoicing/invoices`: create drafts.
- `GET /v2/invoicing/invoices`: list invoices for the dashboard and the agent.
- `POST /v2/invoicing/invoices/{id}/send | remind | cancel`: run actions only after the user approves them.
- `POST /v1/notifications/verify-webhook-signature`: verify webhooks.

**AI: function-calling agent, with a choice of provider (`AI_PROVIDER`)**
- **Google Gemini** (default, free tier) via `@google/genai`: a manual function-calling loop. It uses `gemini-3.5-flash-lite` and automatically falls back to `gemini-3.1-flash-lite` when Google returns "overloaded".
- **Claude** (`claude-opus-5-5`) via the Anthropic SDK tool runner, with server-side refusal fallbacks enabled.

Both providers share the same five tools: `list_invoices`, `get_invoice`, `create_draft_invoice`, `propose_action` and `cashflow_forecast`. Each tool is defined once with a Zod schema, which becomes the tool definition for both providers, and every model-supplied argument is validated before it runs, so the model can't build a malformed invoice. Actions are checked against the invoice's status (for example, a PAID invoice can't be reminded) both when proposed and again when approved.

## Architecture

```
Browser (Next.js 15, React 19, Tailwind, AG Grid)
  ├─ ChatPanel ──POST /api/chat──► Claude tool runner ──► InvoiceGateway
  ├─ ProposalCard ──POST /api/invoices/:id/actions──────► InvoiceGateway  (only path that sends)
  └─ Dashboard ──GET /api/invoices──► rows + cash-flow summary
InvoiceGateway = PayPalClient (sandbox/live)  |  DemoInvoiceStore (no keys needed)
```

## Run it

```bash
git clone https://github.com/OHURU-IAN/kazipay && cd kazipay
npm install
cp .env.example .env.local   # add GEMINI_API_KEY (free) and PayPal sandbox keys
npm run dev                  # http://localhost:3000
```

- **No PayPal keys?** The app runs on built-in demo invoices (shown by the "Demo data" badge).
- **PayPal sandbox:** create a REST app at developer.paypal.com → Apps & Credentials → Sandbox and copy the Client ID and Secret. To pay an invoice, open its *Pay page* and log in with your sandbox **personal** account.
- **Tests:** `npm test` (Vitest: PayPal client, invoice building, risk and forecast logic, demo store, agent tools).

## Try these prompts
- Who owes me money right now?
- Bill Lumen Studio (carlos@lumen.example) $300 for the logo, due in 14 days
- Chase everyone who is overdue
- What will I get paid over the next month?

## Built with
Next.js · TypeScript · PayPal Invoicing API · Google Gemini (`@google/genai`) · Claude (Anthropic SDK) · AG Grid Community · Zod · Vitest

## License
MIT
