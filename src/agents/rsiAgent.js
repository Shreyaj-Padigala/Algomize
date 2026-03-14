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

    const rsiValues = indicatorService.calculateRSI(closes, 14);
    const currentRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null;

    let condition = 'neutral';
    if (currentRSI !== null) {
      if (currentRSI >= this.overboughtThreshold) condition = 'overbought';
      else if (currentRSI <= this.oversoldThreshold) condition = 'oversold';
    }

    // Regular divergence
    const priceSlice = closes.slice(-(rsiValues.length));
    const divergence = indicatorService.detectDivergence(priceSlice, rsiValues, 10);

    // Hidden divergence
    const hiddenDiv = indicatorService.detectHiddenDivergence(priceSlice, rsiValues, 20);

    // Determine divergence label
    let divLabel = 'None';
    if (divergence.bullish) divLabel = 'Bullish Regular Divergence';
    else if (divergence.bearish) divLabel = 'Bearish Regular Divergence';
    else if (hiddenDiv.hiddenBullish) divLabel = 'Bullish Hidden Divergence';
    else if (hiddenDiv.hiddenBearish) divLabel = 'Bearish Hidden Divergence';

    // Score /10
    let longScore = 5;
    let shortScore = 5;

    // RSI value scoring
    if (currentRSI !== null) {
      if (currentRSI <= 25) { longScore += 3; shortScore -= 2; }
      else if (currentRSI <= 35) { longScore += 2; shortScore -= 1; }
      else if (currentRSI <= 45) { longScore += 1; }
      else if (currentRSI >= 75) { shortScore += 3; longScore -= 2; }
      else if (currentRSI >= 65) { shortScore += 2; longScore -= 1; }
      else if (currentRSI >= 55) { shortScore += 1; }
    }

    // Divergence scoring
    if (divergence.bullish) { longScore += 3; shortScore -= 2; }
    if (divergence.bearish) { shortScore += 3; longScore -= 2; }
    if (hiddenDiv.hiddenBullish) { longScore += 2; shortScore -= 1; }
    if (hiddenDiv.hiddenBearish) { shortScore += 2; longScore -= 1; }

    longScore = Math.max(1, Math.min(10, longScore));
    shortScore = Math.max(1, Math.min(10, shortScore));

    this.lastOutput = {
      agent: this.name,
      timestamp: Date.now(),
      currentRSI: currentRSI !== null ? Math.round(currentRSI * 100) / 100 : null,
      condition,
      overbought: condition === 'overbought',
      oversold: condition === 'oversold',
      bullishDivergence: divergence.bullish,
      bearishDivergence: divergence.bearish,
      hiddenBullishDivergence: hiddenDiv.hiddenBullish,
      hiddenBearishDivergence: hiddenDiv.hiddenBearish,
      divLabel,
      rsiHistory: rsiValues.slice(-20).map((v) => Math.round(v * 100) / 100),
      longScore,
      shortScore,
    };

    return this.lastOutput;
  }
}

module.exports = RSIAgent;
