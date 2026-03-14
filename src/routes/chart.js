const express = require('express');
const router = express.Router();
const marketService = require('../services/marketService');
const indicatorService = require('../services/indicatorService');

// 15m candles: 2 days = 192 candles
router.get('/btcusdt/15m', async (req, res) => {
  try {
    const candles = await marketService.getCandles('15m', 200);
    const closes = candles.map((c) => c.close);
    const ema20 = indicatorService.calculateEMA(closes, 20);
    const ema50 = indicatorService.calculateEMA(closes, 50);
    const rsiValues = indicatorService.calculateRSI(closes, 14);

    res.json({
      timeframe: '15m',
      candles: candles.slice(-192),
      indicators: { ema20: ema20.slice(-192), ema50: ema50.slice(-192) },
      rsi: rsiValues.slice(-192).map(v => Math.round(v * 100) / 100),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1h candles
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

// RSI data
router.get('/btcusdt/rsi', async (req, res) => {
  try {
    const candles = await marketService.getCandles('15m', 200);
    const closes = candles.map((c) => c.close);
    const rsi = indicatorService.calculateRSI(closes, 14);
    const timestamps = candles.slice(14).map(c => c.timestamp);

    res.json({
      period: 14,
      values: rsi.map((v) => Math.round(v * 100) / 100),
      timestamps,
      current: rsi.length > 0 ? Math.round(rsi[rsi.length - 1] * 100) / 100 : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
