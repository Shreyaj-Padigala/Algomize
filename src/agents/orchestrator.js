const ConditionOneAgent = require('./conditionOneAgent');
const ConditionTwoAgent = require('./conditionTwoAgent');
const ConditionThreeAgent = require('./conditionThreeAgent');
const EntryDecisionAgent = require('./entryDecisionAgent');
const ExitAgent = require('./exitAgent');
const LearnAgent = require('./learnAgent');
const DataAgent = require('./dataAgent');
const marketService = require('../services/marketService');
const pool = require('../db/pool');

/**
 * Orchestrator — coordinates all agents in a 60-second workflow loop.
 *
 * Agents:
 * 1. ConditionOneAgent   — evaluates user's condition 1 (1-10 long/short)
 * 2. ConditionTwoAgent   — evaluates user's condition 2 (1-10 long/short)
 * 3. ConditionThreeAgent — evaluates user's condition 3 (1-10 long/short)
 * 4. EntryDecisionAgent  — averages scores, decides entry (spread > 2, avg > 6)
 * 5. ExitAgent           — monitors open trade, exits per user's exit strategy
 * 6. LearnAgent          — analyzes trade history, refines strategy over time
 * 7. DataAgent           — tracks stats, logs trades to DB/CSV
 */
class Orchestrator {
  constructor(io) {
    this.io = io;

    this.conditionOne = new ConditionOneAgent();
    this.conditionTwo = new ConditionTwoAgent();
    this.conditionThree = new ConditionThreeAgent();
    this.entryDecision = new EntryDecisionAgent();
    this.exitAgent = new ExitAgent();
    this.learnAgent = new LearnAgent();
    this.dataAgent = new DataAgent();

    this.activeStrategy = null;
    this.conditions = [];     // User's 3 condition descriptions
    this.exitStrategy = '';   // User's exit strategy text
    this.sessionTimer = null;
    this.workflowInterval = null;
    this.running = false;
    this.lastCycleResults = {};
    this.consecutiveLosses = 0;
    this.maxConsecutiveLosses = 3;
    this.pendingSignal = null;
    this.currentTrade = null;
    this.tradeLog = [];
    this.workflowHistory = [];
  }

  async startSession(strategyId) {
    if (this.running) {
      throw new Error('A bot is already running. Stop it before starting a new one.');
    }

    const stratResult = await pool.query('SELECT * FROM strategies WHERE id = $1', [strategyId]);
    if (stratResult.rows.length === 0) throw new Error('Strategy not found');

    this.activeStrategy = stratResult.rows[0];
    this.consecutiveLosses = 0;
    this.pendingSignal = null;
    this.currentTrade = null;
    this.tradeLog = [];
    this.workflowHistory = [];

    // Parse conditions from strategy
    this.conditions = [];
    this.exitStrategy = '';
    try {
      let conds = this.activeStrategy.conditions;
      if (typeof conds === 'string') conds = JSON.parse(conds);
      if (Array.isArray(conds)) {
        this.conditions = conds.map(c => (typeof c === 'string' ? c : c.description || ''));
      }
    } catch { /* empty */ }

    // Parse exit strategy from strategy rules
    try {
      let rules = this.activeStrategy.rules;
      if (typeof rules === 'string') rules = JSON.parse(rules);
      if (rules && rules.exitStrategy) this.exitStrategy = rules.exitStrategy;
    } catch { /* empty */ }

    await pool.query('UPDATE strategies SET session_active = TRUE WHERE id = $1', [strategyId]);

    const session = await pool.query(
      'INSERT INTO sessions (strategy_id) VALUES ($1) RETURNING *',
      [strategyId]
    );

    this.running = true;
    this._emit('session:update', { status: 'started', strategyId, sessionId: session.rows[0].id });
    this._emitWorkflow('system', 'Bot started',
      `Strategy: ${this.activeStrategy.name} | ${this.conditions.filter(Boolean).length} conditions | Looking for entry signals...`);

    this.workflowInterval = setInterval(() => this._runWorkflow(), 60000);
    this._runWorkflow();

    const durationMs = 12 * 60 * 60 * 1000;
    this.sessionTimer = setTimeout(() => this.stopSession('Session duration limit reached'), durationMs);

    return { status: 'started', strategyId, sessionId: session.rows[0].id };
  }

  async stopSession(reason = 'User stopped') {
    if (!this.running) return { status: 'not_running' };

    this.running = false;
    clearInterval(this.workflowInterval);
    clearTimeout(this.sessionTimer);

    if (this.activeStrategy) {
      await pool.query('UPDATE strategies SET session_active = FALSE WHERE id = $1', [this.activeStrategy.id]);
      await pool.query(
        'UPDATE sessions SET active = FALSE, end_time = NOW() WHERE strategy_id = $1 AND active = TRUE',
        [this.activeStrategy.id]
      );
    }

    this._emitWorkflow('system', 'Bot stopped', reason);
    this._emit('session:update', { status: 'stopped', strategyId: this.activeStrategy?.id, reason });
    this.activeStrategy = null;
    this.pendingSignal = null;

    return { status: 'stopped', reason };
  }

