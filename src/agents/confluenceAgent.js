const indicatorService = require('../services/indicatorService');
const geminiService = require('../services/geminiService');

class ConfluenceAgent {
  constructor() {
    this.name = 'confluence';
    this.lastOutput = null;
  }

  async analyze(candles15m, candles1h) {
    // Find support and resistance on both timeframes
    const levels15m = indicatorService.findSupportResistance(candles15m, 50);
    const levels1h = indicatorService.findSupportResistance(candles1h, 50);

    const currentPrice = candles15m[candles15m.length - 1].close;

    // Find proximity to key levels
    const allLevels = [...levels15m, ...levels1h];
    const nearbyLevels = allLevels.filter(
      (l) => Math.abs(l.price - currentPrice) / currentPrice < 0.005
    );

    // Detect prior reactions at these levels
    const reactions = this._findPriorReactions(candles15m, allLevels);

    // Use Gemini for contextual interpretation only
    const aiContext = await geminiService.analyze(
      `Interpret these support/resistance levels for BTC/USDT trading context.
       Current price: ${currentPrice}
       Support levels: ${JSON.stringify(levels15m.filter(l => l.type === 'support').slice(0, 3))}
       Resistance levels: ${JSON.stringify(levels15m.filter(l => l.type === 'resistance').slice(0, 3))}
       Nearby levels count: ${nearbyLevels.length}
       Do NOT calculate anything. Just interpret the significance.`
    );

    this.lastOutput = {
      agent: this.name,
      timestamp: Date.now(),
      currentPrice,
      supportLevels: allLevels.filter((l) => l.type === 'support').slice(0, 5),
      resistanceLevels: allLevels.filter((l) => l.type === 'resistance').slice(0, 5),
      nearbyLevels,
      priorReactions: reactions,
      proximitySignal: nearbyLevels.length > 0 ? 'near_key_level' : 'in_open_space',
      aiContext,
    };

    return this.lastOutput;
  }

  _findPriorReactions(candles, levels) {
    const reactions = [];
    for (const level of levels.slice(0, 5)) {
      let bounceCount = 0;
      for (const candle of candles) {
        const threshold = level.price * 0.001;
        if (Math.abs(candle.low - level.price) < threshold ||
            Math.abs(candle.high - level.price) < threshold) {
          bounceCount++;
        }
      }
      if (bounceCount > 1) {
        reactions.push({ level: level.price, type: level.type, bounces: bounceCount });
      }
    }
    return reactions;
  }
}

module.exports = ConfluenceAgent;
