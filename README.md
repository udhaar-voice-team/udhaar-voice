# Udhaar Voice

Photograph a shop's credit ledger (khata). Udhaar Voice calls each customer in Bengali or Hindi, records promises to pay, and lets the shopkeeper ask the khata anything by voice. Built for the Bolna Buildathon 2026.

**Status:** the app runs on Supabase (Postgres and Auth). Real calls (Bolna) and photo reading and voice questions (vision and speech models) are not connected yet.

## Run it

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (business rules, queries, scheduling, assistant) |
| `npm run typecheck` | Regenerates route types, then runs TypeScript |
| `npm run lint` | ESLint |
| `npm run build` | Production build (also checks Cache Components rules) |
| `npm run db:seed` | Loads the demo shop (Maa Tara Variety Stores) and its login into Supabase, replacing any earlier copy |

## What's where

```
bolna/
├─ credits-ledger.md          Bolna credit spend, updated after every test
├─ web/                       Next.js 16 app
│  ├─ supabase/migrations/    Tables, access rules and multi-row functions, in order
│  ├─ scripts/seed-demo.ts    The demo shop loader behind `npm run db:seed`
│  └─ src/
│     ├─ app/                 Routes: / (landing), /try (judges' demo), /app/* (shopkeeper app), /api/udhaar/* (the API)
│     ├─ components/screens/  One file per screen
│     ├─ components/app/      Shared pieces: status chips, transcript, app shell
│     ├─ components/ui/       shadcn/ui components (Radix)
│     ├─ lib/domain/          Types (Zod) and business rules: pure functions, unit-tested
│     ├─ lib/api/             The API contract every screen uses, and its browser client
│     ├─ lib/server/          The API on Supabase: loading a shop's rows, queries, scheduling, validation
│     ├─ lib/demo/            The demo shop, scripted conversations, the sample khata page
│     └─ lib/i18n/            All shopkeeper-facing text: English (en/), Bengali (bn.ts), Hindi (hi.ts)
```

## The screens

| Route | Screen |
|---|---|
| `/` | Landing page |
| `/try` | Public demo: a visitor gets a scripted reminder call (one per number per day, 20 a day in all) |
| `/app` | Dashboard: pending, promised, collected, what needs attention |
| `/app/customers`, `/app/customers/[id]` | Customer list and page (memory, promises, disputes, khata, calls) |
| `/app/khata` | Snap khata: photo → entries → review (crossed-out values, repeats, changes) → save; undo a whole import |
| `/app/calls`, `/app/calls/[id]` | Calls: schedule reminder batches (change a batch's time before it starts, remove anyone not yet called), watch them run, call history, and the call screen (live state, transcript, extraction, event log). `/app/reminders` redirects here. |
| `/app/ask` | Ask your khata (shows the tool the assistant called) |
| `/app/report` | Today's report and the evening call |
| `/app/graph` | Knowledge graph |
| `/app/profile` | Your details, shop and UPI ID (from the avatar menu: sidebar bottom on desktop, header top-right on phones) |
| `/app/settings` | How the app works: app language, calling rules, language for new customers, evening voice summary, demo controls |

## Connected and not yet

| Not connected yet | Real already |
|---|---|
| Phone calls: scheduled calls are saved, but nothing dials them | Accounts (Supabase Auth: phone or email with a password), every shop's data in Postgres, private to its owner by row-level security |
| Khata photo reading (same sample result for every photo) | Calling hours, gap between reminders, opt-outs, wrong numbers, refusals, shared calling lines and the queue |
| Voice questions (speech-to-text returns a sample question; rule-based answers) | Matching photo rows to saved entries, undoing imports, promises kept by payments |
| The `/try` call (scripted conversation) | WhatsApp messages with UPI payment links |

## The database

`web/supabase/migrations/` holds the schema. Every row a shop owns carries `shop_id`, and one access rule limits signed-in users to their own shop. Totals (balances, collections, call stats) are computed from rows, not stored. Undoing a khata import voids its entries instead of deleting them. Server work that no single shop owns (sign-up, the shared call lines, the `/try` limits) uses the service role key on the server only.

## Next steps

1. Bolna: reminder and evening summary agents, the call dispatcher (shared lines, calling hours), webhook → call results into promises, disputes and notes.
2. Gemini for khata photos (returning the `KhataExtraction` shape), the assistant's answers and voice questions; then remove the sample khata page and the scripted `/try` call.
