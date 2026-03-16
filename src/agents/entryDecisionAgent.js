/**
 * Entry Decision Agent — determines whether to enter a trade based on
 * the averages from the 3 condition agents.
 *
 * Rules:
 * - Averages long and short scores from the 3 condition agents
 * - Only takes a position if the spread between long and short avg is > 2
 * - For LONG: avgLong must be > 6 AND avgLong - avgShort > 2
 * - For SHORT: avgShort must be > 6 AND avgShort - avgLong > 2
 */
class EntryDecisionAgent {
  constructor() {
    this.name = 'entryDecision';
    this.lastOutput = null;
  }

  async analyze({ condition1, condition2, condition3 }) {
    const agents = [condition1, condition2, condition3].filter(Boolean);

    if (agents.length === 0) {
      this.lastOutput = {
        agent: this.name,
        decision: 'no_trade',
        side: null,
        confidence: 0,
        avgLongScore: 0,
        avgShortScore: 0,
        spread: 0,
        agentScores: {},
        reason: 'No condition agents provided scores',
        timestamp: Date.now(),
      };
      return this.lastOutput;
    }

    // Collect scores
    const agentScores = {};
    if (condition1) agentScores.condition_1 = { longScore: condition1.longScore, shortScore: condition1.shortScore };
    if (condition2) agentScores.condition_2 = { longScore: condition2.longScore, shortScore: condition2.shortScore };
    if (condition3) agentScores.condition_3 = { longScore: condition3.longScore, shortScore: condition3.shortScore };

    // Calculate averages
    const count = agents.length;
    const avgLong = agents.reduce((sum, a) => sum + a.longScore, 0) / count;
    const avgShort = agents.reduce((sum, a) => sum + a.shortScore, 0) / count;

    const avgLongRounded = Math.round(avgLong * 10) / 10;
    const avgShortRounded = Math.round(avgShort * 10) / 10;
    const spread = Math.round(Math.abs(avgLong - avgShort) * 10) / 10;

    let decision = 'no_trade';
    let side = null;
    let confidence = 0;
    let reason = '';

    // Entry rules:
    // 1. Spread must be > 2 (clear directional bias, no ambiguity)
    // 2. The dominant side must average > 6
    if (avgLong > avgShort && spread > 2 && avgLong > 6) {
      decision = 'open_long';
      side = 'buy';
      confidence = Math.min(avgLong / 10, 1);
      reason = `Long avg ${avgLongRounded} > 6 with spread ${spread} > 2`;
    } else if (avgShort > avgLong && spread > 2 && avgShort > 6) {
      decision = 'open_short';
      side = 'sell';
      confidence = Math.min(avgShort / 10, 1);
      reason = `Short avg ${avgShortRounded} > 6 with spread ${spread} > 2`;
    } else if (spread <= 2) {
      reason = `Spread ${spread} <= 2 — too ambiguous, no clear direction`;
    } else if (avgLong <= 6 && avgShort <= 6) {
      reason = `Both averages <= 6 (L:${avgLongRounded} S:${avgShortRounded}) — not strong enough`;
    } else {
      reason = `Conditions not met (L:${avgLongRounded} S:${avgShortRounded} spread:${spread})`;
    }

    this.lastOutput = {
      agent: this.name,
      decision,
      side,
      confidence: Math.round(confidence * 100) / 100,
      avgLongScore: avgLongRounded,
      avgShortScore: avgShortRounded,
      spread,
      agentScores,
      reason,
      timestamp: Date.now(),
    };

    return this.lastOutput;
  }
}

module.exports = EntryDecisionAgent;
