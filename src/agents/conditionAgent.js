const indicatorService = require('../services/indicatorService');
const novaService = require('../services/novaService');

/**
 * ConditionAgent evaluates a single user-defined trading condition
 * and returns a score out of 10 for long and short.
 *
 * Supported condition types:
 * - rsi: RSI-based (e.g., "RSI over 80 Short, RSI under 25 Long")
 * - trend_up: Price trending upwards → Long
 * - trend_down: Price trending downwards → Short
 * - major_move_up: Price made major upside moves at this price → Long at X leverage
 * - major_move_down: Price made major downside moves at this price → Short at X leverage
 */
class ConditionAgent {
  constructor(conditionIndex) {
    this.name = `condition_${conditionIndex + 1}`;
    this.index = conditionIndex;
    this.lastOutput = null;
  }

  async analyze(candles15m, candles1h, condition) {
    if (!condition || !condition.type) {
      this.lastOutput = { longScore: 5, shortScore: 5, summary: 'No condition configured' };
      return this.lastOutput;
    }

    let result;
    switch (condition.type) {
      case 'rsi':
        result = this._analyzeRSI(candles15m, condition);
        break;
      case 'trend_up':
        result = this._analyzeTrendUp(candles15m, candles1h, condition);
        break;
      case 'trend_down':
        result = this._analyzeTrendDown(candles15m, candles1h, condition);
        break;
      case 'major_move_up':
        result = this._analyzeMajorMoveUp(candles15m, candles1h, condition);
        break;
      case 'major_move_down':
        result = this._analyzeMajorMoveDown(candles15m, candles1h, condition);
        break;
      default:
        result = { longScore: 5, shortScore: 5, summary: `Unknown condition type: ${condition.type}` };
    }

    this.lastOutput = {
      agent: this.name,
      conditionType: condition.type,
      description: condition.description || '',
      timestamp: Date.now(),
      ...result,
    };

    return this.lastOutput;
  }

  _analyzeRSI(candles15m, condition) {
    const rsiValues = indicatorService.calculateRSI(candles15m, 14);
    const currentRSI = rsiValues[rsiValues.length - 1];

    const shortThreshold = condition.shortAbove || 80;
    const longThreshold = condition.longBelow || 25;

    let longScore = 5;
    let shortScore = 5;

    if (currentRSI >= shortThreshold) {
      // Overbought → Short signal
      const intensity = Math.min((currentRSI - shortThreshold) / (100 - shortThreshold), 1);
      shortScore = Math.round((7 + intensity * 3) * 10) / 10;
      longScore = Math.round((10 - shortScore) * 10) / 10;
    } else if (currentRSI <= longThreshold) {
      // Oversold → Long signal
      const intensity = Math.min((longThreshold - currentRSI) / longThreshold, 1);
      longScore = Math.round((7 + intensity * 3) * 10) / 10;
      shortScore = Math.round((10 - longScore) * 10) / 10;
    } else {
      // Middle zone — lean based on RSI position
      const midpoint = (shortThreshold + longThreshold) / 2;
      if (currentRSI > midpoint) {
        // Leaning overbought
        const lean = (currentRSI - midpoint) / (shortThreshold - midpoint);
        shortScore = Math.round((5 + lean * 2) * 10) / 10;
        longScore = Math.round((10 - shortScore) * 10) / 10;
      } else {
        // Leaning oversold
        const lean = (midpoint - currentRSI) / (midpoint - longThreshold);
        longScore = Math.round((5 + lean * 2) * 10) / 10;
        shortScore = Math.round((10 - longScore) * 10) / 10;
      }
    }

    // Check for RSI divergences
    const divergences = indicatorService.detectDivergences(candles15m, rsiValues);
    if (divergences.regular === 'bullish' || divergences.hidden === 'bullish') {
      longScore = Math.min(10, longScore + 1.5);
      shortScore = Math.max(0, shortScore - 1.5);
    }
    if (divergences.regular === 'bearish' || divergences.hidden === 'bearish') {
      shortScore = Math.min(10, shortScore + 1.5);
      longScore = Math.max(0, longScore - 1.5);
    }

    longScore = Math.round(longScore * 10) / 10;
    shortScore = Math.round(shortScore * 10) / 10;

    return {
      longScore,
      shortScore,
      currentRSI: Math.round(currentRSI * 10) / 10,
      divergence: divergences.regular || divergences.hidden || 'none',
      summary: `RSI: ${Math.round(currentRSI * 10) / 10} | ${currentRSI >= shortThreshold ? 'Overbought' : currentRSI <= longThreshold ? 'Oversold' : 'Neutral'}`,
    };
  }

