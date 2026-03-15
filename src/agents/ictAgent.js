const indicatorService = require('../services/indicatorService');
const groqService = require('../services/groqService');

class ICTAgent {
  constructor() {
    this.name = 'ict';
    this.lastOutput = null;
  }

  async analyze(candles15m, candles1h) {
    const fvgs15m = indicatorService.findFairValueGaps(candles15m);
    const fvgs1h = indicatorService.findFairValueGaps(candles1h);
    const levels = indicatorService.findSupportResistance(candles15m, 50);
    const sweeps = indicatorService.detectLiquiditySweeps(candles15m, levels);
    const orderBlocks = indicatorService.findOrderBlocks(candles15m, 20);
    const structure = indicatorService.detectMarketStructure(candles15m);
    const premiumDiscount = indicatorService.getPremiumDiscount(candles15m, 50);
    const currentPrice = candles15m[candles15m.length - 1].close;

    const aiContext = await groqService.analyze(
      `BTC/USDT is at $${currentPrice} RIGHT NOW. Evaluate ICT conditions for entering at this exact price:
       Current zone: ${premiumDiscount.zone} (${premiumDiscount.zone === 'discount' ? 'favorable for longs' : premiumDiscount.zone === 'premium' ? 'favorable for shorts' : 'neutral'})
       Recent liquidity sweeps: ${JSON.stringify(sweeps)}
       Nearby order blocks: ${JSON.stringify(orderBlocks.slice(-3))}
       Unfilled FVGs: ${fvgs15m.length}
       Is NOW a good ICT entry at $${currentPrice}? Answer as JSON: { "entryNow": "yes or no", "bias": "bullish or bearish or neutral", "reasoning": "brief" }`
    );

    // Score /10
    let longScore = 5;
    let shortScore = 5;

    // Liquidity sweeps
    const buySweeps = sweeps.filter(s => s.type === 'buy_side_sweep').length;
    const sellSweeps = sweeps.filter(s => s.type === 'sell_side_sweep').length;
    if (buySweeps > 0) { longScore += 2; shortScore -= 1; }
    if (sellSweeps > 0) { shortScore += 2; longScore -= 1; }

    // Premium/Discount zone
    if (premiumDiscount.zone === 'discount') { longScore += 2; shortScore -= 1; }
    if (premiumDiscount.zone === 'premium') { shortScore += 2; longScore -= 1; }

    // Market structure shift (BOS)
    if (structure.bos) {
      if (structure.bos.type === 'bullish_bos') { longScore += 2; shortScore -= 1; }
      if (structure.bos.type === 'bearish_bos') { shortScore += 2; longScore -= 1; }
    }

    // Bullish order blocks nearby = support
    const bullishOBs = orderBlocks.filter(ob => ob.type === 'bullish');
    const bearishOBs = orderBlocks.filter(ob => ob.type === 'bearish');
    if (bullishOBs.length > bearishOBs.length) { longScore += 1; }
    if (bearishOBs.length > bullishOBs.length) { shortScore += 1; }

    longScore = Math.max(1, Math.min(10, longScore));
    shortScore = Math.max(1, Math.min(10, shortScore));

    this.lastOutput = {
      agent: this.name,
      timestamp: Date.now(),
      currentPrice,
      fairValueGaps: { '15m': fvgs15m.slice(-5), '1h': fvgs1h.slice(-5) },
      liquiditySweeps: sweeps,
      orderBlocks: orderBlocks.slice(-5),
      marketStructureShift: structure.bos,
      premiumDiscount,
      aiContext,
      longScore,
      shortScore,
    };

    return this.lastOutput;
  }
}

module.exports = ICTAgent;
