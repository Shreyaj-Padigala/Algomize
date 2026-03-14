const indicatorService = require('../services/indicatorService');
const groqService = require('../services/groqService');

class MacroTrendAgent {
  constructor() {
    this.name = 'macroTrend';
    this.lastOutput = null;
  }

  async analyze(candles1h) {
    const structure = indicatorService.detectMarketStructure(candles1h);
    const closes = candles1h.map((c) => c.close);
    const ema50 = indicatorService.calculateEMA(closes, 50);
    const ema200 = indicatorService.calculateEMA(closes, 200);

    const currentPrice = closes[closes.length - 1];
    const currentEma50 = ema50.length > 0 ? ema50[ema50.length - 1] : null;
    const currentEma200 = ema200.length > 0 ? ema200[ema200.length - 1] : null;

    let directionalBias = 'neutral';
    if (currentEma50 && currentEma200) {
      directionalBias = currentEma50 > currentEma200 ? 'bullish' : 'bearish';
    }

    let macroTrend = 'neutral';
    if (structure.trend === directionalBias) {
      macroTrend = structure.trend;
    } else if (structure.trend !== 'neutral') {
      macroTrend = structure.trend;
    } else {
      macroTrend = directionalBias;
    }

    // Generate ASCII chart for AI to read the pattern
    const asciiChart = indicatorService.generateAsciiChart(candles1h, 48, 18);

    const aiContext = await groqService.analyze(
      `You are reading a 1-hour BTC/USDT candlestick chart (ASCII representation).
'+' = bullish candle, '#' = bearish candle, '|' = wick.

CHART:
${asciiChart}

Additional data:
- Market structure trend: ${structure.trend}
- Directional bias (EMA50 vs EMA200): ${directionalBias}
- Combined macro trend: ${macroTrend}
- Price vs EMA50: ${currentEma50 ? (currentPrice > currentEma50 ? 'above' : 'below') : 'n/a'}

Based on the visual chart pattern and data, provide your analysis as JSON:
{
  "pattern": "what macro chart pattern you see",
  "bias": "bullish or bearish or neutral",
  "reasoning": "brief explanation"
}`
    );

    // Score /10
    let longScore = 5;
    let shortScore = 5;

    // Macro trend scoring (higher weight for macro)
    if (macroTrend === 'bullish') { longScore += 2; shortScore -= 1; }
    if (macroTrend === 'bearish') { shortScore += 2; longScore -= 1; }

    // Directional bias
    if (directionalBias === 'bullish') { longScore += 1; }
    if (directionalBias === 'bearish') { shortScore += 1; }

    // BOS
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
      timeframe: '1h',
      timestamp: Date.now(),
      macroTrend,
      structureTrend: structure.trend,
      directionalBias,
      structures: structure.structures,
      bos: structure.bos,
      currentPrice,
      pattern: aiContext?.pattern || 'unknown',
      aiContext,
      longScore,
      shortScore,
    };

    return this.lastOutput;
  }
}

module.exports = MacroTrendAgent;