  _analyzeTrendUp(candles15m, candles1h, condition) {
    // Analyze if price is trending upwards
    const structures15m = indicatorService.detectMarketStructure(candles15m);
    const structures1h = indicatorService.detectMarketStructure(candles1h);

    const ema20 = indicatorService.calculateEMA(candles15m.map(c => c.close), 20);
    const ema50 = indicatorService.calculateEMA(candles15m.map(c => c.close), 50);

    const lastEma20 = ema20[ema20.length - 1];
    const lastEma50 = ema50[ema50.length - 1];
    const price = candles15m[candles15m.length - 1].close;

    let longScore = 5;
    let shortScore = 5;
    let trend = 'neutral';

    // EMA alignment check
    if (price > lastEma20 && lastEma20 > lastEma50) {
      longScore += 2;
      shortScore -= 2;
      trend = 'bullish';
    } else if (price < lastEma20 && lastEma20 < lastEma50) {
      longScore -= 1.5;
      shortScore += 1.5;
      trend = 'bearish';
    }

    // Structure check (HH/HL = bullish)
    const recentStructures = structures15m.slice(-5);
    const hhCount = recentStructures.filter(s => s.type === 'HH').length;
    const hlCount = recentStructures.filter(s => s.type === 'HL').length;
    const llCount = recentStructures.filter(s => s.type === 'LL').length;
    const lhCount = recentStructures.filter(s => s.type === 'LH').length;

    if (hhCount + hlCount > llCount + lhCount) {
      longScore += 1.5;
      shortScore -= 1.5;
    } else if (llCount + lhCount > hhCount + hlCount) {
      longScore -= 1;
      shortScore += 1;
    }

    // BOS check on 1h
    const bos1h = this._detectBOS(structures1h);
    if (bos1h === 'bullish') {
      longScore += 1;
      shortScore -= 1;
    } else if (bos1h === 'bearish') {
      longScore -= 0.5;
      shortScore += 0.5;
    }

    // 2-day price movement
    const twoDaysAgo = candles15m[Math.max(0, candles15m.length - 192)];
    if (twoDaysAgo && price > twoDaysAgo.close) {
      longScore += 0.5;
      shortScore -= 0.5;
    }

    longScore = Math.round(Math.max(0, Math.min(10, longScore)) * 10) / 10;
    shortScore = Math.round(Math.max(0, Math.min(10, shortScore)) * 10) / 10;

    return {
      longScore,
      shortScore,
      trend,
      summary: `Trend: ${trend} | EMA20>${lastEma20 > lastEma50 ? 'EMA50' : '<EMA50'}`,
    };
  }

  _analyzeTrendDown(candles15m, candles1h, condition) {
    // Mirror of trend_up but looking for downtrends
    const result = this._analyzeTrendUp(candles15m, candles1h, condition);
    // Swap scores: what's good for long in trend_up is good for short in trend_down
    return {
      longScore: result.shortScore,
      shortScore: result.longScore,
      trend: result.trend === 'bullish' ? 'bearish' : result.trend === 'bearish' ? 'bullish' : 'neutral',
      summary: result.summary.replace('Trend:', 'Inv. Trend:'),
    };
  }

