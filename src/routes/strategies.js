const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

/**
 * @swagger
 * /api/strategies:
 *   get:
 *     summary: List all strategies
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM strategies ORDER BY created_at DESC');
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
 */
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM strategies WHERE id = $1', [req.params.id]);
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
 */
router.post('/', async (req, res) => {
  try {
    const { name, symbol = 'BTC-USDT', leverage = 1, rules = {} } = req.body;
    if (!name) return res.status(400).json({ error: 'Strategy name is required' });

    const result = await pool.query(
      'INSERT INTO strategies (name, symbol, leverage, rules) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, symbol, leverage, JSON.stringify(rules)]
    );

    const strategy = result.rows[0];

    // Create default agent entries
    const agentNames = ['confluence', 'data', 'microTrend', 'macroTrend', 'rsi', 'ict', 'finalDecision', 'exit'];
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
 */
router.put('/:id', async (req, res) => {
  try {
    const { name, leverage, rules } = req.body;
    const fields = [];
    const values = [];
    let idx = 1;

    if (name) { fields.push(`name = $${idx++}`); values.push(name); }
    if (leverage) { fields.push(`leverage = $${idx++}`); values.push(leverage); }
    if (rules) { fields.push(`rules = $${idx++}`); values.push(JSON.stringify(rules)); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE strategies SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
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
 */
router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM strategies WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Strategy not found' });
    res.json({ message: 'Strategy deleted', strategy: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
