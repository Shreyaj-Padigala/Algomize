const express = require('express');
const router = express.Router();
const marketService = require('../services/marketService');

/**
 * @swagger
 * /api/market/btcusdt/price:
 *   get:
 *     summary: Get current BTC/USDT price
 */
router.get('/btcusdt/price', async (req, res) => {
  try {
    const price = await marketService.getCurrentPrice();
    res.json(price);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/market/btcusdt/candles:
 *   get:
 *     summary: Get candle data
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema: { type: string, default: '15m' }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 100 }
 */
router.get('/btcusdt/candles', async (req, res) => {
  try {
    const { timeframe = '15m', limit = 100 } = req.query;
    const candles = await marketService.getCandles(timeframe, parseInt(limit));
    res.json(candles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/market/btcusdt/orderbook:
 *   get:
 *     summary: Get orderbook
 */
router.get('/btcusdt/orderbook', async (req, res) => {
  try {
    const orderbook = await marketService.getOrderbook();
    res.json(orderbook);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/market/btcusdt/trades:
 *   get:
 *     summary: Get recent trades
 */
router.get('/btcusdt/trades', async (req, res) => {
  try {
    const trades = await marketService.getRecentTrades();
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
