const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// Orchestrator will be injected via middleware
function createAgentRoutes(orchestrator) {
  /**
   * @swagger
   * /api/agents:
   *   get:
   *     summary: List all agents
   */
  router.get('/', (req, res) => {
    const agents = [
      'confluence', 'data', 'microTrend', 'macroTrend',
      'rsi', 'ict', 'finalDecision', 'exit',
    ];
    res.json(agents.map((name) => ({ name, description: `${name} agent` })));
  });

  /**
   * @swagger
   * /api/agents/status:
   *   get:
   *     summary: Get agent statuses
   */
  router.get('/status', (req, res) => {
    res.json(orchestrator.getAgentStatuses());
  });

  /**
   * @swagger
   * /api/agents/start:
   *   post:
   *     summary: Start agent workflow
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
   * /api/agents/stop:
   *   post:
   *     summary: Stop agent workflow
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
   * /api/agents/enable/{agentName}:
   *   post:
   *     summary: Enable an agent
   */
  router.post('/enable/:agentName', async (req, res) => {
    try {
      const { agentName } = req.params;
      orchestrator.enableAgent(agentName);

      if (req.body.strategyId) {
        await pool.query(
          'UPDATE strategy_agents SET is_active = TRUE WHERE strategy_id = $1 AND agent_name = $2',
          [req.body.strategyId, agentName]
        );
      }
      res.json({ message: `${agentName} enabled` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/agents/disable/{agentName}:
   *   post:
   *     summary: Disable an agent
   */
  router.post('/disable/:agentName', async (req, res) => {
    try {
      const { agentName } = req.params;
      orchestrator.disableAgent(agentName);

      if (req.body.strategyId) {
        await pool.query(
          'UPDATE strategy_agents SET is_active = FALSE WHERE strategy_id = $1 AND agent_name = $2',
          [req.body.strategyId, agentName]
        );
      }
      res.json({ message: `${agentName} disabled` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createAgentRoutes;
