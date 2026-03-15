const indicatorService = require('../services/indicatorService');
const groqService = require('../services/groqService');

class MicroTrendAgent {
  constructor() {
    this.name = 'microTrend';
    this.lastOutput = null;
  }

  async analyze(candles15m) {
    const structure = indicatorService.detectMarketStructure(candles15m);
    const closes = candles15m.map((c) => c.close);
    const ema20 = indicatorService.calculateEMA(closes, 20);
    const ema50 = indicatorService.calculateEMA(closes, 50);

    const currentPrice = closes[closes.length - 1];
    const currentEma20 = ema20.length > 0 ? ema20[ema20.length - 1] : null;
    const currentEma50 = ema50.length > 0 ? ema50[ema50.length - 1] : null;

    let emaTrend = 'neutral';
    if (currentEma20 && currentEma50) {
      emaTrend = currentEma20 > currentEma50 ? 'bullish' : 'bearish';
    }

    // Generate ASCII chart for AI to read the pattern
    const asciiChart = indicatorService.generateAsciiChart(candles15m, 48, 18);

    const aiContext = await groqService.analyze(
      `You are reading a 15-minute BTC/USDT candlestick chart. The CURRENT price is $${currentPrice} (rightmost candle).
'+' = bullish candle, '#' = bearish candle, '|' = wick.

CHART:
${asciiChart}

Context:
- Structure trend: ${structure.trend}
- BOS: ${JSON.stringify(structure.bos)}
- EMA20 vs EMA50: ${emaTrend}
- Price vs EMA20: ${currentEma20 ? (currentPrice > currentEma20 ? 'above' : 'below') : 'n/a'}

IMPORTANT: Evaluate whether entering a trade RIGHT NOW at $${currentPrice} is favorable based on the most recent price action. Do NOT suggest waiting for price to reach other levels. Only assess the current moment.

Respond as JSON:
{
  "pattern": "chart pattern at current price area",
  "bias": "bullish or bearish or neutral",
  "reasoning": "why entering NOW is or is not favorable"
}`
    );

    // Score /10 based on data + AI bias
    let longScore = 5;
    let shortScore = 5;

    // Structure scoring
    if (structure.trend === 'bullish') { longScore += 2; shortScore -= 1; }
    if (structure.trend === 'bearish') { shortScore += 2; longScore -= 1; }

    // EMA scoring
    if (emaTrend === 'bullish') { longScore += 1; }
    if (emaTrend === 'bearish') { shortScore += 1; }

    // BOS scoring
    if (structure.bos) {
      if (structure.bos.type === 'bullish_bos') { longScore += 2; shortScore -= 1; }
      if (structure.bos.type === 'bearish_bos') { shortScore += 2; longScore -= 1; }
    }

    // AI pattern bias
    if (aiContext && aiContext.bias) {
      if (aiContext.bias === 'bullish') { longScore += 1; }
      if (aiContext.bias === 'bearish') { shortScore += 1; }
    }

    longScore = Math.max(1, Math.min(10, longScore));
    shortScore = Math.max(1, Math.min(10, shortScore));

    this.lastOutput = {
      agent: this.name,
      timeframe: '15m',
      timestamp: Date.now(),
      trend: structure.trend,
      structures: structure.structures,
      bos: structure.bos,
      emaTrend,
      currentPrice,
      pattern: aiContext?.pattern || 'unknown',
      aiContext,
      longScore,
      shortScore,
    };

    return this.lastOutput;
  }
}

module.exports = MicroTrendAgent;
