const indicatorService = require('../services/indicatorService');

class ExitAgent {
  constructor() {
    this.name = 'exit';
    this.lastOutput = null;
    this.maxTradeDurationMs = 4 * 60 * 60 * 1000; // 4 hours default
  }

  async analyze({ openTrade, candles15m, rsiData }) {
    if (!openTrade) {
      this.lastOutput = { agent: this.name, timestamp: Date.now(), action: 'no_open_trade' };
      return this.lastOutput;
    }

    const currentPrice = candles15m[candles15m.length - 1].close;
    const entryPrice = parseFloat(openTrade.entry_price);
    const side = openTrade.side;
    const entryTime = new Date(openTrade.entry_time).getTime();
    const elapsed = Date.now() - entryTime;

    const triggers = [];
    let shouldClose = false;

    // Stop loss check (2% default)
    const stopLossPercent = 0.02;
    if (side === 'buy' && currentPrice <= entryPrice * (1 - stopLossPercent)) {
      triggers.push('stop_loss');
      shouldClose = true;
    }
    if (side === 'sell' && currentPrice >= entryPrice * (1 + stopLossPercent)) {
      triggers.push('stop_loss');
      shouldClose = true;
    }

    // Take profit check (4% default)
    const takeProfitPercent = 0.04;
    if (side === 'buy' && currentPrice >= entryPrice * (1 + takeProfitPercent)) {
      triggers.push('take_profit');
      shouldClose = true;
    }
    if (side === 'sell' && currentPrice <= entryPrice * (1 - takeProfitPercent)) {
      triggers.push('take_profit');
      shouldClose = true;
    }

    // RSI reversal
    if (rsiData) {
      if (side === 'buy' && rsiData.overbought) {
        triggers.push('rsi_reversal');
        shouldClose = true;
      }
      if (side === 'sell' && rsiData.oversold) {
        triggers.push('rsi_reversal');
        shouldClose = true;
      }
    }

    // Trend invalidation
    const structure = indicatorService.detectMarketStructure(candles15m);
    if (side === 'buy' && structure.trend === 'bearish' && structure.bos &&
        structure.bos.type === 'bearish_bos') {
      triggers.push('trend_invalidation');
      shouldClose = true;
    }
    if (side === 'sell' && structure.trend === 'bullish' && structure.bos &&
        structure.bos.type === 'bullish_bos') {
      triggers.push('trend_invalidation');
      shouldClose = true;
    }

    // Max trade duration
    if (elapsed >= this.maxTradeDurationMs) {
      triggers.push('max_duration');
      shouldClose = true;
    }

    // Calculate PnL
    let unrealizedPnl = 0;
    const positionSize = parseFloat(openTrade.position_size);
    if (side === 'buy') {
      unrealizedPnl = (currentPrice - entryPrice) * positionSize;
    } else {
      unrealizedPnl = (entryPrice - currentPrice) * positionSize;
    }

    this.lastOutput = {
      agent: this.name,
      timestamp: Date.now(),
      shouldClose,
      triggers,
      currentPrice,
      entryPrice,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      elapsed: Math.round(elapsed / 60000), // minutes
      tradeId: openTrade.id,
    };

    return this.lastOutput;
  }
}

module.exports = ExitAgent;
