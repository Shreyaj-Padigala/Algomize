/**
 * Exit Agent — determines when to close a trade based on
 * the user's exit strategy specification.
 *
 * The user provides an exit strategy description like:
 * "Exit if I get 50% on this trade or if I lose 20%"
 *
 * The agent parses take-profit and stop-loss percentages from the description
 * and monitors the trade accordingly. Defaults to -20% PNL exit if not specified.
 */
class ExitAgent {
  constructor() {
    this.name = 'exit';
    this.lastOutput = null;
  }

  async analyze({ openTrade, candles15m, exitStrategy }) {
    if (!openTrade) {
      this.lastOutput = { agent: this.name, timestamp: Date.now(), action: 'no_open_trade' };
      return this.lastOutput;
    }

    const currentPrice = candles15m[candles15m.length - 1].close;
    const entryPrice = parseFloat(openTrade.entry_price);
    const side = openTrade.side;
    const leverage = parseFloat(openTrade.leverage) || 100;
    const entryTime = new Date(openTrade.entry_time).getTime();
    const elapsed = Date.now() - entryTime;

    // Calculate current PnL %
    const priceChangePercent = side === 'buy'
      ? ((currentPrice - entryPrice) / entryPrice * 100)
      : ((entryPrice - currentPrice) / entryPrice * 100);

    const leveragedPnlPercent = Math.round(priceChangePercent * leverage * 100) / 100;

    // Parse exit rules from user's exit strategy
    const { takeProfitPct, stopLossPct } = this._parseExitStrategy(exitStrategy);

    const triggers = [];
    let shouldClose = false;

    // Check take profit
    if (leveragedPnlPercent >= takeProfitPct) {
      triggers.push(`take_profit_${takeProfitPct}%`);
      shouldClose = true;
    }

    // Check stop loss
    if (leveragedPnlPercent <= -stopLossPct) {
      triggers.push(`stop_loss_-${stopLossPct}%`);
      shouldClose = true;
    }

    // Safety: max trade duration of 12 hours
    const maxDuration = 12 * 60 * 60 * 1000;
    if (elapsed >= maxDuration) {
      triggers.push('max_duration_12h');
      shouldClose = true;
    }

    this.lastOutput = {
      agent: this.name,
      timestamp: Date.now(),
      shouldClose,
      triggers,
      currentPrice,
      entryPrice,
      side,
      priceChangePercent: Math.round(priceChangePercent * 10000) / 10000,
      leveragedPnlPercent,
      elapsed: Math.round(elapsed / 60000),
      takeProfitPct,
      stopLossPct,
      tradeId: openTrade.id,
    };

    return this.lastOutput;
  }

  /**
   * Parse the user's exit strategy text to extract take profit and stop loss percentages.
   * Examples:
   * - "Exit if I get 50% or lose 20%" → { takeProfitPct: 50, stopLossPct: 20 }
   * - "Take profit at 30%, stop loss at 15%" → { takeProfitPct: 30, stopLossPct: 15 }
   * - "" or undefined → { takeProfitPct: 50, stopLossPct: 20 } (defaults)
   */
  _parseExitStrategy(exitStrategy) {
    let takeProfitPct = 50;  // default take profit
    let stopLossPct = 20;    // default stop loss

    if (!exitStrategy || typeof exitStrategy !== 'string') {
      return { takeProfitPct, stopLossPct };
    }

    const text = exitStrategy.toLowerCase();

    // Try to find profit/gain numbers
    const profitPatterns = [
      /(?:take\s*profit|tp|gain|profit|get|make|earn|up)\s*(?:at|of|is)?\s*(\d+(?:\.\d+)?)\s*%/i,
      /(\d+(?:\.\d+)?)\s*%\s*(?:profit|gain|tp|take\s*profit|up)/i,
      /(?:win|get)\s+(\d+(?:\.\d+)?)\s*%/i,
    ];

    for (const pattern of profitPatterns) {
      const match = text.match(pattern);
      if (match) {
        takeProfitPct = parseFloat(match[1]);
        break;
      }
    }

    // Try to find loss/stop numbers
    const lossPatterns = [
      /(?:stop\s*loss|sl|lose|loss|down)\s*(?:at|of|is)?\s*(\d+(?:\.\d+)?)\s*%/i,
      /(\d+(?:\.\d+)?)\s*%\s*(?:loss|stop\s*loss|sl|down|lose)/i,
      /(?:lose)\s+(\d+(?:\.\d+)?)\s*%/i,
    ];

    for (const pattern of lossPatterns) {
      const match = text.match(pattern);
      if (match) {
        stopLossPct = parseFloat(match[1]);
        break;
      }
    }

    // If we only found numbers generically (e.g., "exit at 50% or -20%")
    if (takeProfitPct === 50 && stopLossPct === 20) {
      const numbers = text.match(/(\d+(?:\.\d+)?)\s*%/g);
      if (numbers && numbers.length >= 2) {
        const vals = numbers.map(n => parseFloat(n));
        // Higher number is likely take profit, lower is stop loss
        takeProfitPct = Math.max(...vals);
        stopLossPct = Math.min(...vals);
      } else if (numbers && numbers.length === 1) {
        // Single number — treat as stop loss (more common to specify)
        stopLossPct = parseFloat(numbers[0]);
      }
    }

    return { takeProfitPct, stopLossPct };
  }
}

module.exports = ExitAgent;
