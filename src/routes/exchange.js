const express = require('express');
const router = express.Router();
const exchangeService = require('../services/exchangeService');
const config = require('../config');

// Auto-connect using .env credentials on startup
router.get('/status', async (req, res) => {
  try {
    // If credentials exist in .env, use them
    if (config.blofin.apiKey && !exchangeService.connected) {
      exchangeService.setCredentials(
        config.blofin.apiKey,
        config.blofin.apiSecret,
        config.blofin.passphrase
      );
    }
    const status = await exchangeService.checkConnection();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message, connected: false });
  }
});

// Auto-connect from env
router.post('/connect', async (req, res) => {
  try {
    if (config.blofin.apiKey) {
      exchangeService.setCredentials(
        config.blofin.apiKey,
        config.blofin.apiSecret,
        config.blofin.passphrase
      );
    }
    const status = await exchangeService.checkConnection();
    res.json({ message: 'Connected using server credentials', connected: status.connected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/disconnect', async (req, res) => {
  try {
    exchangeService.clearCredentials();
    res.json({ message: 'Disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
