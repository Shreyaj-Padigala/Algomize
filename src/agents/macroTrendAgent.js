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

    // Combine structure + EMA for macro trend
    let macroTrend = 'neutral';
    if (structure.trend === directionalBias) {
      macroTrend = structure.trend;
    } else if (structure.trend !== 'neutral') {
      macroTrend = structure.trend;
    } else {
      macroTrend = directionalBias;
    }

    const aiContext = await groqService.analyze(
      `Interpret 1-hour macro trend for BTC/USDT.
       Structure: ${structure.trend}, Directional bias: ${directionalBias}
       Combined macro trend: ${macroTrend}
       Do NOT perform calculations.`
    );

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
      aiContext,
    };

    return this.lastOutput;
  }
}

module.exports = MacroTrendAgent;
