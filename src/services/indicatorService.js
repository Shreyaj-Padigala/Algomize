/**
 * All mathematical calculations are implemented manually in code.
 * No LLM is used for any numerical computation.
 */

class IndicatorService {
  /**
   * Calculate RSI (Relative Strength Index) manually.
   * @param {number[]} closes - Array of closing prices (oldest first)
   * @param {number} period - RSI period (default 14)
   * @returns {number[]} Array of RSI values
   */
  calculateRSI(closes, period = 14) {
    if (closes.length < period + 1) return [];

    const rsiValues = [];
    const gains = [];
    const losses = [];

    // Calculate initial gains and losses
    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    let avgGain = gains.reduce((sum, g) => sum + g, 0) / period;
    let avgLoss = losses.reduce((sum, l) => sum + l, 0) / period;

    // First RSI
    const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - 100 / (1 + firstRS));

    // Subsequent RSI values using smoothed averages
    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiValues.push(100 - 100 / (1 + rs));
    }

    return rsiValues;
  }

  /**
   * Detect RSI divergence.
   * @param {number[]} prices - Price array
   * @param {number[]} rsiValues - RSI array
   * @param {number} lookback - Lookback window
   */
  detectDivergence(prices, rsiValues, lookback = 10) {
    if (prices.length < lookback || rsiValues.length < lookback) {
      return { bullish: false, bearish: false };
    }

    const recentPrices = prices.slice(-lookback);
    const recentRSI = rsiValues.slice(-lookback);

    const priceMin1 = Math.min(...recentPrices.slice(0, 5));
    const priceMin2 = Math.min(...recentPrices.slice(5));
    const rsiMin1 = Math.min(...recentRSI.slice(0, 5));
    const rsiMin2 = Math.min(...recentRSI.slice(5));

    const priceMax1 = Math.max(...recentPrices.slice(0, 5));
    const priceMax2 = Math.max(...recentPrices.slice(5));
    const rsiMax1 = Math.max(...recentRSI.slice(0, 5));
    const rsiMax2 = Math.max(...recentRSI.slice(5));

    // Bullish: price makes lower low, RSI makes higher low
    const bullish = priceMin2 < priceMin1 && rsiMin2 > rsiMin1;
    // Bearish: price makes higher high, RSI makes lower high
    const bearish = priceMax2 > priceMax1 && rsiMax2 < rsiMax1;

    return { bullish, bearish };
  }

  /**
   * Calculate Simple Moving Average manually.
   */
  calculateSMA(values, period) {
    if (values.length < period) return [];
    const sma = [];
    for (let i = period - 1; i < values.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += values[j];
      }
      sma.push(sum / period);
    }
    return sma;
  }

  /**
   * Calculate EMA manually.
   */
  calculateEMA(values, period) {
    if (values.length < period) return [];
    const multiplier = 2 / (period + 1);
    const ema = [];

    // Seed with SMA
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    ema.push(sum / period);

    for (let i = period; i < values.length; i++) {
      ema.push((values[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
    }
    return ema;
  }

  /**
   * Detect support and resistance levels.
   */
  findSupportResistance(candles, lookback = 50) {
    const highs = candles.slice(-lookback).map((c) => c.high);
    const lows = candles.slice(-lookback).map((c) => c.low);
    const closes = candles.slice(-lookback).map((c) => c.close);

    const levels = [];

    // Find pivot highs and lows
    for (let i = 2; i < highs.length - 2; i++) {
      if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] &&
          highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
        levels.push({ type: 'resistance', price: highs[i], strength: 1 });
      }
      if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] &&
          lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
        levels.push({ type: 'support', price: lows[i], strength: 1 });
      }
    }

    // Cluster nearby levels
    const clustered = this._clusterLevels(levels, closes[closes.length - 1] * 0.002);
    return clustered;
  }

  _clusterLevels(levels, threshold) {
    const clusters = [];
    const used = new Set();

    for (let i = 0; i < levels.length; i++) {
      if (used.has(i)) continue;
      let sumPrice = levels[i].price;
      let count = 1;
      const type = levels[i].type;

      for (let j = i + 1; j < levels.length; j++) {
        if (used.has(j)) continue;
        if (levels[j].type === type && Math.abs(levels[j].price - levels[i].price) < threshold) {
          sumPrice += levels[j].price;
          count++;
          used.add(j);
        }
      }
      used.add(i);
      clusters.push({ type, price: sumPrice / count, strength: count });
    }

    return clusters.sort((a, b) => b.strength - a.strength);
  }

  /**
   * Detect market structure: HH, HL, LH, LL, BOS.
   */
  detectMarketStructure(candles) {
    if (candles.length < 10) return { trend: 'neutral', structures: [] };

    const swings = this._findSwingPoints(candles);
    const structures = [];
    let trend = 'neutral';

    for (let i = 1; i < swings.length; i++) {
      const prev = swings[i - 1];
      const curr = swings[i];

      if (curr.type === 'high' && prev.type === 'high') {
        if (curr.price > prev.price) structures.push({ type: 'HH', price: curr.price, index: curr.index });
        else structures.push({ type: 'LH', price: curr.price, index: curr.index });
      }
      if (curr.type === 'low' && prev.type === 'low') {
        if (curr.price > prev.price) structures.push({ type: 'HL', price: curr.price, index: curr.index });
        else structures.push({ type: 'LL', price: curr.price, index: curr.index });
      }
    }

    // Determine trend from last few structures
    const recent = structures.slice(-4);
    const hhCount = recent.filter((s) => s.type === 'HH' || s.type === 'HL').length;
    const llCount = recent.filter((s) => s.type === 'LL' || s.type === 'LH').length;

    if (hhCount > llCount) trend = 'bullish';
    else if (llCount > hhCount) trend = 'bearish';

    // Detect break of structure
    const bos = this._detectBOS(swings, candles);

    return { trend, structures, bos };
  }

  _findSwingPoints(candles) {
    const swings = [];
    for (let i = 2; i < candles.length - 2; i++) {
      if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i - 2].high &&
          candles[i].high > candles[i + 1].high && candles[i].high > candles[i + 2].high) {
        swings.push({ type: 'high', price: candles[i].high, index: i });
      }
      if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i - 2].low &&
          candles[i].low < candles[i + 1].low && candles[i].low < candles[i + 2].low) {
        swings.push({ type: 'low', price: candles[i].low, index: i });
      }
    }
    return swings;
  }

  _detectBOS(swings, candles) {
    if (swings.length < 3) return null;
    const lastCandle = candles[candles.length - 1];
    const swingHighs = swings.filter((s) => s.type === 'high');
    const swingLows = swings.filter((s) => s.type === 'low');

    if (swingHighs.length > 0) {
      const lastSwingHigh = swingHighs[swingHighs.length - 1];
      if (lastCandle.close > lastSwingHigh.price) {
        return { type: 'bullish_bos', price: lastSwingHigh.price };
      }
    }
    if (swingLows.length > 0) {
      const lastSwingLow = swingLows[swingLows.length - 1];
      if (lastCandle.close < lastSwingLow.price) {
        return { type: 'bearish_bos', price: lastSwingLow.price };
      }
    }
    return null;
  }

  /**
   * Detect Fair Value Gaps (ICT concept).
   */
  findFairValueGaps(candles) {
    const fvgs = [];
    for (let i = 2; i < candles.length; i++) {
      const prev = candles[i - 2];
      const curr = candles[i];

      // Bullish FVG: gap between candle[i-2].high and candle[i].low
      if (curr.low > prev.high) {
        fvgs.push({
          type: 'bullish',
          top: curr.low,
          bottom: prev.high,
          index: i,
        });
      }
      // Bearish FVG: gap between candle[i].high and candle[i-2].low
      if (curr.high < prev.low) {
        fvgs.push({
          type: 'bearish',
          top: prev.low,
          bottom: curr.high,
          index: i,
        });
      }
    }
    return fvgs;
  }

  /**
   * Detect liquidity sweeps.
   */
  detectLiquiditySweeps(candles, levels) {
    const sweeps = [];
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    for (const level of levels) {
      if (level.type === 'support') {
        // Sweep below support then close above
        if (lastCandle.low < level.price && lastCandle.close > level.price) {
          sweeps.push({ type: 'buy_side_sweep', level: level.price });
        }
      }
      if (level.type === 'resistance') {
        // Sweep above resistance then close below
        if (lastCandle.high > level.price && lastCandle.close < level.price) {
          sweeps.push({ type: 'sell_side_sweep', level: level.price });
        }
      }
    }
    return sweeps;
  }

  /**
   * Detect order blocks.
   */
  findOrderBlocks(candles, lookback = 20) {
    const blocks = [];
    const recent = candles.slice(-lookback);

    for (let i = 1; i < recent.length - 1; i++) {
      const prev = recent[i - 1];
      const curr = recent[i];
      const next = recent[i + 1];

      // Bullish OB: last bearish candle before strong bullish move
      if (curr.close < curr.open && next.close > next.open &&
          next.close > curr.high) {
        blocks.push({
          type: 'bullish',
          high: curr.high,
          low: curr.low,
          index: candles.length - lookback + i,
        });
      }
      // Bearish OB: last bullish candle before strong bearish move
      if (curr.close > curr.open && next.close < next.open &&
          next.close < curr.low) {
        blocks.push({
          type: 'bearish',
          high: curr.high,
          low: curr.low,
          index: candles.length - lookback + i,
        });
      }
    }
    return blocks;
  }

  /**
   * Determine premium/discount zones.
   */
  getPremiumDiscount(candles, lookback = 50) {
    const recent = candles.slice(-lookback);
    const highest = Math.max(...recent.map((c) => c.high));
    const lowest = Math.min(...recent.map((c) => c.low));
    const mid = (highest + lowest) / 2;
    const currentPrice = candles[candles.length - 1].close;

    return {
      highest,
      lowest,
      equilibrium: mid,
      currentPrice,
      zone: currentPrice > mid ? 'premium' : 'discount',
    };
  }
}

module.exports = new IndicatorService();
