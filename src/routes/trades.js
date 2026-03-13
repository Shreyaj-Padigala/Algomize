const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

/**
 * @swagger
 * /api/trades:
 *   get:
 *     summary: List all trades
 */
router.get('/', async (req, res) => {
  try {
    const { strategyId, limit = 50 } = req.query;
    let query = 'SELECT * FROM trades';
    const params = [];

    if (strategyId) {
      query += ' WHERE strategy_id = $1';
      params.push(strategyId);
    }
    query += ' ORDER BY entry_time DESC LIMIT $' + (params.length + 1);
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/trades/open:
 *   get:
 *     summary: Get active/open trades
 */
router.get('/open', async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM trades WHERE result = 'open' ORDER BY entry_time DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/trades/{id}:
 *   get:
 *     summary: Get a trade by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM trades WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Trade not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/trades/open:
 *   post:
 *     summary: Manually open a trade
 */
router.post('/open', async (req, res) => {
  try {
    const { strategyId, side, entryPrice, positionSize, leverage = 1 } = req.body;
    if (!strategyId || !side || !positionSize) {
      return res.status(400).json({ error: 'strategyId, side, and positionSize are required' });
    }

    const result = await pool.query(
      `INSERT INTO trades (strategy_id, side, entry_price, position_size, leverage, entry_time, result)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'open') RETURNING *`,
      [strategyId, side, entryPrice, positionSize, leverage]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/trades/close:
 *   post:
 *     summary: Manually close a trade
 */
router.post('/close', async (req, res) => {
  try {
    const { tradeId, exitPrice } = req.body;
    if (!tradeId || !exitPrice) {
      return res.status(400).json({ error: 'tradeId and exitPrice are required' });
    }

    const trade = await pool.query('SELECT * FROM trades WHERE id = $1', [tradeId]);
    if (trade.rows.length === 0) return res.status(404).json({ error: 'Trade not found' });

    const t = trade.rows[0];
    const entryPrice = parseFloat(t.entry_price);
    const positionSize = parseFloat(t.position_size);
    let pnl = 0;

    if (t.side === 'buy') {
      pnl = (exitPrice - entryPrice) * positionSize;
    } else {
      pnl = (entryPrice - exitPrice) * positionSize;
    }

    const result = t.side === 'buy'
      ? (exitPrice > entryPrice ? 'win' : 'loss')
      : (exitPrice < entryPrice ? 'win' : 'loss');

    const updated = await pool.query(
      `UPDATE trades SET exit_price = $1, exit_time = NOW(), pnl = $2, result = $3 WHERE id = $4 RETURNING *`,
      [exitPrice, pnl, result, tradeId]
    );

    // Update strategy PnL
    await pool.query('UPDATE strategies SET pnl_total = pnl_total + $1 WHERE id = $2', [pnl, t.strategy_id]);

    res.json(updated.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
