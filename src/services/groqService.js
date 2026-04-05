const Groq = require('groq-sdk');
const config = require('../config');

class GroqService {
  constructor() {
    this.client = null;
  }

  _init() {
    if (!this.client && config.groq.apiKey) {
      this.client = new Groq({ apiKey: config.groq.apiKey });
    }
  }

  /**
   * Groq is used for interpreting strategy logic and contextual analysis.
   * It must NOT perform any mathematical calculations — all math is done in code.
   */
  async analyze(prompt) {
    this._init();
    if (!this.client) {
      return { analysis: 'Groq API key not configured. Skipping AI analysis.' };
    }

    const systemPrompt = `You are a trading strategy analyst. You interpret market context and strategy rules.
IMPORTANT: Do NOT perform any mathematical calculations. All math is done in code.
Only provide qualitative analysis, pattern interpretation, and strategy logic evaluation.
Keep responses concise and structured as JSON.`;

    try {
      const completion = await this.client.chat.completions.create({
        model: config.groq.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: 512,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const text = completion.choices[0]?.message?.content || '';

      try {
        return JSON.parse(text);
      } catch {
        return { analysis: text };
      }
    } catch (err) {
      console.error('Groq analysis error:', err.message);
      return { analysis: 'AI analysis unavailable', error: err.message };
    }
  }

  /**
   * Generate a voice analysis summary about what agents see in the current price.
   */
  async generateVoiceSummary(agentResults, currentPrice) {
    this._init();
    if (!this.client) {
      return 'AI analysis is not configured. Please set up your Groq API key to enable voice analysis.';
    }

    const prompt = `You are an expert crypto trading analyst providing a brief verbal market update.
Based on the following agent analysis data for BTC/USDT at $${currentPrice}, provide a natural-sounding
2-3 sentence summary about what the agents see and whether it looks like a good time to trade or not.
Speak conversationally as if talking to a trader. Be direct and actionable.

Agent Results: ${JSON.stringify(agentResults)}

Respond with ONLY the spoken text, no JSON, no formatting.`;

    try {
      const completion = await this.client.chat.completions.create({
        model: config.groq.model,
        messages: [
          { role: 'user', content: prompt },
        ],
        max_tokens: 256,
        temperature: 0.7,
      });

      return completion.choices[0]?.message?.content || 'Unable to generate analysis.';
    } catch (err) {
      console.error('Groq voice summary error:', err.message);
      return 'AI voice analysis is temporarily unavailable.';
    }
  }
}

module.exports = new GroqService();
