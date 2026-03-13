const express = require('express');
const router = express.Router();
const marketService = require('../services/marketService');
const indicatorService = require('../services/indicatorService');

/**
 * @swagger
 * /api/chart/btcusdt/15m:
 *   get:
 *     summary: Get 15m chart data with indicators
 */
router.get('/btcusdt/15m', async (req, res) => {
  try {
    const candles = await marketService.getCandles('15m', 200);
    const closes = candles.map((c) => c.close);
    const ema20 = indicatorService.calculateEMA(closes, 20);
    const ema50 = indicatorService.calculateEMA(closes, 50);
    const sma200 = indicatorService.calculateSMA(closes, 200);

    res.json({ timeframe: '15m', candles, indicators: { ema20, ema50, sma200 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/chart/btcusdt/1h:
 *   get:
 *     summary: Get 1h chart data with indicators
 */
router.get('/btcusdt/1h', async (req, res) => {
  try {
    const candles = await marketService.getCandles('1h', 200);
    const closes = candles.map((c) => c.close);
    const ema50 = indicatorService.calculateEMA(closes, 50);
    const ema200 = indicatorService.calculateEMA(closes, 200);

    res.json({ timeframe: '1h', candles, indicators: { ema50, ema200 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/chart/btcusdt/rsi:
 *   get:
 *     summary: Get RSI data
 */
router.get('/btcusdt/rsi', async (req, res) => {
  try {
    const candles = await marketService.getCandles('15m', 200);
    const closes = candles.map((c) => c.close);
    const rsi = indicatorService.calculateRSI(closes, 14);

    res.json({
      period: 14,
      values: rsi.map((v) => Math.round(v * 100) / 100),
      current: rsi.length > 0 ? Math.round(rsi[rsi.length - 1] * 100) / 100 : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
