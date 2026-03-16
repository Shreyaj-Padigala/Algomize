const ConditionEvaluator = require('./conditionEvaluator');

/**
 * Condition Two Agent — evaluates the user's second trading condition.
 * Delegates to ConditionEvaluator which uses math for indicators
 * and only falls back to AI for qualitative conditions.
 */
class ConditionTwoAgent {
  constructor() {
    this.name = 'condition_2';
    this.lastOutput = null;
  }

  async analyze(candles15m, candles1h, candles4h, conditionDescription) {
    if (!conditionDescription) {
      this.lastOutput = {
        agent: this.name,
        longScore: 4,
        shortScore: 6,
        summary: 'No condition provided',
        timestamp: Date.now(),
      };
      return this.lastOutput;
    }

    const scores = await ConditionEvaluator.evaluate(
      conditionDescription, candles15m, candles1h, candles4h
    );

    this.lastOutput = {
      agent: this.name,
      conditionDescription,
      ...scores,
      timestamp: Date.now(),
    };

    return this.lastOutput;
  }
}

module.exports = ConditionTwoAgent;
