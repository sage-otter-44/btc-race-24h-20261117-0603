[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/sage-otter-44/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/sage-otter-44/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

# Dip-buy RSI bot — btc-race-24h-20261117-0603

A long-only cbBTC/USDC trading bot for [make.fun's "Race a BTC trading bot live for 24 hours" bounty](https://make.fun/bounty/btc-race-24h-20261117-0603) ($250 in USDC).
It trades 1-minute on-chain bars through the `agent-fun/bars-replay/v1`
protocol (see `vendor/makefun-bars.ts`, a byte-for-byte copy of the kit SDK
shim).

## Strategy

RSI(14) mean reversion on 10-minute sampled closes:

- Sample one close per 10 bars; RSI is the plain mean of gains and losses
  over the last 14 sampled changes.
- **Enter** (full size, all cash) when RSI crosses below 40 — the dip is
  oversold on a 10-minute scale. The cross requirement is also the
  re-entry guard: after an exit, RSI must recover above 40 before the next
  entry, so a falling market cannot make the bot buy the same dip twice.
- **Exit** the whole position when sampled RSI rises above 65, when the
  position is 1% under its cost (stop-loss), or 2% over its cost
  (take-profit).
- **No new entries in the final hour** (bar 1380 of 1440): a position
  opened that late has at most six more 10-minute samples for RSI to rise
  above 65, so it is usually flattened at the end having paid the ~30 bps
  round trip without time to earn it back. Exits still run.

## Why this shape

A full-size round trip costs ~30–35 bps (4 bps fee + 2 bps slippage +
~11 bps of price impact per leg at this pool's depth), so 1-minute noise
is untradable: every fast trend-follower tested on the dev window lost
money to whipsaws. The 10-minute RSI buys the dips of the day's ~1%
swings instead, and the stop-loss caps the damage if the race window
trends down hard.

## Local dev grade

`node cli/makefun.mjs grade-local --kit <kit> --bot . --driver process`

- Net PnL **+$23.25** on the 1,440-bar dev window (gate: > $0)
- 8 trades, win rate 100%, max drawdown 1.00% (guardrail: ≤ 25%)
- Deterministic: both graded runs produce identical action logs.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript, stdlib only)
- `vendor/makefun-bars.ts` — kit SDK shim, byte-for-byte copy
