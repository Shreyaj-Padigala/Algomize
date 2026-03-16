const indicatorService = require('../services/indicatorService');
const novaService = require('../services/novaService');

/**
 * Condition Two Agent — evaluates the user's second trading condition
 * on a scale of 1-10 for both long and short positions.
 */
class ConditionTwoAgent {
  constructor() {
    this.name = 'condition_2';
    this.lastOutput = null;
  }

  async analyze(candles15m, candles1h, conditionDescription) {
    if (!conditionDescription) {
      this.lastOutput = {
        agent: this.name,
        longScore: 5,
        shortScore: 5,
        summary: 'No condition provided',
        timestamp: Date.now(),
      };
      return this.lastOutput;
    }

    const marketData = this._gatherMarketData(candles15m, candles1h);
    const scores = await this._evaluateWithAI(conditionDescription, marketData);

    this.lastOutput = {
      agent: this.name,
      conditionDescription,
      ...scores,
      timestamp: Date.now(),
    };

    return this.lastOutput;
  }

  _gatherMarketData(candles15m, candles1h) {
    const closes15m = candles15m.map(c => c.close);
    const currentPrice = closes15m[closes15m.length - 1];

    const rsiValues = indicatorService.calculateRSI(closes15m, 14);
    const currentRSI = rsiValues.length > 0 ? Math.round(rsiValues[rsiValues.length - 1] * 10) / 10 : null;

    const ema20 = indicatorService.calculateEMA(closes15m, 20);
    const ema50 = indicatorService.calculateEMA(closes15m, 50);
    const lastEma20 = ema20.length > 0 ? ema20[ema20.length - 1] : null;
    const lastEma50 = ema50.length > 0 ? ema50[ema50.length - 1] : null;

    const structure = indicatorService.detectMarketStructure(candles15m);
    const levels = indicatorService.findSupportResistance(candles1h);

    const priceChange24h = candles15m.length >= 96
      ? ((currentPrice - candles15m[candles15m.length - 96].close) / candles15m[candles15m.length - 96].close * 100).toFixed(2)
      : 'N/A';
    const priceChange2d = candles15m.length >= 192
      ? ((currentPrice - candles15m[candles15m.length - 192].close) / candles15m[candles15m.length - 192].close * 100).toFixed(2)
      : 'N/A';

    const chart = indicatorService.generateAsciiChart(candles15m, 48, 15);

    return {
      currentPrice,
      rsi: currentRSI,
      ema20: lastEma20 ? Math.round(lastEma20 * 100) / 100 : null,
      ema50: lastEma50 ? Math.round(lastEma50 * 100) / 100 : null,
      trend: structure.trend,
      recentStructures: structure.structures.slice(-5).map(s => s.type).join(', '),
      bos: structure.bos ? structure.bos.type : 'none',
      supportLevels: levels.filter(l => l.type === 'support').slice(0, 3).map(l => l.price),
      resistanceLevels: levels.filter(l => l.type === 'resistance').slice(0, 3).map(l => l.price),
      priceChange24h,
      priceChange2d,
      chart,
    };
  }

  async _evaluateWithAI(conditionDescription, marketData) {
    const prompt = `You are a crypto trading condition evaluator for BTC/USDT.

USER'S TRADING CONDITION:
"${conditionDescription}"

CURRENT MARKET DATA:
- Price: $${marketData.currentPrice}
- RSI(14): ${marketData.rsi}
- EMA20: $${marketData.ema20} | EMA50: $${marketData.ema50}
- Trend: ${marketData.trend}
- Recent Structures: ${marketData.recentStructures}
- Break of Structure: ${marketData.bos}
- Support: ${marketData.supportLevels.join(', ')}
- Resistance: ${marketData.resistanceLevels.join(', ')}
- 24h Change: ${marketData.priceChange24h}%
- 2d Change: ${marketData.priceChange2d}%

PRICE CHART (15m candles, + = bullish, # = bearish):
${marketData.chart}

Based on this market data, evaluate the user's condition and score it:
- longScore: 1-10 (how strongly this condition suggests going LONG)
- shortScore: 1-10 (how strongly this condition suggests going SHORT)
- summary: Brief 1-sentence explanation

IMPORTANT: longScore + shortScore should roughly equal 10. Be decisive - avoid giving both scores near 5.

Respond ONLY with valid JSON: {"longScore": X, "shortScore": Y, "summary": "..."}`;

    try {
      const result = await novaService.analyze(prompt);
      const longScore = Math.max(1, Math.min(10, Math.round(result.longScore || 5)));
      const shortScore = Math.max(1, Math.min(10, Math.round(result.shortScore || 5)));
      return {
        longScore,
        shortScore,
        summary: result.summary || `Evaluated: ${conditionDescription.substring(0, 50)}...`,
      };
    } catch (err) {
      return this._fallbackEvaluation(marketData);
    }
  }

  _fallbackEvaluation(marketData) {
    let longScore = 5;
    let shortScore = 5;

    if (marketData.rsi !== null) {
      if (marketData.rsi > 70) { shortScore += 2; longScore -= 2; }
      else if (marketData.rsi < 30) { longScore += 2; shortScore -= 2; }
    }

    if (marketData.trend === 'bullish') { longScore += 1; shortScore -= 1; }
    else if (marketData.trend === 'bearish') { shortScore += 1; longScore -= 1; }

    longScore = Math.max(1, Math.min(10, longScore));
    shortScore = Math.max(1, Math.min(10, shortScore));

    return { longScore, shortScore, summary: `RSI: ${marketData.rsi} | Trend: ${marketData.trend} (AI unavailable)` };
  }
}

module.exports = ConditionTwoAgent;
