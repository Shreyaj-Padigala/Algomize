class FinalDecisionAgent {
  constructor() {
    this.name = 'finalDecision';
    this.lastOutput = null;
    this.threshold = 6.5;
  }

  async analyze({ confluence, microTrend, macroTrend, rsi, ict }) {
    // Collect all agent scores
    const agentScores = {};
    const scoringAgents = [];

    if (confluence) {
      agentScores.confluence = { longScore: confluence.longScore, shortScore: confluence.shortScore };
      scoringAgents.push(agentScores.confluence);
    }
    if (microTrend) {
      agentScores.microTrend = { longScore: microTrend.longScore, shortScore: microTrend.shortScore };
      scoringAgents.push(agentScores.microTrend);
    }
    if (macroTrend) {
      agentScores.macroTrend = { longScore: macroTrend.longScore, shortScore: macroTrend.shortScore };
      scoringAgents.push(agentScores.macroTrend);
    }
    if (rsi) {
      agentScores.rsi = { longScore: rsi.longScore, shortScore: rsi.shortScore };
      scoringAgents.push(agentScores.rsi);
    }
    if (ict) {
      agentScores.ict = { longScore: ict.longScore, shortScore: ict.shortScore };
      scoringAgents.push(agentScores.ict);
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

    // If avg long >= 6.5, long is stronger than short, and clear directional bias
    if (avgLong >= this.threshold && avgLong > avgShort && spread >= minSpread) {
      decision = 'open_long';
      side = 'buy';
      confidence = Math.min(avgLong / 10, 1);
    }
    // If avg short >= 6.5, short is stronger than long, and clear directional bias
    else if (avgShort >= this.threshold && avgShort > avgLong && spread >= minSpread) {
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
