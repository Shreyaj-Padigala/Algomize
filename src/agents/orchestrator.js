const ConfluenceAgent = require('./confluenceAgent');
const DataAgent = require('./dataAgent');
const MicroTrendAgent = require('./microTrendAgent');
const MacroTrendAgent = require('./macroTrendAgent');
const RSIAgent = require('./rsiAgent');
const ICTAgent = require('./ictAgent');
const FinalDecisionAgent = require('./finalDecisionAgent');
const ExitAgent = require('./exitAgent');
const marketService = require('../services/marketService');
const exchangeService = require('../services/exchangeService');
const pool = require('../db/pool');

class Orchestrator {
  constructor(io) {
    this.io = io;
    this.agents = {
      confluence: new ConfluenceAgent(),
      data: new DataAgent(),
      microTrend: new MicroTrendAgent(),
      macroTrend: new MacroTrendAgent(),
      rsi: new RSIAgent(),
      ict: new ICTAgent(),
      finalDecision: new FinalDecisionAgent(),
      exit: new ExitAgent(),
    };
    this.activeStrategy = null;
    this.sessionTimer = null;
    this.workflowInterval = null;
    this.running = false;
    this.enabledAgents = new Set(Object.keys(this.agents));
    this.lastCycleResults = {};
  }

  async startSession(strategyId) {
    if (this.running) {
      throw new Error('A strategy session is already running');
    }

    // Load strategy
    const stratResult = await pool.query('SELECT * FROM strategies WHERE id = $1', [strategyId]);
    if (stratResult.rows.length === 0) throw new Error('Strategy not found');

    this.activeStrategy = stratResult.rows[0];

    // Load enabled agents for this strategy
    const agentResult = await pool.query(
      'SELECT * FROM strategy_agents WHERE strategy_id = $1',
      [strategyId]
    );
    if (agentResult.rows.length > 0) {
      this.enabledAgents = new Set(
        agentResult.rows.filter((a) => a.is_active).map((a) => a.agent_name)
      );
    }

    // Mark strategy as active
    await pool.query('UPDATE strategies SET session_active = TRUE WHERE id = $1', [strategyId]);

    // Create session record
    const session = await pool.query(
      'INSERT INTO sessions (strategy_id) VALUES ($1) RETURNING *',
      [strategyId]
    );

    this.running = true;
    this._emit('session:update', { status: 'started', strategyId, sessionId: session.rows[0].id });

    // Set leverage
    try {
      await exchangeService.setLeverage('BTC-USDT', this.activeStrategy.leverage);
    } catch (err) {
      console.error('Failed to set leverage:', err.message);
    }

    // Start workflow loop (runs every 60 seconds)
    this.workflowInterval = setInterval(() => this._runWorkflow(), 60000);
    // Run immediately
    this._runWorkflow();

    // Session timer (12 hours)
    const durationMs = 12 * 60 * 60 * 1000;
    this.sessionTimer = setTimeout(() => this.stopSession(), durationMs);

    return { status: 'started', strategyId, sessionId: session.rows[0].id };
  }

  async stopSession() {
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

    this._emit('session:update', { status: 'stopped', strategyId: this.activeStrategy?.id });
    this.activeStrategy = null;

    return { status: 'stopped' };
  }