  _analyzeMajorMoveUp(candles15m, candles1h, condition) {
    // Check if price made major upside movements at current price level
    const currentPrice = candles15m[candles15m.length - 1].close;
    const supportResistance = indicatorService.findSupportResistance(candles1h);

    let longScore = 5;
    let shortScore = 5;
    let confluence = false;

    // Check if current price is near a level where major upward moves occurred
    const priceRange = currentPrice * 0.005; // 0.5% range
    const nearbyLevels = supportResistance.filter(
      level => Math.abs(level.price - currentPrice) < priceRange
    );

    // Check recent major upward moves
    const recentCandles = candles1h.slice(-48); // 2 days
    let majorUpMoves = 0;
    for (let i = 1; i < recentCandles.length; i++) {
      const movePercent = ((recentCandles[i].close - recentCandles[i - 1].close) / recentCandles[i - 1].close) * 100;
      if (movePercent > 0.5) majorUpMoves++;
    }

    if (nearbyLevels.length > 0 && majorUpMoves > 3) {
      // Confluence: near key level AND major upward moves happened
      confluence = true;
      longScore = 7 + Math.min(nearbyLevels.length, 3);
      shortScore = 10 - longScore;
    } else if (majorUpMoves > 3) {
      longScore = 6.5;
      shortScore = 3.5;
    } else if (nearbyLevels.length > 0) {
      longScore = 6;
      shortScore = 4;
    }

    // Check for break of structure (HH after LL/LH series)
    const structures = indicatorService.detectMarketStructure(candles15m);
    const recent = structures.slice(-6);
    const hasDowntrend = recent.some(s => s.type === 'LL') && recent.some(s => s.type === 'LH');
    const hasBreakout = recent.length > 0 && recent[recent.length - 1].type === 'HH';

    if (hasDowntrend && hasBreakout) {
      // Structure break → stronger long signal
      longScore = Math.min(10, longScore + 1.5);
      shortScore = Math.max(0, shortScore - 1.5);
    }

    longScore = Math.round(Math.max(0, Math.min(10, longScore)) * 10) / 10;
    shortScore = Math.round(Math.max(0, Math.min(10, shortScore)) * 10) / 10;

    const leverage = condition.leverage || null;
    const exitStrategy = condition.exitStrategy || 'Default: exit at -20% PNL';

    return {
      longScore,
      shortScore,
      confluence,
      majorUpMoves,
      nearbyLevels: nearbyLevels.length,
      leverage,
      exitStrategy,
      summary: `Major Up Moves: ${majorUpMoves} | ${confluence ? 'CONFLUENCE' : 'No confluence'} | Levels: ${nearbyLevels.length}`,
    };
  }

  _analyzeMajorMoveDown(candles15m, candles1h, condition) {
    // Check if price made major downside movements at current price level
    const currentPrice = candles15m[candles15m.length - 1].close;
    const supportResistance = indicatorService.findSupportResistance(candles1h);

    let longScore = 5;
    let shortScore = 5;
    let confluence = false;

    const priceRange = currentPrice * 0.005;
    const nearbyLevels = supportResistance.filter(
      level => Math.abs(level.price - currentPrice) < priceRange
    );

    const recentCandles = candles1h.slice(-48);
    let majorDownMoves = 0;
    for (let i = 1; i < recentCandles.length; i++) {
      const movePercent = ((recentCandles[i].close - recentCandles[i - 1].close) / recentCandles[i - 1].close) * 100;
      if (movePercent < -0.5) majorDownMoves++;
    }

    if (nearbyLevels.length > 0 && majorDownMoves > 3) {
      confluence = true;
      shortScore = 7 + Math.min(nearbyLevels.length, 3);
      longScore = 10 - shortScore;
    } else if (majorDownMoves > 3) {
      shortScore = 6.5;
      longScore = 3.5;
    } else if (nearbyLevels.length > 0) {
      shortScore = 6;
      longScore = 4;
    }

    // Check for break of structure (LL after HH/HL series)
    const structures = indicatorService.detectMarketStructure(candles15m);
    const recent = structures.slice(-6);
    const hasUptrend = recent.some(s => s.type === 'HH') && recent.some(s => s.type === 'HL');
    const hasBreakdown = recent.length > 0 && recent[recent.length - 1].type === 'LL';

    if (hasUptrend && hasBreakdown) {
      shortScore = Math.min(10, shortScore + 1.5);
      longScore = Math.max(0, longScore - 1.5);
    }

    longScore = Math.round(Math.max(0, Math.min(10, longScore)) * 10) / 10;
    shortScore = Math.round(Math.max(0, Math.min(10, shortScore)) * 10) / 10;

    const leverage = condition.leverage || null;
    const exitStrategy = condition.exitStrategy || 'Default: exit at -20% PNL';

    return {
      longScore,
      shortScore,
      confluence,
      majorDownMoves,
      nearbyLevels: nearbyLevels.length,
      leverage,
      exitStrategy,
      summary: `Major Down Moves: ${majorDownMoves} | ${confluence ? 'CONFLUENCE' : 'No confluence'} | Levels: ${nearbyLevels.length}`,
    };
  }

  _detectBOS(structures) {
    if (structures.length < 3) return null;
    const last = structures[structures.length - 1];
    const prev = structures.slice(-4, -1);

    if (last.type === 'HH' && prev.some(s => s.type === 'LL' || s.type === 'LH')) {
      return 'bullish';
    }
    if (last.type === 'LL' && prev.some(s => s.type === 'HH' || s.type === 'HL')) {
      return 'bearish';
    }
    return null;
  }
}

module.exports = ConditionAgent;
