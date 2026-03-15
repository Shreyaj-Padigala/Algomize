# Algomize Trading Logic

## Entry Signal Logic

### When Does the Bot Open a Position?

The bot evaluates whether to enter a trade **every 60 seconds** using a multi-agent scoring system. All agents analyze the **current price** to determine if NOW is a good time to enter — they do not suggest future entries at other price levels.

**Entry conditions (ALL must be true):**

1. No open trade exists (one trade at a time only)
2. No pending signal waiting for user confirmation
3. The average agent score reaches >= 6.5 out of 10
4. There is a minimum 1.5 spread between the long and short average scores (clear directional bias)
5. The user manually confirms the trade via the signal prompt

### Scoring Agents (each rates Long and Short out of /10)

| Agent | What It Evaluates |
|-------|-------------------|
| **Confluence** | Is the current price sitting at a support/resistance level? Near support = higher long score, near resistance = higher short score. |
| **Micro Trend (15m)** | 15-minute market structure, EMA20/EMA50 positioning, break of structure, and AI chart pattern recognition via Groq. |
| **Macro Trend (1h)** | 1-hour trend direction, EMA50/EMA200 bias, structural breaks, and AI pattern analysis. Provides macro confirmation. |
| **RSI** | RSI(14) value and divergence detection. Oversold (<=25) boosts long, overbought (>=75) boosts short. Regular and hidden divergences add +2 to +3. |
| **ICT** | Premium/discount zone, liquidity sweeps (buy-side/sell-side), order blocks, and fair value gaps. |

### Final Decision Process

The **FinalDecision agent** averages all agent scores:
- `avgLong = average of all agents' longScores`
- `avgShort = average of all agents' shortScores`

**Signal triggers if:**
- `avgLong >= 6.5` AND `avgLong > avgShort` AND `spread >= 1.5` → **LONG signal**
- `avgShort >= 6.5` AND `avgShort > avgLong` AND `spread >= 1.5` → **SHORT signal**

When a signal triggers:
1. A cash register sound plays
2. A modal overlay appears showing per-agent scores
3. The user clicks **"Yes, Enter Trade"** or **"No, Skip"**
4. If accepted, the trade is recorded at the current market price

### While In a Trade

When a position is open, the bot **stops scanning for new entries**. Only the Exit Agent and RSI agent run (RSI is needed for divergence-based exit checks). This prevents the bot from suggesting new trades while already holding a position.

---

## Exit Signal Logic

### When Does the Bot Close a Position?

The **Exit Agent** evaluates the open position every 60 seconds and triggers a close if ANY of these conditions are met:

| Exit Condition | Description |
|----------------|-------------|
| **Stop Loss (30% at 100x)** | A 0.3% adverse price move at 100x leverage equals a 30% loss. If price moves 0.3% against the position, the exit triggers immediately. For a LONG: `currentPrice <= entryPrice * 0.997`. For a SHORT: `currentPrice >= entryPrice * 1.003`. |
| **RSI Divergence** | If holding LONG and bearish RSI divergence is detected → exit. If holding SHORT and bullish RSI divergence is detected → exit. This catches momentum shifts before they become large moves. |
| **Trend Reversal (BOS)** | If holding LONG and a bearish break of structure occurs (bearish BOS + bearish trend) → exit. If holding SHORT and a bullish break of structure occurs → exit. |
| **Max Duration** | Any trade open for more than 4 hours is automatically closed regardless of PnL. This prevents holding through extended uncertain periods. |

### Consecutive Loss Protection

The bot tracks consecutive losses. After **3 consecutive losing trades**, the bot automatically terminates the session to prevent further drawdown. The loss streak resets to 0 after any winning trade.

---

## PnL Calculation

### How Is PnL Calculated Without Wallet Information?

Algomize does **NOT** connect to your BloFin wallet or know your account balance. It is a **notification-only** system — it tells you when to enter and exit, but does not execute trades on your behalf.

### PnL Is Expressed as Leveraged Percentage (%)

Since the bot doesn't know your position size or wallet balance, all PnL is calculated and displayed as a **leveraged percentage return**:

```
PnL % = (priceChange / entryPrice) * 100 * leverage
```

**Example at 100x leverage:**
- Entry price: $70,000
- Exit price: $70,070 (LONG position)
- Price change: +0.1%
- Leveraged PnL: +0.1% * 100 = **+10%**

This means: "If you entered this trade with 100x leverage, your position would have gained 10% regardless of how much capital you used."

### What PnL Percentage Means for Your Actual Dollars

To calculate your actual dollar PnL, multiply the leveraged PnL % by your position margin:

```
Actual $ PnL = (Leveraged PnL % / 100) * Your Margin
```

**Example:**
- Bot shows: +10% PnL on a trade
- You used $100 margin at 100x leverage ($10,000 position)
- Your actual profit: 10% of $100 = **$10**

### Cumulative PnL

The cumulative PnL on the Trade Log page adds up all individual trade PnL percentages. This gives you a running total of your leveraged return across all trades, which you can then apply to whatever position size you actually traded with.

### Why Not Use Dollar Amounts?

Dollar PnL requires knowing:
- Your margin per trade
- Your actual position size
- Exchange fees and funding rates

Since Algomize is a signal/notification bot (not an execution bot), it provides percentage-based metrics that are universally applicable regardless of your capital allocation.