  async _runWorkflow() {
    if (!this.running || !this.activeStrategy) return;

    try {
      // Fetch market data
      const candles15m = await marketService.getCandles('15m', 200);
      const candles1h = await marketService.getCandles('1h', 200);

      const results = {};

      // Run analysis agents
      if (this.enabledAgents.has('confluence')) {
        results.confluence = await this.agents.confluence.analyze(candles15m, candles1h);
        this._emit('agent:update', { agent: 'confluence', data: results.confluence });
      }

      if (this.enabledAgents.has('microTrend')) {
        results.microTrend = await this.agents.microTrend.analyze(candles15m);
        this._emit('agent:update', { agent: 'microTrend', data: results.microTrend });
      }

      if (this.enabledAgents.has('macroTrend')) {
        results.macroTrend = await this.agents.macroTrend.analyze(candles1h);
        this._emit('agent:update', { agent: 'macroTrend', data: results.macroTrend });
      }

      if (this.enabledAgents.has('rsi')) {
        results.rsi = await this.agents.rsi.analyze(candles15m);
        this._emit('agent:update', { agent: 'rsi', data: results.rsi });
      }

      if (this.enabledAgents.has('ict')) {
        results.ict = await this.agents.ict.analyze(candles15m, candles1h);
        this._emit('agent:update', { agent: 'ict', data: results.ict });
      }

      // Check for open trades - Exit Agent
      const openTrades = await pool.query(
        "SELECT * FROM trades WHERE strategy_id = $1 AND result = 'open'",
        [this.activeStrategy.id]
      );

      if (openTrades.rows.length > 0 && this.enabledAgents.has('exit')) {
        const openTrade = openTrades.rows[0];
        results.exit = await this.agents.exit.analyze({
          openTrade,
          candles15m,
          rsiData: results.rsi,
        });
        this._emit('agent:update', { agent: 'exit', data: results.exit });

        if (results.exit.shouldClose) {
          await this._closeTrade(openTrade, results.exit);
        }
      }

      // Final Decision Agent (only if no open trade)
      if (openTrades.rows.length === 0 && this.enabledAgents.has('finalDecision')) {
        // Get portfolio balance
        let portfolioBalance = 0;
        try {
          const balResult = await exchangeService.getAccountBalance();
          if (balResult.data && balResult.data.length > 0) {
            portfolioBalance = parseFloat(balResult.data[0].totalEq || 0);
          }
        } catch (err) {
          console.error('Failed to fetch balance:', err.message);
        }

        results.finalDecision = await this.agents.finalDecision.analyze({
          confluence: results.confluence,
          microTrend: results.microTrend,
          macroTrend: results.macroTrend,
          rsi: results.rsi,
          ict: results.ict,
          strategyRules: this.activeStrategy.rules || {},
          portfolioBalance,
        });
        this._emit('agent:update', { agent: 'finalDecision', data: results.finalDecision });

        if (results.finalDecision.decision !== 'no_trade') {
          await this._openTrade(results.finalDecision, results);
        }
      }

      // Data agent: update stats
      if (this.enabledAgents.has('data')) {
        results.data = await this.agents.data.analyze(this.activeStrategy.id);
        this._emit('agent:update', { agent: 'data', data: results.data });
      }

      this.lastCycleResults = results;
    } catch (err) {
      console.error('Workflow error:', err);
      this._emit('agent:update', { agent: 'orchestrator', error: err.message });
    }
  }

  async _openTrade(decision, agentResults) {
    try {
      const currentPrice = (await marketService.getCurrentPrice()).price;

      // Execute on exchange
      await exchangeService.placeOrder({
        side: decision.side,
        size: decision.positionSize,
        orderType: 'market',
      });

      // Log trade
      const trade = await this.agents.data.logTrade(this.activeStrategy.id, {
        side: decision.side,
        entry_price: currentPrice,
        position_size: decision.positionSize,
        leverage: this.activeStrategy.leverage,
        entry_time: new Date(),
        result: 'open',
        agent_signals: {
          confluence: agentResults.confluence?.proximitySignal,
          microTrend: agentResults.microTrend?.trend,
          macroTrend: agentResults.macroTrend?.macroTrend,
          rsi: agentResults.rsi?.currentRSI,
          ict: agentResults.ict?.premiumDiscount?.zone,
          decision: decision.decision,
          confidence: decision.confidence,
        },
      });

      this._emit('trade:update', { action: 'opened', trade });

      // Update strategy PnL
      await pool.query(
        'UPDATE strategies SET pnl_total = pnl_total + 0 WHERE id = $1',
        [this.activeStrategy.id]
      );
    } catch (err) {
      console.error('Trade execution error:', err);
    }
  }

  async _closeTrade(openTrade, exitResult) {
    try {
      const currentPrice = exitResult.currentPrice;

      // Close on exchange
      await exchangeService.closePosition();

      // Calculate PnL
      let pnl = exitResult.unrealizedPnl;
      const result = pnl >= 0 ? 'win' : 'loss';

      // Update trade
      const updatedTrade = await this.agents.data.updateTrade(openTrade.id, {
        exit_price: currentPrice,
        exit_time: new Date(),
        pnl,
        result,
      });

      // Update strategy PnL
      await pool.query(
        'UPDATE strategies SET pnl_total = pnl_total + $1 WHERE id = $2',
        [pnl, this.activeStrategy.id]
      );

      // Log to CSV
      const csvService = require('../services/csvService');
      await csvService.logTrade(this.activeStrategy.id, {
        ...updatedTrade,
        agent_signals: { exitTriggers: exitResult.triggers },
      });

      this._emit('trade:update', { action: 'closed', trade: updatedTrade, triggers: exitResult.triggers });
    } catch (err) {
      console.error('Trade close error:', err);
    }
  }

  enableAgent(agentName) {
    this.enabledAgents.add(agentName);
  }

  disableAgent(agentName) {
    this.enabledAgents.delete(agentName);
  }

  getAgentStatuses() {
    const statuses = {};
    for (const [name, agent] of Object.entries(this.agents)) {
      statuses[name] = {
        enabled: this.enabledAgents.has(name),
        lastOutput: agent.lastOutput,
      };
    }
    return statuses;
  }

  getStatus() {
    return {
      running: this.running,
      activeStrategy: this.activeStrategy,
      enabledAgents: [...this.enabledAgents],
      lastCycleResults: this.lastCycleResults,
    };
  }

  _emit(event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }
}

module.exports = Orchestrator;
