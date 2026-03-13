const geminiService = require('../services/geminiService');
const config = require('../config');

class FinalDecisionAgent {
  constructor() {
    this.name = 'finalDecision';
    this.lastOutput = null;
    this.maxPortfolioPercent = config.trading.maxPortfolioPercent;
  }

  async analyze({ confluence, microTrend, macroTrend, rsi, ict, strategyRules, portfolioBalance }) {
    // Score-based decision system
    let bullishScore = 0;
    let bearishScore = 0;

    // Macro Trend (weight: 3)
    if (macroTrend && macroTrend.macroTrend === 'bullish') bullishScore += 3;
    if (macroTrend && macroTrend.macroTrend === 'bearish') bearishScore += 3;

    // Micro Trend (weight: 2)
    if (microTrend && microTrend.trend === 'bullish') bullishScore += 2;
    if (microTrend && microTrend.trend === 'bearish') bearishScore += 2;

    // RSI (weight: 2)
    if (rsi) {
      if (rsi.oversold) bullishScore += 2;
      if (rsi.overbought) bearishScore += 2;
      if (rsi.bullishDivergence) bullishScore += 2;
      if (rsi.bearishDivergence) bearishScore += 2;
    }

    // Confluence (weight: 1)
    if (confluence && confluence.proximitySignal === 'near_key_level') {
      const nearSupport = confluence.nearbyLevels.some((l) => l.type === 'support');
      const nearResistance = confluence.nearbyLevels.some((l) => l.type === 'resistance');
      if (nearSupport) bullishScore += 1;
      if (nearResistance) bearishScore += 1;
    }

    // ICT (weight: 2)
    if (ict) {
      if (ict.liquiditySweeps.some((s) => s.type === 'buy_side_sweep')) bullishScore += 2;
      if (ict.liquiditySweeps.some((s) => s.type === 'sell_side_sweep')) bearishScore += 2;
      if (ict.premiumDiscount && ict.premiumDiscount.zone === 'discount') bullishScore += 1;
      if (ict.premiumDiscount && ict.premiumDiscount.zone === 'premium') bearishScore += 1;
      if (ict.marketStructureShift) {
        if (ict.marketStructureShift.type === 'bullish_bos') bullishScore += 2;
        if (ict.marketStructureShift.type === 'bearish_bos') bearishScore += 2;
      }
    }

    // Determine decision
    const threshold = 5;
    let decision = 'no_trade';
    let side = null;
    let confidence = 0;

    if (bullishScore >= threshold && bullishScore > bearishScore + 2) {
      decision = 'open_long';
      side = 'buy';
      confidence = Math.min(bullishScore / 12, 1);
    } else if (bearishScore >= threshold && bearishScore > bullishScore + 2) {
      decision = 'open_short';
      side = 'sell';
      confidence = Math.min(bearishScore / 12, 1);
    }

    // Position sizing: max 50% of portfolio
    let positionSize = 0;
    if (decision !== 'no_trade' && portfolioBalance > 0) {
      const maxAmount = portfolioBalance * (this.maxPortfolioPercent / 100);
      positionSize = maxAmount * confidence;
    }

    // AI interpretation of strategy rules
    let aiContext = null;
    if (strategyRules && Object.keys(strategyRules).length > 0) {
      aiContext = await geminiService.analyze(
        `Given these strategy rules: ${JSON.stringify(strategyRules)}
         And current signals - bullish score: ${bullishScore}, bearish score: ${bearishScore}
         Preliminary decision: ${decision}
         Should we proceed with this trade? Interpret the strategy rules contextually.
         Do NOT perform calculations.`
      );
    }

    this.lastOutput = {
      agent: this.name,
      timestamp: Date.now(),
      decision,
      side,
      confidence: Math.round(confidence * 100) / 100,
      positionSize: Math.round(positionSize * 100) / 100,
      bullishScore,
      bearishScore,
      threshold,
      aiContext,
    };

    return this.lastOutput;
  }
}

module.exports = FinalDecisionAgent;
