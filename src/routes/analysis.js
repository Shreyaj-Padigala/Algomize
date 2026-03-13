const express = require('express');
const router = express.Router();

function createAnalysisRoutes(orchestrator) {
  /**
   * @swagger
   * /api/analysis/confluence:
   *   get:
   *     summary: Get confluence analysis
   */
  router.get('/confluence', (req, res) => {
    const data = orchestrator.agents.confluence.lastOutput;
    if (!data) return res.json({ message: 'No analysis available yet. Start a session first.' });
    res.json(data);
  });

  /**
   * @swagger
   * /api/analysis/microtrend:
   *   get:
   *     summary: Get 15m micro trend analysis
   */
  router.get('/microtrend', (req, res) => {
    const data = orchestrator.agents.microTrend.lastOutput;
    if (!data) return res.json({ message: 'No analysis available yet.' });
    res.json(data);
  });

  /**
   * @swagger
   * /api/analysis/macrotrend:
   *   get:
   *     summary: Get 1h macro trend analysis
   */
  router.get('/macrotrend', (req, res) => {
    const data = orchestrator.agents.macroTrend.lastOutput;
    if (!data) return res.json({ message: 'No analysis available yet.' });
    res.json(data);
  });

  /**
   * @swagger
   * /api/analysis/rsi:
   *   get:
   *     summary: Get RSI analysis
   */
  router.get('/rsi', (req, res) => {
    const data = orchestrator.agents.rsi.lastOutput;
    if (!data) return res.json({ message: 'No analysis available yet.' });
    res.json(data);
  });

  /**
   * @swagger
   * /api/analysis/ict:
   *   get:
   *     summary: Get ICT analysis
   */
  router.get('/ict', (req, res) => {
    const data = orchestrator.agents.ict.lastOutput;
    if (!data) return res.json({ message: 'No analysis available yet.' });
    res.json(data);
  });

  return router;
}

module.exports = createAnalysisRoutes;
