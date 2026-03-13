const indicatorService = require('../services/indicatorService');

class RSIAgent {
  constructor() {
    this.name = 'rsi';
    this.lastOutput = null;
    this.overboughtThreshold = 70;
    this.oversoldThreshold = 30;
  }

  async analyze(candles15m) {
    const closes = candles15m.map((c) => c.close);

    // All RSI math is coded manually in indicatorService
    const rsiValues = indicatorService.calculateRSI(closes, 14);
    const currentRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;

    let condition = 'neutral';
    if (currentRSI !== null) {
      if (currentRSI >= this.overboughtThreshold) condition = 'overbought';
      else if (currentRSI <= this.oversoldThreshold) condition = 'oversold';
    }

    // Detect divergence
    const priceSlice = closes.slice(-(rsiValues.length));
    const divergence = indicatorService.detectDivergence(priceSlice, rsiValues, 10);

    this.lastOutput = {
      agent: this.name,
      timestamp: Date.now(),
      currentRSI: currentRSI !== null ? Math.round(currentRSI * 100) / 100 : null,
      condition,
      overbought: condition === 'overbought',
      oversold: condition === 'oversold',
      bullishDivergence: divergence.bullish,
      bearishDivergence: divergence.bearish,
      rsiHistory: rsiValues.slice(-20).map((v) => Math.round(v * 100) / 100),
    };

    return this.lastOutput;
  }
}

module.exports = RSIAgent;
