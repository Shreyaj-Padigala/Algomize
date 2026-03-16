const ConditionAgent = require('./conditionAgent');
const DataAgent = require('./dataAgent');
const FinalDecisionAgent = require('./finalDecisionAgent');
const ExitAgent = require('./exitAgent');
const RSIAgent = require('./rsiAgent');
const marketService = require('../services/marketService');
const pool = require('../db/pool');

class Orchestrator {
  constructor(io) {
    this.io = io;
    // Create 5 condition agents (user-defined)
    this.conditionAgents = Array.from({ length: 5 }, (_, i) => new ConditionAgent(i));
    this.agents = {
      data: new DataAgent(),
      finalDecision: new FinalDecisionAgent(),
      exit: new ExitAgent(),
      rsi: new RSIAgent(),
    };
    this.activeStrategy = null;
    this.sessionTimer = null;
    this.workflowInterval = null;
    this.running = false;
    this.enabledAgents = new Set(['data', 'finalDecision', 'exit', 'rsi']);
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

    // Parse user-defined conditions from strategy
    this.conditions = [];
    try {
      const conds = this.activeStrategy.conditions;
      if (typeof conds === 'string') {
        this.conditions = JSON.parse(conds);
      } else if (Array.isArray(conds)) {
        this.conditions = conds;
      }
    } catch {
      this.conditions = [];
    }

    await pool.query('UPDATE strategies SET session_active = TRUE WHERE id = $1', [strategyId]);

    const session = await pool.query(
      'INSERT INTO sessions (strategy_id) VALUES ($1) RETURNING *',
      [strategyId]
    );

    this.running = true;
    this._emit('session:update', { status: 'started', strategyId, sessionId: session.rows[0].id });
    this._emitWorkflow('system', 'Bot started', `Strategy: ${this.activeStrategy.name} | ${this.conditions.length} conditions | Looking for entry signals...`);

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

      this._emit('chart:data', {
        candles15m: candles15m.slice(-192),
        candles1h: candles1h.slice(-48),
      });

      const openTrades = await pool.query(
        "SELECT * FROM trades WHERE strategy_id = $1 AND result = 'open'",
        [this.activeStrategy.id]
      );

      const hasOpenTrade = openTrades.rows.length > 0;
      const results = {};

      // EXIT MODE: If we have an open trade, only check exit conditions
      if (hasOpenTrade) {
        results.rsi = await this.agents.rsi.analyze(candles15m);
        this._emitWorkflow('agent', 'RSI',
          `RSI: ${results.rsi.currentRSI}, ${results.rsi.divLabel}`);
        this._emit('agent:update', { agent: 'rsi', data: this._summarizeAgent('rsi', results.rsi) });

        const openTrade = openTrades.rows[0];

        // Check custom exit strategy from conditions
        let customExitPnl = -20; // Default: exit at -20% PNL
        for (const cond of this.conditions) {
          if (cond.exitStrategy && typeof cond.exitPnlPercent === 'number') {
            customExitPnl = cond.exitPnlPercent;
            break;
          }
        }

        results.exit = await this.agents.exit.analyze({
          openTrade,
          candles15m,
          rsiData: results.rsi,
          customExitPnl,
        });
        this._emit('agent:update', { agent: 'exit', data: this._summarizeAgent('exit', results.exit) });

        if (results.exit.shouldClose) {
          this._emitWorkflow('exit', 'Exit signal triggered',
            `Triggers: ${results.exit.triggers.join(', ')} | PnL: ${results.exit.leveragedPnlPercent.toFixed(2)}%`);
          await this._closeTrade(openTrade, results.exit);
        } else {
          const entryPrice = parseFloat(openTrade.entry_price);
          const side = openTrade.side;
          const priceDiff = side === 'buy' ? currentPrice - entryPrice : entryPrice - currentPrice;
          const pnlPercent = (priceDiff / entryPrice * 100 * 100).toFixed(2);
          this._emitWorkflow('holding', 'Position open',
            `${side.toUpperCase()} from $${entryPrice.toLocaleString()} | Current: $${currentPrice.toLocaleString()} | PnL: ${pnlPercent}%`);
        }
      }

      // ENTRY MODE: Run 5 condition agents in parallel
      if (!hasOpenTrade && !this.pendingSignal) {
        const conditionResults = [];

        const conditionTasks = this.conditions.map((condition, i) => {
          return this.conditionAgents[i].analyze(candles15m, candles1h, condition).then(r => {
            conditionResults[i] = r;
            this._emitWorkflow('agent', `Agent ${i + 1}: ${condition.type}`,
              `${r.summary} — ${r.longScore}/10 Long ${r.shortScore}/10 Short`);
            this._emit('agent:update', {
              agent: `condition_${i + 1}`,
              data: {
                type: condition.type,
                description: condition.description,
                longScore: r.longScore,
                shortScore: r.shortScore,
                summary: r.summary,
              },
            });
          });
        });

        await Promise.all(conditionTasks);

        // Run final decision based on condition agents
        const scoringResults = {};
        conditionResults.forEach((r, i) => {
          if (r) {
            scoringResults[`condition_${i + 1}`] = {
              longScore: r.longScore,
              shortScore: r.shortScore,
            };
          }
        });

        results.finalDecision = await this.agents.finalDecision.analyze(scoringResults);
        this._emit('agent:update', { agent: 'finalDecision', data: this._summarizeAgent('finalDecision', results.finalDecision) });

        if (results.finalDecision.decision !== 'no_trade') {
          this._emitWorkflow('signal', 'ENTRY SIGNAL',
            `${results.finalDecision.side === 'buy' ? 'LONG' : 'SHORT'} 100X | Avg Long: ${results.finalDecision.avgLongScore}/10 | Avg Short: ${results.finalDecision.avgShortScore}/10`);

          this.pendingSignal = {
            ...results.finalDecision,
            entryPrice: currentPrice,
            timestamp: Date.now(),
            agentResults: results.finalDecision.agentScores,
          };

          this._emit('signal:prompt', {
            side: results.finalDecision.side,
            confidence: results.finalDecision.confidence,
            entryPrice: currentPrice,
            avgLongScore: results.finalDecision.avgLongScore,
            avgShortScore: results.finalDecision.avgShortScore,
            agentScores: results.finalDecision.agentScores,
            message: 'Do you want to place this trade for 100X Leverage?',
          });
        } else {
          this._emitWorkflow('scan', 'No signal',
            `Avg Long: ${results.finalDecision.avgLongScore}/10 | Avg Short: ${results.finalDecision.avgShortScore}/10 | Need: ${results.finalDecision.threshold}/10 — Waiting...`);
        }

        // Store condition results in lastCycleResults for voice agent
        results.conditions = conditionResults;
      }

      // Data agent
      results.data = await this.agents.data.analyze(this.activeStrategy.id);
      this._emit('agent:update', { agent: 'data', data: this._summarizeAgent('data', results.data) });

      this.lastCycleResults = results;
    } catch (err) {
      console.error('Workflow error:', err);
      this._emitWorkflow('error', 'Workflow error', err.message);
    }
  }

  async _openTrade(signal) {
    try {
      const currentPrice = signal.entryPrice;
      const trade = await this.agents.data.logTrade(this.activeStrategy.id, {
        side: signal.side,
        entry_price: currentPrice,
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

      const updatedTrade = await this.agents.data.updateTrade(openTrade.id, {
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

  _summarizeAgent(name, data) {
    switch (name) {
      case 'rsi':
        return {
          rsi: data.currentRSI, condition: data.condition, divLabel: data.divLabel,
          longScore: data.longScore, shortScore: data.shortScore,
        };
      case 'finalDecision':
        return {
          decision: data.decision, side: data.side,
          avgLong: data.avgLongScore, avgShort: data.avgShortScore,
          agentScores: data.agentScores,
        };
      case 'exit':
        return {
          shouldClose: data.shouldClose, triggers: data.triggers,
          pnl: data.unrealizedPnl, elapsed: data.elapsed,
        };
      case 'data':
        return {
          totalTrades: data.totalTrades, wins: data.wins,
          losses: data.losses, winRate: data.winRate, pnl: data.totalPnl,
        };
      default:
        return data;
    }
  }

  getAgentStatuses() {
    const statuses = {};
    // Report condition agents
    this.conditionAgents.forEach((agent, i) => {
      statuses[`condition_${i + 1}`] = {
        enabled: true,
        conditionType: this.conditions[i]?.type || 'unconfigured',
        description: this.conditions[i]?.description || '',
        lastOutput: agent.lastOutput ? {
          longScore: agent.lastOutput.longScore,
          shortScore: agent.lastOutput.shortScore,
          summary: agent.lastOutput.summary,
        } : null,
      };
    });
    // Report system agents
    for (const [name, agent] of Object.entries(this.agents)) {
      statuses[name] = {
        enabled: this.enabledAgents.has(name),
        lastOutput: agent.lastOutput ? this._summarizeAgent(name, agent.lastOutput) : null,
      };
    }
    return statuses;
  }

  getStatus() {
    return {
      running: this.running,
      activeStrategy: this.activeStrategy,
      activeStrategyId: this.activeStrategy?.id || null,
      conditions: this.conditions || [],
      consecutiveLosses: this.consecutiveLosses,
      pendingSignal: this.pendingSignal ? {
        side: this.pendingSignal.side,
        confidence: this.pendingSignal.confidence,
        entryPrice: this.pendingSignal.entryPrice,
        agentScores: this.pendingSignal.agentResults,
        avgLongScore: this.pendingSignal.avgLongScore,
        avgShortScore: this.pendingSignal.avgShortScore,
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
