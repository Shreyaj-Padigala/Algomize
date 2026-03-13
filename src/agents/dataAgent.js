const pool = require('../db/pool');
const csvService = require('../services/csvService');

class DataAgent {
  constructor() {
    this.name = 'data';
    this.lastOutput = null;
  }

  async logTrade(strategyId, trade) {
    // Store in PostgreSQL
    const result = await pool.query(
      `INSERT INTO trades (strategy_id, side, entry_price, exit_price, position_size,
        leverage, pnl, entry_time, exit_time, result, agent_signals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        strategyId, trade.side, trade.entry_price, trade.exit_price || null,
        trade.position_size, trade.leverage, trade.pnl || null,
        trade.entry_time || new Date(), trade.exit_time || null,
        trade.result || 'open', JSON.stringify(trade.agent_signals || {}),
      ]
    );

    const dbTrade = result.rows[0];

    // Log to CSV
    await csvService.logTrade(strategyId, dbTrade);

    return dbTrade;
  }

  async updateTrade(tradeId, updates) {
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
    values.push(tradeId);

    const result = await pool.query(
      `UPDATE trades SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  async getStrategyStats(strategyId) {
    const trades = await pool.query(
      'SELECT * FROM trades WHERE strategy_id = $1 ORDER BY entry_time DESC',
      [strategyId]
    );

    const completed = trades.rows.filter((t) => t.result && t.result !== 'open');
    const wins = completed.filter((t) => t.result === 'win');
    const losses = completed.filter((t) => t.result === 'loss');

    const totalPnl = completed.reduce((sum, t) => sum + parseFloat(t.pnl || 0), 0);
    const winRate = completed.length > 0 ? (wins.length / completed.length) * 100 : 0;

    // Loss patterns: consecutive losses
    const lossPatterns = this._findLossPatterns(completed);

    this.lastOutput = {
      agent: this.name,
      timestamp: Date.now(),
      totalTrades: trades.rows.length,
      completedTrades: completed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Math.round(winRate * 100) / 100,
      totalPnl,
      lossPatterns,
      recentTrades: trades.rows.slice(0, 10),
    };

    return this.lastOutput;
  }

  _findLossPatterns(trades) {
    let maxStreak = 0;
    let currentStreak = 0;
    const streaks = [];

    for (const trade of trades) {
      if (trade.result === 'loss') {
        currentStreak++;
        if (currentStreak > maxStreak) maxStreak = currentStreak;
      } else {
        if (currentStreak > 0) streaks.push(currentStreak);
        currentStreak = 0;
      }
    }
    if (currentStreak > 0) streaks.push(currentStreak);

    return { maxLossStreak: maxStreak, lossStreaks: streaks };
  }

  async analyze(strategyId) {
    return this.getStrategyStats(strategyId);
  }
}

module.exports = DataAgent;
