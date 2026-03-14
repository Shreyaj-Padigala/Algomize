const indicatorService = require('../services/indicatorService');

class ExitAgent {
  constructor() {
    this.name = 'exit';
    this.lastOutput = null;
    // At 100x leverage, -30% account loss = 0.30% adverse price move
    this.stopLossPercent = 0.003;
    this.maxTradeDurationMs = 4 * 60 * 60 * 1000; // 4 hours
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

    // Condition 1: -30% at 100x leverage (0.30% adverse price move)
    if (side === 'buy' && currentPrice <= entryPrice * (1 - this.stopLossPercent)) {
      triggers.push('stop_loss_30pct');
      shouldClose = true;
    }
    if (side === 'sell' && currentPrice >= entryPrice * (1 + this.stopLossPercent)) {
      triggers.push('stop_loss_30pct');
      shouldClose = true;
    }

    // Condition 2: RSI divergence indicating big move against position
    if (rsiData) {
      if (side === 'buy' && rsiData.bearishDivergence) {
        triggers.push('rsi_bearish_divergence');
        shouldClose = true;
      }
      if (side === 'sell' && rsiData.bullishDivergence) {
        triggers.push('rsi_bullish_divergence');
        shouldClose = true;
      }
    }

    // Condition 3: Trend reversal (BOS in opposite direction)
    const structure = indicatorService.detectMarketStructure(candles15m);
    if (side === 'buy' && structure.trend === 'bearish' && structure.bos &&
        structure.bos.type === 'bearish_bos') {
      triggers.push('trend_reversal');
      shouldClose = true;
    }
    if (side === 'sell' && structure.trend === 'bullish' && structure.bos &&
        structure.bos.type === 'bullish_bos') {
      triggers.push('trend_reversal');
      shouldClose = true;
    }

    // Max trade duration
    if (elapsed >= this.maxTradeDurationMs) {
      triggers.push('max_duration');
      shouldClose = true;
    }

    // Calculate PnL (at 100x leverage)
    let unrealizedPnl = 0;
    const positionSize = parseFloat(openTrade.position_size);
    const leverage = parseFloat(openTrade.leverage) || 100;
    if (side === 'buy') {
      unrealizedPnl = (currentPrice - entryPrice) / entryPrice * leverage * positionSize;
    } else {
      unrealizedPnl = (entryPrice - currentPrice) / entryPrice * leverage * positionSize;
    }

    const priceChangePercent = side === 'buy'
      ? ((currentPrice - entryPrice) / entryPrice * 100)
      : ((entryPrice - currentPrice) / entryPrice * 100);

    this.lastOutput = {
      agent: this.name,
      timestamp: Date.now(),
      shouldClose,
      triggers,
      currentPrice,
      entryPrice,
      priceChangePercent: Math.round(priceChangePercent * 10000) / 10000,
      leveragedPnlPercent: Math.round(priceChangePercent * leverage * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      elapsed: Math.round(elapsed / 60000),
      tradeId: openTrade.id,
    };

    return this.lastOutput;
  }
}

module.exports = ExitAgent;