  async handleSignalResponse(accepted) {
    if (!this.pendingSignal) return { error: 'No pending signal' };

    if (accepted) {
      await this._openTrade(this.pendingSignal);
      this._emitWorkflow('trade', 'Trade opened',
        `${this.pendingSignal.side.toUpperCase()} at $${this.pendingSignal.entryPrice.toLocaleString()} | 100x Leverage | Watching for exit...`);
    } else {
      this._emitWorkflow('system', 'Signal rejected', 'User declined the trade. Continuing to scan...');
    }

    this.pendingSignal = null;
    return { status: accepted ? 'trade_opened' : 'signal_rejected' };
  }

  async _runWorkflow() {
    if (!this.running || !this.activeStrategy) return;

    try {
      this._emitWorkflow('scan', 'Scanning market', 'Fetching candle data...');

      const candles15m = await marketService.getCandles('15m', 200);
      const candles1h = await marketService.getCandles('1h', 200);
      const currentPrice = candles15m[candles15m.length - 1].close;

      // Send chart data to frontend
      this._emit('chart:data', {
        candles15m: candles15m.slice(-192),
        candles1h: candles1h.slice(-48),
      });

      // Check for open trades
      const openTrades = await pool.query(
        "SELECT * FROM trades WHERE strategy_id = $1 AND result = 'open'",
        [this.activeStrategy.id]
      );

      const hasOpenTrade = openTrades.rows.length > 0;
      const results = {};

      // ===== EXIT MODE =====
      if (hasOpenTrade) {
        const openTrade = openTrades.rows[0];

        results.exit = await this.exitAgent.analyze({
          openTrade,
          candles15m,
          exitStrategy: this.exitStrategy,
        });

        this._emit('agent:update', { agent: 'exit', data: {
          shouldClose: results.exit.shouldClose,
          triggers: results.exit.triggers,
          pnl: results.exit.leveragedPnlPercent,
          elapsed: results.exit.elapsed,
          takeProfitPct: results.exit.takeProfitPct,
          stopLossPct: results.exit.stopLossPct,
        }});

        if (results.exit.shouldClose) {
          this._emitWorkflow('exit', 'Exit signal triggered',
            `Triggers: ${results.exit.triggers.join(', ')} | PnL: ${results.exit.leveragedPnlPercent.toFixed(2)}%`);
          await this._closeTrade(openTrade, results.exit);
        } else {
          const pnl = results.exit.leveragedPnlPercent;
          this._emitWorkflow('holding', 'Position open',
            `${openTrade.side.toUpperCase()} from $${parseFloat(openTrade.entry_price).toLocaleString()} | Current: $${currentPrice.toLocaleString()} | PnL: ${pnl.toFixed(2)}% | TP: ${results.exit.takeProfitPct}% SL: -${results.exit.stopLossPct}%`);
        }
      }

      // ===== ENTRY MODE =====
      if (!hasOpenTrade && !this.pendingSignal) {
        // Run 3 condition agents in parallel
        const [c1, c2, c3] = await Promise.all([
          this.conditionOne.analyze(candles15m, candles1h, this.conditions[0] || ''),
          this.conditionTwo.analyze(candles15m, candles1h, this.conditions[1] || ''),
          this.conditionThree.analyze(candles15m, candles1h, this.conditions[2] || ''),
        ]);

        results.condition1 = c1;
        results.condition2 = c2;
        results.condition3 = c3;

        // Emit each agent's result
        if (this.conditions[0]) {
          this._emitWorkflow('agent', 'Agent 1',
            `${c1.summary} — ${c1.longScore}/10 Long ${c1.shortScore}/10 Short`);
          this._emit('agent:update', { agent: 'condition_1', data: { longScore: c1.longScore, shortScore: c1.shortScore, summary: c1.summary } });
        }
        if (this.conditions[1]) {
          this._emitWorkflow('agent', 'Agent 2',
            `${c2.summary} — ${c2.longScore}/10 Long ${c2.shortScore}/10 Short`);
          this._emit('agent:update', { agent: 'condition_2', data: { longScore: c2.longScore, shortScore: c2.shortScore, summary: c2.summary } });
        }
        if (this.conditions[2]) {
          this._emitWorkflow('agent', 'Agent 3',
            `${c3.summary} — ${c3.longScore}/10 Long ${c3.shortScore}/10 Short`);
          this._emit('agent:update', { agent: 'condition_3', data: { longScore: c3.longScore, shortScore: c3.shortScore, summary: c3.summary } });
        }

        // Run entry decision
        results.entryDecision = await this.entryDecision.analyze({
          condition1: this.conditions[0] ? c1 : null,
          condition2: this.conditions[1] ? c2 : null,
          condition3: this.conditions[2] ? c3 : null,
        });

        this._emit('agent:update', { agent: 'entryDecision', data: {
          decision: results.entryDecision.decision,
          side: results.entryDecision.side,
          avgLong: results.entryDecision.avgLongScore,
          avgShort: results.entryDecision.avgShortScore,
          spread: results.entryDecision.spread,
          reason: results.entryDecision.reason,
        }});

        if (results.entryDecision.decision !== 'no_trade') {
          this._emitWorkflow('signal', 'ENTRY SIGNAL',
            `${results.entryDecision.side === 'buy' ? 'LONG' : 'SHORT'} 100X | Avg Long: ${results.entryDecision.avgLongScore}/10 | Avg Short: ${results.entryDecision.avgShortScore}/10 | Spread: ${results.entryDecision.spread}`);

          this.pendingSignal = {
            ...results.entryDecision,
            entryPrice: currentPrice,
            timestamp: Date.now(),
            agentResults: results.entryDecision.agentScores,
          };

          this._emit('signal:prompt', {
            side: results.entryDecision.side,
            confidence: results.entryDecision.confidence,
            entryPrice: currentPrice,
            avgLongScore: results.entryDecision.avgLongScore,
            avgShortScore: results.entryDecision.avgShortScore,
            spread: results.entryDecision.spread,
            agentScores: results.entryDecision.agentScores,
            reason: results.entryDecision.reason,
            message: 'Do you want to place this trade for 100X Leverage?',
          });
        } else {
          this._emitWorkflow('scan', 'No signal',
            `${results.entryDecision.reason}`);
        }
      }

      // Data agent
      results.data = await this.dataAgent.analyze(this.activeStrategy.id);
      this._emit('agent:update', { agent: 'data', data: {
        totalTrades: results.data.totalTrades,
        wins: results.data.wins,
        losses: results.data.losses,
        winRate: results.data.winRate,
        pnl: results.data.totalPnl,
      }});

      this.lastCycleResults = results;
    } catch (err) {
      console.error('Workflow error:', err);
      this._emitWorkflow('error', 'Workflow error', err.message);
    }
  }

