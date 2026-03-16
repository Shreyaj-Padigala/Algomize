class FinalDecisionAgent {
  constructor() {
    this.name = 'finalDecision';
    this.lastOutput = null;
    this.threshold = 6;
  }

  async analyze(agentScoresInput) {
    // Accept either an object of { agentName: { longScore, shortScore } }
    // or the old format with named keys
    const agentScores = {};
    const scoringAgents = [];

    for (const [key, value] of Object.entries(agentScoresInput)) {
      if (value && typeof value.longScore === 'number' && typeof value.shortScore === 'number') {
        agentScores[key] = { longScore: value.longScore, shortScore: value.shortScore };
        scoringAgents.push(agentScores[key]);
      }
    }

    // Calculate averages
    const count = scoringAgents.length || 1;
    const avgLong = scoringAgents.reduce((sum, s) => sum + s.longScore, 0) / count;
    const avgShort = scoringAgents.reduce((sum, s) => sum + s.shortScore, 0) / count;

    const avgLongRounded = Math.round(avgLong * 10) / 10;
    const avgShortRounded = Math.round(avgShort * 10) / 10;

    let decision = 'no_trade';
    let side = null;
    let confidence = 0;

    // Require a minimum spread of 1.5 between long and short to avoid ambiguous signals
    const spread = Math.abs(avgLong - avgShort);
    const minSpread = 1.5;

    if (avgLong >= this.threshold && avgLong > avgShort && spread >= minSpread) {
      decision = 'open_long';
      side = 'buy';
      confidence = Math.min(avgLong / 10, 1);
    } else if (avgShort >= this.threshold && avgShort > avgLong && spread >= minSpread) {
      decision = 'open_short';
      side = 'sell';
      confidence = Math.min(avgShort / 10, 1);
    }

    this.lastOutput = {
      agent: this.name,
      timestamp: Date.now(),
      decision,
      side,
      confidence: Math.round(confidence * 100) / 100,
      avgLongScore: avgLongRounded,
      avgShortScore: avgShortRounded,
      threshold: this.threshold,
      agentScores,
    };

    return this.lastOutput;
  }
}

module.exports = FinalDecisionAgent;
