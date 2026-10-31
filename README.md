# Udhaar Voice

Photograph a shop's credit ledger (khata). Udhaar Voice calls each customer in their own language (English, Hindi, Odia, Bengali or Marathi), records promises to pay, and lets the shopkeeper ask the khata anything by voice. Built for the Bolna Buildathon 2026.

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
| `npm run db:seed` | Loads the demo shop (Maa Tara Variety Stores) and its login into Supabase, replacing any earlier copy; the password comes from `DEMO_PASSWORD` in `web/.env.local` |
| `npm run bolna:setup` | Writes the prompts, greeting, webhook and extractions onto the two Bolna agents |

## What's where

```
bolna/
├─ credits-ledger.md          Bolna credit spend, updated after every test
├─ web/                       Next.js 16 app
│  ├─ supabase/migrations/    Tables, access rules and multi-row functions, in order
│  ├─ scripts/                The demo shop loader (`db:seed`) and the Bolna agent setup (`bolna:setup`)
│  └─ src/
│     ├─ app/                 Routes: / (landing), /try (judges' demo), /app/* (shopkeeper app), /api/udhaar/* (the API)
│     ├─ components/screens/  One file per screen
│     ├─ components/app/      Shared pieces: status chips, transcript, app shell
│     ├─ components/ui/       shadcn/ui components (Radix)
│     ├─ lib/domain/          Types (Zod) and business rules: pure functions, unit-tested
│     ├─ lib/api/             The API contract every screen uses, and its browser client
│     ├─ lib/server/          The API on Supabase: loading a shop's rows, queries, scheduling, validation
│     ├─ lib/demo/            The demo shop, scripted conversations, the sample khata page
│     └─ lib/i18n/            All shopkeeper-facing text: English (en/), Hindi (hi.ts), Odia (or.ts), Bengali (bn.ts), Marathi (mr.ts)
```

## The screens

