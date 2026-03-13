const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

function createSessionRoutes(orchestrator) {
  /**
   * @swagger
   * /api/session/start:
   *   post:
   *     summary: Start a trading session
   */
  router.post('/start', async (req, res) => {
    try {
      const { strategyId } = req.body;
      if (!strategyId) return res.status(400).json({ error: 'strategyId is required' });

      const result = await orchestrator.startSession(strategyId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/session/stop:
   *   post:
   *     summary: Stop the active trading session
   */
  router.post('/stop', async (req, res) => {
    try {
      const result = await orchestrator.stopSession();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/session/status:
   *   get:
   *     summary: Get current session status
   */
  router.get('/status', async (req, res) => {
    try {
      const status = orchestrator.getStatus();
      const activeSessions = await pool.query(
        'SELECT * FROM sessions WHERE active = TRUE ORDER BY start_time DESC LIMIT 1'
      );

      res.json({
        ...status,
        session: activeSessions.rows[0] || null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createSessionRoutes;
