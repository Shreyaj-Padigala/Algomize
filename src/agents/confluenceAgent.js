const indicatorService = require('../services/indicatorService');
const groqService = require('../services/groqService');

class ConfluenceAgent {
  constructor() {
    this.name = 'confluence';
    this.lastOutput = null;
  }

  async analyze(candles15m, candles1h) {
    const levels15m = indicatorService.findSupportResistance(candles15m, 50);
    const levels1h = indicatorService.findSupportResistance(candles1h, 50);
    const currentPrice = candles15m[candles15m.length - 1].close;

    const allLevels = [...levels15m, ...levels1h];
    const nearbyLevels = allLevels.filter(
      (l) => Math.abs(l.price - currentPrice) / currentPrice < 0.005
    );

    const reactions = this._findPriorReactions(candles15m, allLevels);

    const aiContext = await groqService.analyze(
      `Interpret these support/resistance levels for BTC/USDT trading context.
       Current price: ${currentPrice}
       Support levels: ${JSON.stringify(levels15m.filter(l => l.type === 'support').slice(0, 3))}
       Resistance levels: ${JSON.stringify(levels15m.filter(l => l.type === 'resistance').slice(0, 3))}
       Nearby levels count: ${nearbyLevels.length}
       Do NOT calculate anything. Just interpret the significance.`
    );

    // Score /10
    let longScore = 5;
    let shortScore = 5;

    const nearSupports = nearbyLevels.filter(l => l.type === 'support');
    const nearResistances = nearbyLevels.filter(l => l.type === 'resistance');

    // Near strong support = bullish bounce potential
    if (nearSupports.length > 0) {
      const strongSupport = nearSupports.some(l => l.strength >= 2);
      longScore += strongSupport ? 3 : 2;
      shortScore -= 1;
    }

    // Near strong resistance = bearish rejection potential
    if (nearResistances.length > 0) {
      const strongResistance = nearResistances.some(l => l.strength >= 2);
      shortScore += strongResistance ? 3 : 2;
      longScore -= 1;
    }

    // If in open space, neutral
    if (nearbyLevels.length === 0) {
      longScore = 5;
      shortScore = 5;
    }

    longScore = Math.max(1, Math.min(10, longScore));
    shortScore = Math.max(1, Math.min(10, shortScore));

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
      longScore,
      shortScore,
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
