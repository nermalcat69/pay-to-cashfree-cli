# pay-to-cashfree-cli

A terminal storefront boilerplate. Customers browse products and pay via Cashfree — entirely from the command line. The Go CLI renders a payment QR code; the Fastify backend holds the Cashfree credentials and streams payment status in real time.

```
Customer terminal                  Your server
┌────────────────┐                 ┌──────────────────────────┐
│  Go CLI        │ ── STORE_API ──▶│  Fastify backend         │
│  (no secrets)  │ ◀── SSE ───────│  (Cashfree creds in env) │
└────────────────┘                 └──────────┬───────────────┘
                                               │
                                               ▼
                                          Cashfree API
```

## How it works

1. CLI connects to the backend and fetches the product catalog
2. Customer picks a product + quantity, enters their details, and confirms
3. Backend creates a Cashfree payment link and returns the URL
4. CLI renders the payment URL as a QR code in the terminal
5. Backend polls Cashfree every 2 seconds over SSE — CLI prints confirmation the moment payment lands

## Project structure

```
cli/          Go CLI — browse, select, pay, watch status
backend/      Fastify (Bun) API — catalog, orders, SSE payment stream
```

## Setup

### Backend

```bash
cd backend
cp .env.example .env      # add your Cashfree sandbox keys
bun install
bun run dev               # starts on :8080
```

Without Cashfree credentials the backend runs in **demo mode** — orders are created locally and the QR links to a dummy URL. Safe for development.

### CLI

```bash
cd cli
go build -o store .

# Point at your backend (defaults to http://localhost:8080)
STORE_API=https://your-backend.example.com ./store
```

The CLI binary contains **zero secrets**. Distribute it freely — it only knows the backend URL.

## Environment variables

| Variable | Where | Description |
|---|---|---|
| `CASHFREE_APP_ID` | backend `.env` | Cashfree API key (never in CLI) |
| `CASHFREE_SECRET_KEY` | backend `.env` | Cashfree secret (never in CLI) |
| `PORT` | backend `.env` | Backend port (default `8080`) |
| `STORE_API` | CLI runtime | Backend URL (default `http://localhost:8080`) |

## Deploy backend

```bash
cd backend
docker build -t store-backend .
docker run -p 8080:8080 \
  -e CASHFREE_APP_ID=... \
  -e CASHFREE_SECRET_KEY=... \
  store-backend
```

## Customise

- **Products** — edit `backend/src/products.ts`
- **Store name / branding** — edit the title string in `cli/main.go`
- **Poll interval** — change `POLL_INTERVAL_MS` in `backend/src/server.ts`
