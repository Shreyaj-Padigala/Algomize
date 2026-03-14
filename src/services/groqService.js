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
   * Groq is ONLY used for interpreting strategy logic and contextual analysis.
   * It must NOT perform any mathematical calculations.
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
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 512,
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
}

module.exports = new GroqService();
