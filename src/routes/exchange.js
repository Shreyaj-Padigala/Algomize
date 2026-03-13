const express = require('express');
const router = express.Router();
const exchangeService = require('../services/exchangeService');
const pool = require('../db/pool');

/**
 * @swagger
 * /api/exchange/connect:
 *   post:
 *     summary: Save BloFin credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               apiKey: { type: string }
 *               apiSecret: { type: string }
 *               passphrase: { type: string }
 *     responses:
 *       200:
 *         description: Credentials saved
 */
router.post('/connect', async (req, res) => {
  try {
    const { apiKey, apiSecret, passphrase } = req.body;
    if (!apiKey || !apiSecret || !passphrase) {
      return res.status(400).json({ error: 'All credentials are required' });
    }

    exchangeService.setCredentials(apiKey, apiSecret, passphrase);

    // Store in DB
    const existing = await pool.query('SELECT id FROM users LIMIT 1');
    if (existing.rows.length > 0) {
      await pool.query(
        'UPDATE users SET blofin_api_key = $1, blofin_api_secret = $2, blofin_passphrase = $3 WHERE id = $4',
        [apiKey, apiSecret, passphrase, existing.rows[0].id]
      );
    } else {
      await pool.query(
        'INSERT INTO users (blofin_api_key, blofin_api_secret, blofin_passphrase) VALUES ($1, $2, $3)',
        [apiKey, apiSecret, passphrase]
      );
    }

    // Test connection
    const status = await exchangeService.checkConnection();
    res.json({ message: 'Credentials saved', connected: status.connected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/exchange/status:
 *   get:
 *     summary: Check exchange connection status
 */
router.get('/status', async (req, res) => {
  try {
    const status = await exchangeService.checkConnection();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/exchange/disconnect:
 *   delete:
 *     summary: Remove stored credentials
 */
router.delete('/disconnect', async (req, res) => {
  try {
    exchangeService.clearCredentials();
    await pool.query('UPDATE users SET blofin_api_key = NULL, blofin_api_secret = NULL, blofin_passphrase = NULL');
    res.json({ message: 'Disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
