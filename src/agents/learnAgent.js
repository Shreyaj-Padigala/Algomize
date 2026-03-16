const pool = require('../db/pool');
const novaService = require('../services/novaService');

/**
 * Learn Agent — analyzes past trade performance and refines the user's
 * strategy over time. Examines what trades succeeded and failed from
 * the trade log to provide improvement suggestions.
 *
 * Runs after each trade closes to generate insights.
 */
class LearnAgent {
  constructor() {
    this.name = 'learn';
    this.lastOutput = null;
    this.insights = [];
  }

  /**
   * Analyze completed trades and generate learning insights.
   * @param {number} strategyId - The strategy to analyze
   * @param {object} latestTrade - The most recently closed trade
   * @param {string[]} conditions - The user's 3 condition descriptions
   */
  async analyze(strategyId, latestTrade, conditions) {
    try {
      // Fetch all completed trades for this strategy
      const tradesResult = await pool.query(
        "SELECT * FROM trades WHERE strategy_id = $1 AND result != 'open' ORDER BY exit_time DESC LIMIT 20",
        [strategyId]
      );
      const trades = tradesResult.rows;

      if (trades.length < 2) {
        this.lastOutput = {
          agent: this.name,
          timestamp: Date.now(),
          insight: 'Not enough trade history to generate insights. Need at least 2 completed trades.',
          suggestion: null,
          stats: { totalTrades: trades.length },
        };
        return this.lastOutput;
      }

      // Calculate performance stats
      const stats = this._calculateStats(trades);

      // Generate AI-powered insight
      const insight = await this._generateInsight(trades, conditions, stats, latestTrade);

      this.lastOutput = {
        agent: this.name,
        timestamp: Date.now(),
        ...insight,
        stats,
      };

      // Store insight for the strategy
      this.insights.push(this.lastOutput);
      if (this.insights.length > 50) this.insights = this.insights.slice(-50);

      return this.lastOutput;
    } catch (err) {
      console.error('Learn agent error:', err);
      this.lastOutput = {
        agent: this.name,
        timestamp: Date.now(),
        insight: 'Unable to analyze trades at this time.',
        suggestion: null,
        error: err.message,
      };
      return this.lastOutput;
    }
  }

  _calculateStats(trades) {
    const wins = trades.filter(t => t.result === 'win');
    const losses = trades.filter(t => t.result === 'loss');
    const totalPnl = trades.reduce((sum, t) => sum + parseFloat(t.pnl || 0), 0);
    const winRate = trades.length > 0 ? (wins.length / trades.length * 100) : 0;

    const avgWin = wins.length > 0
      ? wins.reduce((sum, t) => sum + parseFloat(t.pnl || 0), 0) / wins.length
      : 0;
    const avgLoss = losses.length > 0
      ? losses.reduce((sum, t) => sum + parseFloat(t.pnl || 0), 0) / losses.length
      : 0;

    // Win/loss by side
    const longTrades = trades.filter(t => t.side === 'buy');
    const shortTrades = trades.filter(t => t.side === 'sell');
    const longWinRate = longTrades.length > 0
      ? (longTrades.filter(t => t.result === 'win').length / longTrades.length * 100)
      : 0;
    const shortWinRate = shortTrades.length > 0
      ? (shortTrades.filter(t => t.result === 'win').length / shortTrades.length * 100)
      : 0;

    // Consecutive losses
    let maxConsecLoss = 0;
    let currentConsec = 0;
    for (const trade of trades.reverse()) {
      if (trade.result === 'loss') {
        currentConsec++;
        maxConsecLoss = Math.max(maxConsecLoss, currentConsec);
      } else {
        currentConsec = 0;
      }
    }

    return {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Math.round(winRate),
      totalPnl: Math.round(totalPnl * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      longWinRate: Math.round(longWinRate),
      shortWinRate: Math.round(shortWinRate),
      maxConsecLoss,
    };
  }

  async _generateInsight(trades, conditions, stats, latestTrade) {
    const recentTrades = trades.slice(0, 10).map(t => ({
      side: t.side,
      pnl: parseFloat(t.pnl || 0).toFixed(2) + '%',
      result: t.result,
      signals: t.agent_signals,
    }));

    const prompt = `You are a trading strategy improvement advisor. Analyze this trade history and provide actionable insights.

USER'S 3 TRADING CONDITIONS:
1. ${conditions[0] || 'Not set'}
2. ${conditions[1] || 'Not set'}
3. ${conditions[2] || 'Not set'}

PERFORMANCE STATS:
- Total Trades: ${stats.totalTrades} | Wins: ${stats.wins} | Losses: ${stats.losses}
- Win Rate: ${stats.winRate}% | Total PnL: ${stats.totalPnl}%
- Avg Win: ${stats.avgWin}% | Avg Loss: ${stats.avgLoss}%
- Long Win Rate: ${stats.longWinRate}% | Short Win Rate: ${stats.shortWinRate}%
- Max Consecutive Losses: ${stats.maxConsecLoss}

RECENT TRADES (newest first):
${JSON.stringify(recentTrades, null, 2)}

LATEST TRADE:
${latestTrade ? `${latestTrade.side.toUpperCase()} | PnL: ${latestTrade.pnl}% | Result: ${latestTrade.result}` : 'N/A'}

Based on the performance data, provide:
1. "insight": A 1-2 sentence observation about what's working or not
2. "suggestion": A specific, actionable suggestion to improve the strategy

Respond ONLY with valid JSON: {"insight": "...", "suggestion": "..."}`;

    try {
      const result = await novaService.analyze(prompt);
      return {
        insight: result.insight || 'Trade performance is being tracked.',
        suggestion: result.suggestion || null,
      };
    } catch {
      // Fallback: generate basic insight without AI
      return this._fallbackInsight(stats, latestTrade);
    }
  }

  _fallbackInsight(stats, latestTrade) {
    let insight = '';
    let suggestion = null;

    if (stats.winRate < 40) {
      insight = `Win rate is low at ${stats.winRate}%. The strategy may need tighter entry conditions.`;
      suggestion = 'Consider requiring stronger consensus from condition agents (higher thresholds).';
    } else if (stats.winRate > 60) {
      insight = `Strong win rate of ${stats.winRate}%. The strategy is performing well.`;
      suggestion = 'Current conditions are working — maintain consistency.';
    } else {
      insight = `Win rate at ${stats.winRate}% is moderate. Average win: ${stats.avgWin}%, average loss: ${stats.avgLoss}%.`;
      if (Math.abs(stats.avgLoss) > stats.avgWin) {
        suggestion = 'Losses are larger than wins on average. Consider tightening stop loss.';
      } else {
        suggestion = 'Risk/reward ratio looks reasonable. Continue monitoring.';
      }
    }

    if (stats.longWinRate < 30 && stats.shortWinRate > 50) {
      suggestion = 'Long trades underperforming. Consider focusing conditions more on short setups.';
    } else if (stats.shortWinRate < 30 && stats.longWinRate > 50) {
      suggestion = 'Short trades underperforming. Consider focusing conditions more on long setups.';
    }

    return { insight, suggestion };
  }

  getInsights() {
    return this.insights;
  }
}

module.exports = LearnAgent;
