const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const config = require('../config');

class NovaService {
  constructor() {
    this.client = null;
  }

  _init() {
    if (!this.client && config.aws.accessKeyId) {
      this.client = new BedrockRuntimeClient({
        region: config.aws.region,
        credentials: {
          accessKeyId: config.aws.accessKeyId,
          secretAccessKey: config.aws.secretAccessKey,
        },
      });
    }
  }

  /**
   * Amazon Nova 2 Lite is used for interpreting strategy logic and contextual analysis.
   * It must NOT perform any mathematical calculations — all math is done in code.
   */
  async analyze(prompt) {
    this._init();
    if (!this.client) {
      return { analysis: 'AWS credentials not configured. Skipping AI analysis.' };
    }

    const systemPrompt = `You are a trading strategy analyst. You interpret market context and strategy rules.
IMPORTANT: Do NOT perform any mathematical calculations. All math is done in code.
Only provide qualitative analysis, pattern interpretation, and strategy logic evaluation.
Keep responses concise and structured as JSON.`;

    try {
      const body = JSON.stringify({
        messages: [
          { role: 'user', content: [{ text: `${systemPrompt}\n\n${prompt}` }] },
        ],
        inferenceConfig: {
          maxTokens: 512,
          temperature: 0.3,
        },
      });

      const command = new InvokeModelCommand({
        modelId: 'amazon.nova-lite-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body,
      });

      const response = await this.client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const text = responseBody.output?.message?.content?.[0]?.text || '';

      try {
        return JSON.parse(text);
      } catch {
        return { analysis: text };
      }
    } catch (err) {
      console.error('Nova analysis error:', err.message);
      return { analysis: 'AI analysis unavailable', error: err.message };
    }
  }

  /**
   * Generate a voice analysis summary about what agents see in the current price.
   */
  async generateVoiceSummary(agentResults, currentPrice) {
    this._init();
    if (!this.client) {
      return 'AI analysis is not configured. Please set up AWS credentials to enable voice analysis.';
    }

    const prompt = `You are an expert crypto trading analyst providing a brief verbal market update.
Based on the following agent analysis data for BTC/USDT at $${currentPrice}, provide a natural-sounding
2-3 sentence summary about what the agents see and whether it looks like a good time to trade or not.
Speak conversationally as if talking to a trader. Be direct and actionable.

Agent Results: ${JSON.stringify(agentResults)}

Respond with ONLY the spoken text, no JSON, no formatting.`;

    try {
      const body = JSON.stringify({
        messages: [
          { role: 'user', content: [{ text: prompt }] },
        ],
        inferenceConfig: {
          maxTokens: 256,
          temperature: 0.7,
        },
      });

      const command = new InvokeModelCommand({
        modelId: 'amazon.nova-lite-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body,
      });

      const response = await this.client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      return responseBody.output?.message?.content?.[0]?.text || 'Unable to generate analysis.';
    } catch (err) {
      console.error('Nova voice summary error:', err.message);
      return 'AI voice analysis is temporarily unavailable.';
    }
  }
}

module.exports = new NovaService();
