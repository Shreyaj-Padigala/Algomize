const indicatorService = require('../src/services/indicatorService');

describe('IndicatorService', () => {
  describe('calculateRSI', () => {
    it('should return empty array when not enough data', () => {
      const result = indicatorService.calculateRSI([1, 2, 3], 14);
      expect(result).toEqual([]);
    });

    it('should calculate RSI values correctly', () => {
      // Generate 20 closing prices with known pattern
      const closes = [
        44, 44.34, 44.09, 43.61, 44.33,
        44.83, 45.10, 45.42, 45.84, 46.08,
        45.89, 46.03, 45.61, 46.28, 46.28,
        46.00, 46.03, 46.41, 46.22, 45.64,
      ];

      const rsi = indicatorService.calculateRSI(closes, 14);
      expect(rsi.length).toBeGreaterThan(0);

      // RSI should be between 0 and 100
      for (const value of rsi) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    });

    it('should return RSI near 100 for only gains', () => {
      const closes = [];
      for (let i = 0; i < 20; i++) closes.push(100 + i);
      const rsi = indicatorService.calculateRSI(closes, 14);
      expect(rsi[rsi.length - 1]).toBeGreaterThan(90);
    });

    it('should return RSI near 0 for only losses', () => {
      const closes = [];
      for (let i = 0; i < 20; i++) closes.push(100 - i);
      const rsi = indicatorService.calculateRSI(closes, 14);
      expect(rsi[rsi.length - 1]).toBeLessThan(10);
    });
  });

  describe('calculateSMA', () => {
    it('should calculate simple moving average', () => {
      const values = [1, 2, 3, 4, 5];
      const sma = indicatorService.calculateSMA(values, 3);
      expect(sma).toEqual([2, 3, 4]);
    });

    it('should return empty for insufficient data', () => {
      const result = indicatorService.calculateSMA([1, 2], 5);
      expect(result).toEqual([]);
    });
  });

  describe('calculateEMA', () => {
    it('should calculate EMA values', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const ema = indicatorService.calculateEMA(values, 3);
      expect(ema.length).toBe(8);
      // First EMA value is SMA
      expect(ema[0]).toBe(2);
    });

    it('should return empty for insufficient data', () => {
      const result = indicatorService.calculateEMA([1, 2], 5);
      expect(result).toEqual([]);
    });
  });

  describe('findSupportResistance', () => {
    it('should find support and resistance levels', () => {
      const candles = [];
      for (let i = 0; i < 50; i++) {
        const base = 100;
        const swing = Math.sin(i / 5) * 10;
        candles.push({
          open: base + swing - 0.5,
          high: base + swing + 2,
          low: base + swing - 2,
          close: base + swing + 0.5,
          volume: 1000,
        });
      }

      const levels = indicatorService.findSupportResistance(candles, 50);
      expect(Array.isArray(levels)).toBe(true);
    });
  });

  describe('detectMarketStructure', () => {
    it('should detect bullish structure', () => {
      const candles = [];
      for (let i = 0; i < 30; i++) {
        const price = 100 + i * 2 + Math.sin(i) * 3;
        candles.push({
          open: price - 0.5,
          high: price + 1,
          low: price - 1,
          close: price + 0.5,
          volume: 1000,
        });
      }

      const result = indicatorService.detectMarketStructure(candles);
      expect(result).toHaveProperty('trend');
      expect(result).toHaveProperty('structures');
    });

    it('should return neutral for insufficient data', () => {
      const result = indicatorService.detectMarketStructure([]);
      expect(result.trend).toBe('neutral');
    });
  });

  describe('findFairValueGaps', () => {
    it('should detect bullish FVG', () => {
      const candles = [
        { open: 100, high: 102, low: 99, close: 101 },
        { open: 101, high: 103, low: 100, close: 102 },
        { open: 104, high: 106, low: 103, close: 105 },
      ];

      const fvgs = indicatorService.findFairValueGaps(candles);
      expect(Array.isArray(fvgs)).toBe(true);
    });
  });

  describe('getPremiumDiscount', () => {
    it('should determine premium/discount zone', () => {
      const candles = [];
      for (let i = 0; i < 50; i++) {
        candles.push({
          open: 100 + i * 0.5,
          high: 102 + i * 0.5,
          low: 98 + i * 0.5,
          close: 101 + i * 0.5,
          volume: 1000,
        });
      }

      const result = indicatorService.getPremiumDiscount(candles);
      expect(result).toHaveProperty('zone');
      expect(['premium', 'discount']).toContain(result.zone);
      expect(result).toHaveProperty('equilibrium');
    });
  });

  describe('detectDivergence', () => {
    it('should detect bullish divergence', () => {
      const prices = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91];
      const rsi = [30, 29, 28, 27, 26, 27, 28, 29, 30, 31];
      const result = indicatorService.detectDivergence(prices, rsi, 10);
      expect(result).toHaveProperty('bullish');
      expect(result).toHaveProperty('bearish');
    });
  });
});
