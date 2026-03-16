const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

/**
 * @swagger
 * /api/strategies:
 *   get:
 *     summary: List all strategies for the authenticated user
 *     tags: [Strategies]
 *     security:
 *       - bearerAuth: []
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM strategies WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/strategies/{id}:
 *   get:
 *     summary: Get a strategy by ID
 *     tags: [Strategies]
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM strategies WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Strategy not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/strategies:
 *   post:
 *     summary: Create a new strategy
 *     tags: [Strategies]
 */
router.post('/', async (req, res) => {
  try {
    const { name, symbol = 'BTC-USDT', leverage = 1, rules = {}, conditions = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'Strategy name is required' });

    const result = await pool.query(
      'INSERT INTO strategies (user_id, name, symbol, leverage, rules, conditions) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.user.userId, name, symbol, leverage, JSON.stringify(rules), JSON.stringify(conditions)]
    );

    const strategy = result.rows[0];

    // Create default agent entries for the 5 condition agents
    const agentNames = ['condition_1', 'condition_2', 'condition_3', 'condition_4', 'condition_5', 'finalDecision', 'exit', 'data'];
    for (const agentName of agentNames) {
      await pool.query(
        'INSERT INTO strategy_agents (strategy_id, agent_name, is_active) VALUES ($1, $2, TRUE)',
        [strategy.id, agentName]
      );
    }

    res.status(201).json(strategy);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/strategies/{id}:
 *   put:
 *     summary: Update a strategy
 *     tags: [Strategies]
 */
router.put('/:id', async (req, res) => {
  try {
    const { name, leverage, rules, conditions } = req.body;
    const fields = [];
    const values = [];
    let idx = 1;

    if (name) { fields.push(`name = $${idx++}`); values.push(name); }
    if (leverage) { fields.push(`leverage = $${idx++}`); values.push(leverage); }
    if (rules) { fields.push(`rules = $${idx++}`); values.push(JSON.stringify(rules)); }
    if (conditions !== undefined) { fields.push(`conditions = $${idx++}`); values.push(JSON.stringify(conditions)); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    values.push(req.user.userId);
    const result = await pool.query(
      `UPDATE strategies SET ${fields.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Strategy not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/strategies/{id}:
 *   delete:
 *     summary: Delete a strategy
 *     tags: [Strategies]
 */
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM strategies WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Strategy not found' });
    res.json({ message: 'Strategy deleted', strategy: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
