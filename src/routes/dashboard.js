const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

function createDashboardRoutes(orchestrator) {
  /**
   * @swagger
   * /api/dashboard/summary:
   *   get:
   *     summary: Get PnL summary
   */
  router.get('/summary', async (req, res) => {
    try {
      const strategies = await pool.query('SELECT * FROM strategies ORDER BY created_at DESC');
      const totalPnl = strategies.rows.reduce((sum, s) => sum + parseFloat(s.pnl_total || 0), 0);

      const openTrades = await pool.query("SELECT COUNT(*) FROM trades WHERE result = 'open'");
      const completedTrades = await pool.query("SELECT COUNT(*) FROM trades WHERE result != 'open'");

      const status = orchestrator.getStatus();

      res.json({
        totalPnl: Math.round(totalPnl * 100) / 100,
        strategies: strategies.rows.length,
        activeStrategy: status.activeStrategy?.name || null,
        sessionRunning: status.running,
        openTrades: parseInt(openTrades.rows[0].count),
        completedTrades: parseInt(completedTrades.rows[0].count),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/dashboard/agents:
   *   get:
   *     summary: Get agent states for dashboard
   */
  router.get('/agents', (req, res) => {
    res.json(orchestrator.getAgentStatuses());
  });

  /**
   * @swagger
   * /api/dashboard/trades:
   *   get:
   *     summary: Get recent trades for dashboard
   */
  router.get('/trades', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM trades ORDER BY entry_time DESC LIMIT 20');
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createDashboardRoutes;
