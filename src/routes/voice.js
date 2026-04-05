const express = require('express');
const axios = require('axios');
const config = require('../config');
const groqService = require('../services/groqService');

function createVoiceRoutes(orchestrator) {
  const router = express.Router();

  /**
   * @swagger
   * /api/voice/analyze:
   *   post:
   *     summary: Get voice analysis of current market from agents
   *     tags: [Voice]
   *     responses:
   *       200:
   *         description: Audio buffer of agent analysis
   */
  router.post('/analyze', async (req, res) => {
    try {
      // Get latest agent results from orchestrator
      const status = orchestrator.getStatus();
      const agentResults = orchestrator.lastCycleResults || {};
      const currentPrice = agentResults.rsi?.currentPrice ||
        agentResults.microTrend?.currentPrice || 'unknown';

      // Generate text summary via Nova
      const summaryText = await groqService.generateVoiceSummary(agentResults, currentPrice);

      // If no ElevenLabs key, return text only
      if (!config.elevenlabs.apiKey) {
        return res.json({ text: summaryText, audio: null });
      }

      // Convert to speech via ElevenLabs
      try {
        const audioResponse = await axios.post(
          `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenlabs.voiceId}`,
          {
            text: summaryText,
            model_id: 'eleven_turbo_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          },
          {
            headers: {
              'Accept': 'audio/mpeg',
              'Content-Type': 'application/json',
              'xi-api-key': config.elevenlabs.apiKey,
            },
            responseType: 'arraybuffer',
          }
        );

        res.set({
          'Content-Type': 'audio/mpeg',
          'X-Voice-Text': Buffer.from(summaryText).toString('base64'),
        });
        res.send(Buffer.from(audioResponse.data));
      } catch (audioErr) {
        console.error('ElevenLabs error:', audioErr.message);
        res.json({ text: summaryText, audio: null, error: 'Voice synthesis unavailable' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createVoiceRoutes;
