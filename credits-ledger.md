# Bolna credits ledger

Rule: no real payments until free credits run out. Claude estimates the cost before every test and updates this file after it.
Rate observed: $0.06/min (bundled models, Bolna shared number). Own provider keys cut it to ~$0.02/min platform fee.

## Balance

| Date | Event | Minutes | Cost | Balance after |
|---|---|---|---|---|
| 2026-10-19/21 | Sign-up credit (Roshan's account) | | +$5.00 | $5.00 |
| 2026-10-21 | Template agent test call ("(v2) Onboarding - En + Hi"), ended by asking it to hang up | ~8 | -$0.51 | $4.49 |
| 2026-10-28 | Test call 1: Deepak (Hindi), promise ₹500 by Fri 30 Oct | 0.6 | -$0.06 | $4.43 |
| 2026-10-28 | Test call 2: Tapas (Bengali), "already paid" (heard as a promise: Bengali transcription) | 1.3 | -$0.09 | $4.34 |
| 2026-10-28 | Test call 3: Deepak (Hindi), call back tomorrow 6 PM | 0.9 | -$0.06 | $4.28 |
| 2026-10-28 | Test call 4: Tapas (Hindi), wrong number | 0.5 | -$0.03 | $4.25 |
| 2026-10-28 | Test call 5: Deepak (Hindi), asked not to be called again | 0.9 | -$0.06 | $4.19 |
| 2026-10-28 | Test call 6: evening summary (Bengali); greeting only, summary not read (fixed) | 0.3 | -$0.03 | $4.16 |
| 2026-10-28 | Test call 7: evening summary (Bengali), read in full, question answered | 0.9 | -$0.06 | $4.10 |
| 2026-10-29 | Unplanned: Bolna's own auto-reschedule called Deepak back at 6 PM (from test call 3); no answer | 0.3 | -$0.03 | $4.07 |
| 2026-10-29 | Evening summary, demo shop, 6:45 PM: no answer | 0 | $0.00 | $4.07 |
| 2026-10-29 | Evening summary (Bengali), demo shop, 11:48 PM, placed from the app | 0.6 | -$0.06 | $4.01 |
| 2026-10-30 | Unplanned: Bolna's own auto-reschedule called Deepak at 9 AM. Booked during test call 1 on 28 Oct ("Friday"), before auto-reschedule was turned off; no conversation | 0.4 | -$0.03 | $3.98 |
| 2026-10-30 | Correction to match the Bolna wallet (one earlier call cost more than recorded) | | -$0.06 | **$3.92** (~65 min) |

## Planned: first real calls (call pipeline, 28 Oct)

| Test | Calls × length | Estimated cost |
|---|---|---|
| Reminder calls: promise, dispute, call back, wrong number, opt out | 5 × ~2 min | ~$0.60 |
| Evening summary call | 1 × ~1.5 min | ~$0.10 |
| **Balance after** | | **~$3.80** |

## Credit that may arrive (not counted until it shows in the dashboard)

- $10 "Buildathon credit": mentioned only in the credits form; not received yet.
- Credits form request: +$15 Bolna, Sarvam $15, OpenAI $10 (if submitted; replies reported slow).
- Teammates' own $5 sign-up credit each: usable only in their own accounts (testing on agent copies).

## Planned spend (estimate before running)

| Test | Calls × length | Estimated cost |
|---|---|---|
| 15-persona reminder test matrix | 15 × ~2 min | ~$1.80 |
| Buffer for prompt fixes / reruns | ~10 × 2 min | ~$1.20 |
| **Remaining after both** | | **~$1.50** |

Pilot with real shops (Sat 24 Oct onward) needs a paid wallet anyway (trial = verified numbers only, 2 concurrent calls).
