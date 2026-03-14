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

    const aiContext = await groqService.analyze(
      `Interpret 15-minute trend for BTC/USDT.
       Structure trend: ${structure.trend}
       Recent structures: ${JSON.stringify(structure.structures.slice(-4))}
       BOS: ${JSON.stringify(structure.bos)}
       EMA trend: ${emaTrend}
       Do NOT perform calculations.`
    );

    this.lastOutput = {
      agent: this.name,
      timeframe: '15m',
      timestamp: Date.now(),
      trend: structure.trend,
      structures: structure.structures,
      bos: structure.bos,
      emaTrend,
      currentPrice,
      aiContext,
    };

    return this.lastOutput;
  }
}

module.exports = MicroTrendAgent;