| Route | Screen |
|---|---|
| `/` | Landing page |
| `/try` | Public demo: a visitor gets a scripted reminder call (one per number per day, 20 a day in all) |
| `/app` | Dashboard: pending, promised, collected, what needs attention |
| `/app/customers`, `/app/customers/[id]` | Customer list and page (memory, promises, disputes, khata, calls, call recordings, UPI QR code; rename or remove a customer) |
| `/app/khata` | Snap khata: take or upload a photo, type entries, or import a CSV/Excel sheet → entries → review (crossed-out values, repeats, changes) → save; undo a whole import |
| `/app/calls`, `/app/calls/[id]` | Calls: schedule reminder batches (change a batch's time before it starts, remove anyone not yet called), watch them run, call history, and the call screen (live state, transcript, extraction, event log). `/app/reminders` redirects here. |
| `/app/ask` | Ask your khata (shows the tool the assistant called) |
| `/app/report` | Today's report and the evening call |
| `/app/graph` | Knowledge graph |
| `/app/profile` | Your details, shop and UPI ID (from the avatar menu: sidebar bottom on desktop, header top-right on phones) |
| `/app/settings` | How the app works, saved as it changes: app language, calling rules, language for new customers, evening voice summary, demo controls |

## What's connected

| Part | How |
|---|---|
| Accounts and data | Supabase Auth (phone or email with a password; a new account confirms its email with a code); every shop's data in Postgres, private to its owner by row-level security |
| Calls | Bolna reminder and evening summary agents in English, Hindi, Odia, Bengali and Marathi; results written into promises, disputes, notes and opt-outs |
| Khata photos | Gemini reads each page into rows with a confidence per field and crossed-out amounts, with Meta's Muse Spark when Gemini fails; the photo is kept in private storage |
| Ask your khata | Gemini (or Muse Spark, when Gemini fails) answers by calling tools on the shop's data, in the language asked; voice questions are transcribed the same way. Without either key, or when both fail, keyword answers |
| `/try` | A real Bolna call when `TRY_REAL_CALLS` is on (a Bolna trial only reaches verified numbers), otherwise a scripted conversation |

## Calls

- **Agents:** two Bolna agents, Reminder and Evening summary. English and Hindi voices are set on Bolna; `npm run bolna:setup` adds Bengali, Odia and Marathi Sarvam voices when missing and writes the prompts (`lib/server/bolna/prompts.ts`), greeting, webhook and extractions onto them. Each call fills the prompt from `user_data`: the customer's name, amount due, what they bought, memory from earlier calls and any open dispute.
- **Dispatcher** (`lib/server/dispatcher.ts`): every minute (Supabase cron, `0005_scheduler.sql`) and right after a call is scheduled for now. It creates evening summary calls at each shop's time, queues due calls, and dials them while lines are free, taking turns between shops and only inside calling hours. A call is claimed before it's dialled, so it's never dialled twice.
- **Results:** Bolna's webhook (`/api/bolna/webhook`) and the dispatcher's check of calls on a line both read the call back from Bolna's API, then write the status, transcript, cost and the extracted outcome, promise, dispute, notes and opt-out (`lib/server/call-results.ts`). A finished call's result is written once.

## Plans

- **Plans** (`PLANS` in `lib/domain/rules.ts`, `0008_plans.sql`, the Plans page): the khata is free, with 2 photo reads a day. Asha (₹199 a month) adds 25 reminder calls a month and a Saturday summary call; Asha Plus (₹399) adds 60 calls and a daily summary call; both read up to 30 photos a day. Call packs add 10 calls on any plan, used once the month's calls run out. Payments aren't live: during the pilot, plans switch at no charge. New shops start on the free plan.
- **WhatsApp first:** sending a WhatsApp reminder from a customer's page is noted, and Asha may call 3 days later if no payment came in. A missed promise or a request to be called back skips this step. The reminder carries the shop's UPI ID, a link to a pay page (`/pay`) whose button opens the customer's UPI app, and the QR code as a picture; no amount is fixed, so customers can pay part. Dues under ₹300 get WhatsApp only, nobody is called more than twice a month, nobody is reminded before a promised date, and when calls run short the oldest and largest dues are called first.

## Corrections and accounts

- **Customers** can be added by hand on the Customers page, as well as from khata photos. They can be renamed, or removed: a removed customer leaves the lists and their waiting calls are cancelled, but past calls stay (needs `0007`).
- **Entries and payments** can be corrected or deleted from a customer's page. A deleted one is voided, not erased, so the history stays (deleting payments needs `0006`).
- **Passwords** can be changed from Profile, after checking the current one.
- **Sign-up** sends a code to the email when Supabase's "Confirm email" is on; the shop is created once the code is entered.
- **Sign-in limits** (`lib/server/limits.ts`, `0006`): after 5 failed sign-ins for one phone or email, or 20 from one network address, within 15 minutes, sign-in pauses; one network can create at most 10 accounts in 15 minutes.
- **Phones:** the app can be added to the home screen (`app/manifest.ts`, icons in `public/icons`), opening straight into the khata.

## The database

`web/supabase/migrations/` holds the schema. Every row a shop owns carries `shop_id`, and one access rule limits signed-in users to their own shop. Totals (balances, collections, call stats) are computed from rows, not stored. Undoing a khata import voids its entries instead of deleting them. Server work that no single shop owns (sign-up, the shared call lines, the `/try` limits) uses the service role key on the server only.

## Reading and understanding

- **Typed entries and spreadsheets** (`lib/khata-file.ts`): CSV and Excel files are read in the browser; columns are found by their header in English, Hindi or Bengali, or taken in the order name, amount, items, date, phone. They go through the same review as a photo.
- **Khata photos** (`lib/server/ai.ts`, `khata.ts`): the photo is shrunk in the browser, stored in `khata-photos/{shop}/{scan}.jpg`, and read by Gemini (or Muse Spark) against a JSON schema. Rows are then matched to customers and saved entries exactly like the sample page.
- **Ask** (`lib/server/ask.ts`): Gemini gets tools over the shop's data (summary, a customer, promises by range, top dues, disputes, missed promises, collections, product requests, scheduling a call) and answers in the question's language. The keyword assistant answers when Gemini isn't set up or fails.
- **Voice questions:** Gemini transcribes the recording in its own script before it is asked.
- **Fallback to Meta** (`lib/server/meta.ts`, `META_API_KEY`): when Gemini fails, the browser asks again with Meta's Muse Spark (`META_MODEL`, default `muse-spark-1.3`; recordings are sent to it as WAV; `META_AUDIO_MODEL` can give spoken questions another model). Each try is its own request. While a model works, the screen shows a running clock, says when a second model has taken over, offers Cancel, and asks before the page is left; a photo being read carries on after a reload. `AI_TEST_FAIL=gemini` in `.env.local` makes Gemini fail on purpose, to try the fallback locally.
- **Models and limits:** `GEMINI_MODEL` (default `gemini-3.8-flash`), with `GEMINI_FALLBACK_MODEL` (default `gemini-3.6-flash`) when it is busy and Meta isn't set up. Each call has a time budget and no hidden retries, so a request finishes well inside 60 s; Ask gives up after about 40 s and answers by keywords. The free tier allows only 20 requests per model a day, so real use needs billing on the Gemini key.
