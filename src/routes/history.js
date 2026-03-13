const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

/**
 * @swagger
 * /api/history/trades:
 *   get:
 *     summary: Get trade history
 */
router.get('/trades', async (req, res) => {
  try {
    const { strategyId, limit = 100 } = req.query;
    let query = "SELECT * FROM trades WHERE result != 'open'";
    const params = [];

    if (strategyId) {
      params.push(strategyId);
      query += ` AND strategy_id = $${params.length}`;
    }
    params.push(parseInt(limit));
    query += ` ORDER BY exit_time DESC LIMIT $${params.length}`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/history/performance:
 *   get:
 *     summary: Get strategy performance stats
 */
router.get('/performance', async (req, res) => {
  try {
    const { strategyId } = req.query;
    let whereClause = "WHERE result != 'open'";
    const params = [];

    if (strategyId) {
      params.push(strategyId);
      whereClause += ` AND strategy_id = $${params.length}`;
    }

    const trades = await pool.query(`SELECT * FROM trades ${whereClause}`, params);
    const rows = trades.rows;

    const wins = rows.filter((t) => t.result === 'win');
    const losses = rows.filter((t) => t.result === 'loss');
    const totalPnl = rows.reduce((sum, t) => sum + parseFloat(t.pnl || 0), 0);
    const winRate = rows.length > 0 ? (wins.length / rows.length) * 100 : 0;

    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + parseFloat(t.pnl), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + parseFloat(t.pnl), 0) / losses.length : 0;

    res.json({
      totalTrades: rows.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Math.round(winRate * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor: avgLoss !== 0 ? Math.round(Math.abs(avgWin / avgLoss) * 100) / 100 : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/history/streaks:
 *   get:
 *     summary: Get win/loss streaks
 */
router.get('/streaks', async (req, res) => {
  try {
    const { strategyId } = req.query;
    let query = "SELECT result FROM trades WHERE result != 'open'";
    const params = [];

    if (strategyId) {
      params.push(strategyId);
      query += ` AND strategy_id = $${params.length}`;
    }
    query += ' ORDER BY exit_time ASC';

    const result = await pool.query(query, params);
    const results = result.rows.map((r) => r.result);

    let maxWinStreak = 0, maxLossStreak = 0;
    let currentWin = 0, currentLoss = 0;

    for (const r of results) {
      if (r === 'win') {
        currentWin++;
        currentLoss = 0;
        if (currentWin > maxWinStreak) maxWinStreak = currentWin;
      } else {
        currentLoss++;
        currentWin = 0;
        if (currentLoss > maxLossStreak) maxLossStreak = currentLoss;
      }
    }

    res.json({ maxWinStreak, maxLossStreak, currentWinStreak: currentWin, currentLossStreak: currentLoss });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
