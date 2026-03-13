const indicatorService = require('../services/indicatorService');
const geminiService = require('../services/geminiService');

class ICTAgent {
  constructor() {
    this.name = 'ict';
    this.lastOutput = null;
  }

  async analyze(candles15m, candles1h) {
    // Fair Value Gaps
    const fvgs15m = indicatorService.findFairValueGaps(candles15m);
    const fvgs1h = indicatorService.findFairValueGaps(candles1h);

    // Support/resistance for liquidity detection
    const levels = indicatorService.findSupportResistance(candles15m, 50);

    // Liquidity sweeps
    const sweeps = indicatorService.detectLiquiditySweeps(candles15m, levels);

    // Order blocks
    const orderBlocks = indicatorService.findOrderBlocks(candles15m, 20);

    // Market structure shifts
    const structure = indicatorService.detectMarketStructure(candles15m);

    // Premium/Discount zones
    const premiumDiscount = indicatorService.getPremiumDiscount(candles15m, 50);

    const currentPrice = candles15m[candles15m.length - 1].close;

    // Gemini for contextual ICT interpretation only
    const aiContext = await geminiService.analyze(
      `Interpret ICT concepts for BTC/USDT:
       FVGs (15m): ${fvgs15m.length} found, recent: ${JSON.stringify(fvgs15m.slice(-3))}
       Liquidity sweeps: ${JSON.stringify(sweeps)}
       Order blocks: ${JSON.stringify(orderBlocks.slice(-3))}
       Zone: ${premiumDiscount.zone}
       Do NOT calculate anything.`
    );

    this.lastOutput = {
      agent: this.name,
      timestamp: Date.now(),
      currentPrice,
      fairValueGaps: {
        '15m': fvgs15m.slice(-5),
        '1h': fvgs1h.slice(-5),
      },
      liquiditySweeps: sweeps,
      orderBlocks: orderBlocks.slice(-5),
      marketStructureShift: structure.bos,
      premiumDiscount,
      aiContext,
    };

    return this.lastOutput;
  }
}

module.exports = ICTAgent;