  async _openTrade(signal) {
    try {
      const trade = await this.dataAgent.logTrade(this.activeStrategy.id, {
        side: signal.side,
        entry_price: signal.entryPrice,
        position_size: 1,
        leverage: 100,
        entry_time: new Date(),
        result: 'open',
        agent_signals: signal.agentResults || {},
      });
      this.currentTrade = trade;
      this._emit('trade:update', { action: 'opened', trade });
    } catch (err) {
      console.error('Trade open error:', err);
      this._emitWorkflow('error', 'Trade open failed', err.message);
    }
  }

  async _closeTrade(openTrade, exitResult) {
    try {
      const currentPrice = exitResult.currentPrice;
      const pnlPercent = exitResult.leveragedPnlPercent;
      const result = pnlPercent >= 0 ? 'win' : 'loss';

      const updatedTrade = await this.dataAgent.updateTrade(openTrade.id, {
        exit_price: currentPrice,
        exit_time: new Date(),
        pnl: pnlPercent,
        result,
      });

      await pool.query(
        'UPDATE strategies SET pnl_total = pnl_total + $1 WHERE id = $2',
        [pnlPercent, this.activeStrategy.id]
      );

      const csvService = require('../services/csvService');
      await csvService.logTrade(this.activeStrategy.id, {
        ...updatedTrade,
        agent_signals: { exitTriggers: exitResult.triggers },
      });

      this.currentTrade = null;
      this.tradeLog.push({ result, pnlPercent, triggers: exitResult.triggers });

      // Run learn agent after each closed trade
      this._emitWorkflow('agent', 'Learn Bot', 'Analyzing trade performance...');
      const learnResult = await this.learnAgent.analyze(
        this.activeStrategy.id,
        { side: openTrade.side, pnl: pnlPercent, result },
        this.conditions
      );
      if (learnResult.insight) {
        this._emitWorkflow('agent', 'Learn Bot Insight', learnResult.insight);
        if (learnResult.suggestion) {
          this._emitWorkflow('agent', 'Learn Bot Suggestion', learnResult.suggestion);
        }
      }
      this._emit('agent:update', { agent: 'learn', data: {
        insight: learnResult.insight,
        suggestion: learnResult.suggestion,
        stats: learnResult.stats,
      }});

      if (result === 'loss') {
        this.consecutiveLosses++;
        this._emitWorkflow('trade', 'Trade closed - LOSS',
          `PnL: ${pnlPercent.toFixed(2)}% | Consecutive losses: ${this.consecutiveLosses}/${this.maxConsecutiveLosses}`);
        this._emit('session:update', { status: 'loss_update', consecutiveLosses: this.consecutiveLosses });

        if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
          this._emitWorkflow('terminate', 'Strategy terminated',
            `${this.maxConsecutiveLosses} consecutive losses reached. Bot shutting down.`);
          await this.stopSession(`Auto-terminated: ${this.maxConsecutiveLosses} consecutive losses`);
          return;
        }
      } else {
        this.consecutiveLosses = 0;
        this._emitWorkflow('trade', 'Trade closed - WIN',
          `PnL: +${pnlPercent.toFixed(2)}% | Loss streak reset`);
        this._emit('session:update', { status: 'loss_update', consecutiveLosses: 0 });
      }

      this._emit('trade:update', { action: 'closed', trade: updatedTrade, triggers: exitResult.triggers });
      this._emitWorkflow('scan', 'Scanning for next entry', 'Looking for new signals...');
    } catch (err) {
      console.error('Trade close error:', err);
      this._emitWorkflow('error', 'Trade close failed', err.message);
    }
  }

  getAgentStatuses() {
    return {
      condition_1: {
        enabled: true,
        description: this.conditions[0] || '',
        lastOutput: this.conditionOne.lastOutput ? {
          longScore: this.conditionOne.lastOutput.longScore,
          shortScore: this.conditionOne.lastOutput.shortScore,
          summary: this.conditionOne.lastOutput.summary,
        } : null,
      },
      condition_2: {
        enabled: true,
        description: this.conditions[1] || '',
        lastOutput: this.conditionTwo.lastOutput ? {
          longScore: this.conditionTwo.lastOutput.longScore,
          shortScore: this.conditionTwo.lastOutput.shortScore,
          summary: this.conditionTwo.lastOutput.summary,
        } : null,
      },
      condition_3: {
        enabled: true,
        description: this.conditions[2] || '',
        lastOutput: this.conditionThree.lastOutput ? {
          longScore: this.conditionThree.lastOutput.longScore,
          shortScore: this.conditionThree.lastOutput.shortScore,
          summary: this.conditionThree.lastOutput.summary,
        } : null,
      },
      entryDecision: {
        enabled: true,
        lastOutput: this.entryDecision.lastOutput ? {
          decision: this.entryDecision.lastOutput.decision,
          avgLong: this.entryDecision.lastOutput.avgLongScore,
          avgShort: this.entryDecision.lastOutput.avgShortScore,
          spread: this.entryDecision.lastOutput.spread,
        } : null,
      },
      exit: {
        enabled: true,
        lastOutput: this.exitAgent.lastOutput ? {
          shouldClose: this.exitAgent.lastOutput.shouldClose,
          pnl: this.exitAgent.lastOutput.leveragedPnlPercent,
          triggers: this.exitAgent.lastOutput.triggers,
        } : null,
      },
      learn: {
        enabled: true,
        lastOutput: this.learnAgent.lastOutput ? {
          insight: this.learnAgent.lastOutput.insight,
          suggestion: this.learnAgent.lastOutput.suggestion,
        } : null,
      },
      data: {
        enabled: true,
        lastOutput: this.dataAgent.lastOutput ? {
          totalTrades: this.dataAgent.lastOutput.totalTrades,
          wins: this.dataAgent.lastOutput.wins,
          losses: this.dataAgent.lastOutput.losses,
          winRate: this.dataAgent.lastOutput.winRate,
          pnl: this.dataAgent.lastOutput.totalPnl,
        } : null,
      },
    };
  }

  getStatus() {
    return {
      running: this.running,
      activeStrategy: this.activeStrategy,
      activeStrategyId: this.activeStrategy?.id || null,
      conditions: this.conditions,
      exitStrategy: this.exitStrategy,
      consecutiveLosses: this.consecutiveLosses,
      pendingSignal: this.pendingSignal ? {
        side: this.pendingSignal.side,
        confidence: this.pendingSignal.confidence,
        entryPrice: this.pendingSignal.entryPrice,
        agentScores: this.pendingSignal.agentResults,
        avgLongScore: this.pendingSignal.avgLongScore,
        avgShortScore: this.pendingSignal.avgShortScore,
        spread: this.pendingSignal.spread,
      } : null,
      hasPendingSignal: !!this.pendingSignal,
      workflowHistory: this.workflowHistory,
    };
  }

  _emitWorkflow(type, title, detail) {
    const entry = { type, title, detail, timestamp: Date.now() };
    this.workflowHistory.push(entry);
    if (this.workflowHistory.length > 200) {
      this.workflowHistory = this.workflowHistory.slice(-200);
    }
    this._emit('workflow:update', entry);
  }

  _emit(event, data) {
    if (this.io) this.io.emit(event, data);
  }
}

module.exports = Orchestrator;
