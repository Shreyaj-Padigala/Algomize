const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

class GeminiService {
  constructor() {
    this.client = null;
    this.model = null;
  }

  _init() {
    if (!this.client && config.gemini.apiKey) {
      this.client = new GoogleGenerativeAI(config.gemini.apiKey);
      this.model = this.client.getGenerativeModel({ model: 'gemini-2.0-flash' });
    }
  }

  /**
   * Gemini is ONLY used for interpreting strategy logic and contextual analysis.
   * It must NOT perform any mathematical calculations.
   */
  async analyze(prompt) {
    this._init();
    if (!this.model) {
      return { analysis: 'Gemini API key not configured. Skipping AI analysis.' };
    }

    const systemPrompt = `You are a trading strategy analyst. You interpret market context and strategy rules.
IMPORTANT: Do NOT perform any mathematical calculations. All math is done in code.
Only provide qualitative analysis, pattern interpretation, and strategy logic evaluation.
Keep responses concise and structured as JSON.`;

    try {
      const result = await this.model.generateContent(`${systemPrompt}\n\n${prompt}`);
      const text = result.response.text();

      // Try to parse JSON, fallback to raw text
      try {
        return JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, ''));
      } catch {
        return { analysis: text };
      }
    } catch (err) {
      console.error('Gemini analysis error:', err.message);
      return { analysis: 'AI analysis unavailable', error: err.message };
    }
  }
}

module.exports = new GeminiService();
