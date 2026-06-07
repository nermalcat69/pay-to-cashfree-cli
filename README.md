# pay-to-cashfree-cli

A terminal storefront boilerplate. Customers browse products and pay via Cashfree — entirely from the command line. The Go CLI renders a payment QR code; the Fastify backend holds the Cashfree credentials and streams payment status in real time.

```
Customer terminal                  Your server (Bun or Cloudflare Workers)
┌────────────────┐                 ┌──────────────────────────────────────┐
│  Go CLI        │ ── STORE_API ──▶│  Fastify backend                     │
│  (no secrets)  │ ◀── SSE ───────│  Cashfree creds live here, never CLI │
└────────────────┘                 └──────────────────┬───────────────────┘
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
cli/                  Go CLI — browse, select, pay, watch status
backend/
  src/
    app.ts            Fastify app factory (routes shared by both runtimes)
    server.ts         Bun entrypoint — adds SSE route, starts HTTP server
    worker.ts         Cloudflare Workers entrypoint — fetch handler + native SSE
    cashfree.ts       Cashfree API client
    products.ts       Product catalog
  wrangler.toml       Cloudflare Workers config
  Dockerfile          Container deployment
```

## Setup

### Backend (local)

```bash
cd backend
cp .env.example .env      # add your Cashfree sandbox keys
bun install
bun run dev               # hot-reload on :8080
```

Without Cashfree credentials the backend runs in **demo mode** — orders are created locally and the QR links to a dummy URL. Safe for development.

### CLI

```bash
cd cli
go build -o store .

# Point at your backend (defaults to http://localhost:8080)
STORE_API=https://your-backend.example.com ./store
```

The CLI binary contains **zero secrets**. Distribute it freely — it only needs the backend URL.

## Environment variables

| Variable | Where | Description |
|---|---|---|
| `CASHFREE_APP_ID` | backend `.env` / Workers secret | Cashfree API key (never in CLI) |
| `CASHFREE_SECRET_KEY` | backend `.env` / Workers secret | Cashfree secret (never in CLI) |
| `PORT` | backend `.env` | Bun server port (default `8080`) |
| `STORE_API` | CLI runtime | Backend URL (default `http://localhost:8080`) |

## Deploy

### Cloudflare Workers

```bash
cd backend
bun run cf:secret CASHFREE_APP_ID      # prompted — stored encrypted by Cloudflare
bun run cf:secret CASHFREE_SECRET_KEY
bun run cf:deploy
```

Local Workers emulation:

```bash
bun run cf:dev     # wrangler dev on :8787
```

### Docker / VPS

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
- **Poll interval** — change `POLL_INTERVAL_MS` in `backend/src/server.ts` and `backend/src/worker.ts`
