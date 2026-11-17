// Dip-buy bot for the make.fun BTC race (btc-race-24h-20261117-0603).
//
// Strategy: RSI(14) mean reversion on 10-minute sampled closes of cbBTC/USDC.
//   - Sample one close per 10 bars; RSI is the plain mean of gains and losses
//     over the last 14 sampled changes (no Wilder smoothing).
//   - Enter (full size, all cash) when RSI crosses below 40: the dip is
//     oversold on a 10-minute scale. The cross requirement (previous sampled
//     RSI at or above 40) is also the re-entry guard: after an exit, RSI must
//     recover above 40 before the next entry, so a falling market cannot make
//     the bot buy the same dip over and over.
//   - Exit the whole position when sampled RSI rises above 65, when the
//     position is 1% under its cost (stop-loss), or when it is 2% over its
//     cost (take-profit).
//   - No trading during a warm-up; indicators still build from warm-up bars.
//   - A full-size round trip costs ~34 bps (4 bps fee + 2 bps slippage +
//     ~11 bps of price impact per leg at this pool's depth), so the bot only
//     trades moves it can catch at the 10-minute scale, never 1-minute noise.
//
// Everything here is a pure function of the bars and the account the harness
// sends: no clock, no environment, no randomness, so two runs on the same
// data produce the same orders byte for byte.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Sample one close per this many bars. */
const SAMPLE_EVERY = 10;
/** Sampled changes per RSI value. */
const RSI_PERIOD = 14;
/** Enter when RSI crosses below this. */
const RSI_BUY = 40;
/** Exit when RSI rises above this. */
const RSI_SELL = 65;
/** Exit when the position is this many bps under its cost. */
const STOP_BPS = 100;
/** Exit when the position is this many bps over its cost. */
const TAKE_BPS = 200;
/** Cap each fill at 1% past the close it was decided on. */
const MAX_SLIPPAGE_BPS = 100;
/**
 * Do not open a new position in the final hour of the window (bar 1380 of
 * 1440): an entry that late has at most six more 10-minute samples for RSI
 * to rise above RSI_SELL, so it is usually flattened at the end having paid
 * the ~30 bps round trip without time to earn it back. Exits still run.
 */
const NO_ENTRY_AFTER_BAR = 1380;

/** Closes sampled every SAMPLE_EVERY bars, as plain numbers (ratios only). */
const samples: number[] = [];
/** RSI at the previous sample, or null before the first value. */
let prevRsi: number | null = null;
/** How many CBBTC bars have been seen. */
let seen = 0;

/** RSI over the last RSI_PERIOD sampled changes, or null until 15 samples. */
function rsi(): number | null {
  if (samples.length < RSI_PERIOD + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = samples.length - RSI_PERIOD; i < samples.length; i++) {
    const d = samples[i] - samples[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): (BuyInput | SellInput)[] {
    const bar = _batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    seen += 1;
    // Indicators build on every bar, warm-up included; orders only on samples.
    if ((seen - 1) % SAMPLE_EVERY !== 0) return [];
    samples.push(Number(bar.c));
    const now = rsi();
    if (now === null) {
      prevRsi = null;
      return [];
    }
    const held = state.positions.get(SYMBOL);
    const orders: (BuyInput | SellInput)[] = [];
    if (held === undefined) {
      // Flat: enter only on a fresh cross below RSI_BUY, and not in the
      // final hour, when a new position could not mature before the flatten.
      const late = seen - 1 >= NO_ENTRY_AFTER_BAR;
      if (!late && prevRsi !== null && prevRsi >= RSI_BUY && now < RSI_BUY && !state.warmingUp) {
        const cash = state.cash;
        if (cash >= BigInt(state.hello.fees.min_notional_quote_units)) {
          orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      }
    } else {
      // Holding: exit on RSI above RSI_SELL, on the stop, or on the take-profit.
      const value = state.value(SYMBOL, held.qty);
      const stop = value * 100n < held.cost * BigInt(100 - STOP_BPS);
      const take = value * 100n > held.cost * BigInt(100 + TAKE_BPS);
      if (now > RSI_SELL || stop || take) {
        orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }
    prevRsi = now;
    return orders;
  },
});
