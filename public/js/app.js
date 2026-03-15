const API_BASE = '';
const socket = io();

// State
let strategies = [];
let selectedStrategyId = parseInt(localStorage.getItem('selectedStrategyId')) || null;
let sessionRunning = false;
let workflowCount = 0;
let priceChart = null;
let candleSeries = null;

// DOM
const els = {
  currentPrice: document.getElementById('currentPrice'),
  connectionDot: document.getElementById('connectionDot'),
  statusText: document.getElementById('statusText'),
  sessionStatus: document.getElementById('sessionStatus'),
  btnStartSession: document.getElementById('btnStartSession'),
  btnStopSession: document.getElementById('btnStopSession'),
  strategyName: document.getElementById('strategyName'),
  btnCreateStrategy: document.getElementById('btnCreateStrategy'),
  strategyList: document.getElementById('strategyList'),
  agentList: document.getElementById('agentList'),
  sessionPnl: document.getElementById('sessionPnl'),
  lifetimePnl: document.getElementById('lifetimePnl'),
  winRate: document.getElementById('winRate'),
  tradeCount: document.getElementById('tradeCount'),
  workflowFeed: document.getElementById('workflowFeed'),
  workflowCount: document.getElementById('workflowCount'),
  signalOverlay: document.getElementById('signalOverlay'),
  signalSide: document.getElementById('signalSide'),
  signalPrice: document.getElementById('signalPrice'),
  signalConfidence: document.getElementById('signalConfidence'),
  signalScores: document.getElementById('signalScores'),
  btnAcceptSignal: document.getElementById('btnAcceptSignal'),
  btnRejectSignal: document.getElementById('btnRejectSignal'),
  exchangeState: document.getElementById('exchangeState'),
  botStatus: document.getElementById('botStatus'),
  loss1: document.getElementById('loss1'),
  loss2: document.getElementById('loss2'),
  loss3: document.getElementById('loss3'),
  chartUpdateTime: document.getElementById('chartUpdateTime'),
};

// ---------- Cash Register Sound ----------
function playCashRegister() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Ka-ching! sound: short metallic hit + bell ring
    const now = ctx.currentTime;

    // Hit sound
    const hitOsc = ctx.createOscillator();
    const hitGain = ctx.createGain();
    hitOsc.type = 'square';
    hitOsc.frequency.setValueAtTime(800, now);
    hitOsc.frequency.exponentialRampToValueAtTime(200, now + 0.05);
    hitGain.gain.setValueAtTime(0.3, now);
    hitGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    hitOsc.connect(hitGain).connect(ctx.destination);
    hitOsc.start(now);
    hitOsc.stop(now + 0.1);

    // Bell ring 1
    const bell1 = ctx.createOscillator();
    const bell1Gain = ctx.createGain();
    bell1.type = 'sine';
    bell1.frequency.setValueAtTime(2000, now + 0.05);
    bell1Gain.gain.setValueAtTime(0.2, now + 0.05);
    bell1Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    bell1.connect(bell1Gain).connect(ctx.destination);
    bell1.start(now + 0.05);
    bell1.stop(now + 0.6);

    // Bell ring 2 (higher)
    const bell2 = ctx.createOscillator();
    const bell2Gain = ctx.createGain();
    bell2.type = 'sine';
    bell2.frequency.setValueAtTime(2500, now + 0.15);
    bell2Gain.gain.setValueAtTime(0.15, now + 0.15);
    bell2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    bell2.connect(bell2Gain).connect(ctx.destination);
    bell2.start(now + 0.15);
    bell2.stop(now + 0.8);

    // Bell ring 3 (highest - the ching!)
    const bell3 = ctx.createOscillator();
    const bell3Gain = ctx.createGain();
    bell3.type = 'sine';
    bell3.frequency.setValueAtTime(3200, now + 0.25);
    bell3Gain.gain.setValueAtTime(0.2, now + 0.25);
    bell3Gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    bell3.connect(bell3Gain).connect(ctx.destination);
    bell3.start(now + 0.25);
    bell3.stop(now + 1.2);

    setTimeout(() => ctx.close(), 2000);
  } catch (e) {
    // AudioContext not available
  }
}

// ---------- Charts ----------
function initCharts() {
  const chartColors = {
    background: '#1a1a2e',
    textColor: '#7f8c8d',
    gridColor: 'rgba(35, 53, 84, 0.3)',
  };

  // Price chart
  const priceContainer = document.getElementById('priceChart');
  priceChart = LightweightCharts.createChart(priceContainer, {
    width: priceContainer.clientWidth,
    height: priceContainer.clientHeight,
    layout: {
      background: { type: 'solid', color: chartColors.background },
      textColor: chartColors.textColor,
      fontSize: 10,
    },
    grid: {
      vertLines: { color: chartColors.gridColor },
      horzLines: { color: chartColors.gridColor },
    },
    crosshair: { mode: 0 },
    rightPriceScale: { borderColor: '#233554' },
    timeScale: {
      borderColor: '#233554',
      timeVisible: true,
      secondsVisible: false,
    },
  });

  candleSeries = priceChart.addCandlestickSeries({
    upColor: '#00d2ff',
    downColor: '#e94560',
    borderUpColor: '#00d2ff',
    borderDownColor: '#e94560',
    wickUpColor: '#00d2ff',
    wickDownColor: '#e94560',
  });

  // Resize handler
  const resizeObserver = new ResizeObserver(() => {
    priceChart.applyOptions({ width: priceContainer.clientWidth, height: priceContainer.clientHeight });
  });
  resizeObserver.observe(priceContainer);
}

function updateCharts(candles15m) {
  if (!candleSeries || !candles15m || candles15m.length === 0) return;

  const candleData = candles15m.map(c => ({
    time: Math.floor(c.timestamp / 1000),
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
  })).sort((a, b) => a.time - b.time);

  candleSeries.setData(candleData);
  els.chartUpdateTime.textContent = new Date().toLocaleTimeString();
}

// ---------- API ----------
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

// ---------- Socket Events ----------
socket.on('connect', () => {
  updateConnectionStatus(true);
  socket.emit('market:subscribe');
});

socket.on('disconnect', () => updateConnectionStatus(false));

socket.on('market:update', (data) => {
  els.currentPrice.textContent = `$${parseFloat(data.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
});

socket.on('chart:data', (data) => {
  if (data.candles15m) {
    updateCharts(data.candles15m);
  }
});

// Real-time candle updates from BloFin WebSocket
socket.on('chart:update', (data) => {
  if (!candleSeries || !data.candle || data.timeframe !== '15m') return;
  const c = data.candle;
  candleSeries.update({
    time: Math.floor(c.timestamp / 1000),
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
  });
  els.chartUpdateTime.textContent = new Date().toLocaleTimeString();
});

socket.on('agent:update', () => loadAgentStatuses());

socket.on('trade:update', () => {
  loadPerformance();
});

socket.on('session:update', (data) => {
  if (data.status === 'started') {
    sessionRunning = true;
    els.sessionStatus.textContent = 'Running';
    els.sessionStatus.style.color = 'var(--success)';
    setBotIndicator(true);
    clearWorkflow();
  } else if (data.status === 'loss_update') {
    updateLossDots(data.consecutiveLosses || 0);
  } else {
    sessionRunning = false;
    els.sessionStatus.textContent = data.reason || 'Stopped';
    els.sessionStatus.style.color = 'var(--text-dim)';
    setBotIndicator(false);
    els.signalOverlay.style.display = 'none';
  }
  updateSessionButtons();
});

socket.on('workflow:update', (data) => addWorkflowEntry(data));

socket.on('signal:prompt', (data) => {
  playCashRegister();
  showSignalPrompt(data);
});

// ---------- UI Helpers ----------
function updateConnectionStatus(connected) {
  els.connectionDot.className = `connection-dot ${connected ? 'connected' : ''}`;
  els.statusText.textContent = connected ? 'Connected' : 'Disconnected';
}

function setBotIndicator(active) {
  const indicator = els.botStatus.querySelector('.bot-indicator');
  indicator.className = `bot-indicator ${active ? 'active' : 'inactive'}`;
}

function updateSessionButtons() {
  els.btnStartSession.disabled = sessionRunning || !selectedStrategyId;
  els.btnStopSession.disabled = !sessionRunning;
}

// Workflow
const WF_ICONS = {
  scan: '~', agent: '>', signal: '!', trade: '$',
  exit: 'x', holding: '=', system: '*', error: '!', terminate: 'X',
};

function clearWorkflow() {
  workflowCount = 0;
  els.workflowFeed.innerHTML = '';
  els.workflowCount.textContent = '0 events';
}

function addWorkflowEntry(data) {
  const empty = els.workflowFeed.querySelector('.workflow-empty');
  if (empty) empty.remove();
  workflowCount++;
  els.workflowCount.textContent = `${workflowCount} events`;

  const time = new Date(data.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = 'wf-entry';
  entry.innerHTML = `
    <span class="wf-time">${time}</span>
    <span class="wf-icon ${data.type}">${WF_ICONS[data.type] || '>'}</span>
    <div class="wf-body">
      <span class="wf-title">${data.title}</span>
      <div class="wf-detail">${data.detail}</div>
    </div>
  `;
  els.workflowFeed.appendChild(entry);
  els.workflowFeed.scrollTop = els.workflowFeed.scrollHeight;
}

// Signal prompt
const AGENT_LABELS = {
  confluence: 'Confluence', microTrend: 'Micro Trend', macroTrend: 'Macro Trend',
  rsi: 'RSI', ict: 'ICT',
};

function showSignalPrompt(data) {
  els.signalOverlay.style.display = 'flex';
  els.signalSide.textContent = data.side === 'buy' ? 'LONG' : 'SHORT';
  els.signalSide.className = `signal-side ${data.side}`;
  els.signalPrice.textContent = `$${parseFloat(data.entryPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  els.signalConfidence.textContent = `${(data.confidence * 100).toFixed(0)}%`;

  // Show per-agent scores
  if (data.agentScores) {
    els.signalScores.innerHTML = Object.entries(data.agentScores).map(([name, s]) => `
      <div class="score-row">
        <span class="score-agent">${AGENT_LABELS[name] || name}</span>
        <span class="score-values">
          <span class="score-long">${s.longScore}/10 Long</span>
          <span class="score-short">${s.shortScore}/10 Short</span>
        </span>
      </div>
    `).join('') + `
      <div class="score-row" style="border-top: 1px solid var(--border); padding-top: 4px; margin-top: 4px;">
        <span class="score-agent" style="color: var(--text-primary);">Average</span>
        <span class="score-values">
          <span class="score-long">${data.avgLongScore}/10 Long</span>
          <span class="score-short">${data.avgShortScore}/10 Short</span>
        </span>
      </div>
    `;
  }

  // No need to scroll — overlay is fixed and centered
}

els.btnAcceptSignal.addEventListener('click', async () => {
  els.signalOverlay.style.display = 'none';
  await api('/api/session/signal/respond', {
    method: 'POST',
    body: JSON.stringify({ accepted: true }),
  });
});

els.btnRejectSignal.addEventListener('click', async () => {
  els.signalOverlay.style.display = 'none';
  await api('/api/session/signal/respond', {
    method: 'POST',
    body: JSON.stringify({ accepted: false }),
  });
});

// Loss dots
function updateLossDots(count) {
  [els.loss1, els.loss2, els.loss3].forEach((dot, i) => {
    dot.className = `loss-dot ${i < count ? 'hit' : ''}`;
  });
}

// Strategies
async function loadStrategies() {
  strategies = await api('/api/strategies');
  renderStrategies();
}

function renderStrategies() {
  if (strategies.length === 0) {
    els.strategyList.innerHTML = '<div style="color: var(--text-dim); font-size: 11px; padding: 4px;">No strategies yet</div>';
    return;
  }
  els.strategyList.innerHTML = strategies.map((s) => `
    <div class="strategy-item ${selectedStrategyId === s.id ? 'selected' : ''}" onclick="selectStrategy(${s.id})">
      <div>
        <span class="name">${s.name}</span>
        <div class="meta">PnL: ${parseFloat(s.pnl_total || 0).toFixed(2)}%</div>
      </div>
      <div class="actions">
        <button class="btn-sm" onclick="event.stopPropagation(); deleteStrategy(${s.id})">del</button>
      </div>
    </div>
  `).join('');
}

function selectStrategy(id) {
  selectedStrategyId = id;
  localStorage.setItem('selectedStrategyId', id);
  renderStrategies();
  updateSessionButtons();
  loadPerformance();
}

els.btnCreateStrategy.addEventListener('click', async () => {
  const name = els.strategyName.value.trim();
  if (!name) return;
  await api('/api/strategies', {
    method: 'POST',
    body: JSON.stringify({ name, leverage: 100 }),
  });
  els.strategyName.value = '';
  loadStrategies();
});

async function deleteStrategy(id) {
  await api(`/api/strategies/${id}`, { method: 'DELETE' });
  if (selectedStrategyId === id) selectedStrategyId = null;
  loadStrategies();
}

// Session
els.btnStartSession.addEventListener('click', async () => {
  if (!selectedStrategyId) return;
  try {
    const result = await api('/api/session/start', {
      method: 'POST',
      body: JSON.stringify({ strategyId: selectedStrategyId }),
    });
    if (result.error) {
      addWorkflowEntry({ type: 'error', title: 'Error', detail: result.error, timestamp: Date.now() });
    }
  } catch (err) {
    addWorkflowEntry({ type: 'error', title: 'Error', detail: err.message, timestamp: Date.now() });
  }
});

els.btnStopSession.addEventListener('click', async () => {
  await api('/api/session/stop', { method: 'POST' });
});

// Agents
const AGENT_NAMES = ['confluence', 'microTrend', 'macroTrend', 'rsi', 'ict', 'finalDecision', 'exit', 'data'];
const AGENT_LABELS_FULL = {
  confluence: 'Confluence', microTrend: 'Micro Trend', macroTrend: 'Macro Trend',
  rsi: 'RSI', ict: 'ICT', finalDecision: 'Decision', exit: 'Exit', data: 'Data',
};

function renderAgents(statuses) {
  els.agentList.innerHTML = AGENT_NAMES.map((name) => {
    const status = statuses?.[name];
    const hasOutput = !!status?.lastOutput;
    const lo = status?.lastOutput;
    let scoreText = '';
    if (hasOutput && lo?.longScore !== undefined) {
      scoreText = `${lo.longScore}L/${lo.shortScore}S`;
    }
    return `
      <div class="agent-row">
        <span class="agent-name">${AGENT_LABELS_FULL[name]}</span>
        ${scoreText ? `<span class="agent-badge active">${scoreText}</span>` :
          `<span class="agent-badge ${hasOutput ? 'active' : 'idle'}">${hasOutput ? 'active' : 'idle'}</span>`}
      </div>
    `;
  }).join('');
}

async function loadAgentStatuses() {
  try {
    const statuses = await api('/api/agents/status');
    renderAgents(statuses);
  } catch (e) {}
}

// Performance
async function loadPerformance() {
  try {
    const params = selectedStrategyId ? `?strategyId=${selectedStrategyId}` : '';
    const perf = await api(`/api/history/performance${params}`);
    els.lifetimePnl.textContent = `${(perf.totalPnl || 0).toFixed(2)}%`;
    els.lifetimePnl.className = `perf-value ${perf.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
    els.winRate.textContent = `${perf.winRate || 0}%`;
    els.tradeCount.textContent = perf.totalTrades || 0;
  } catch (e) {}
}

async function loadDashboardSummary() {
  try {
    const summary = await api('/api/dashboard/summary');
    els.sessionPnl.textContent = `${(summary.totalPnl || 0).toFixed(2)}%`;
    els.sessionPnl.className = `perf-value ${summary.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
  } catch (e) {}
}

async function checkExchange() {
  try {
    const result = await api('/api/exchange/status');
    els.exchangeState.textContent = result.connected ? 'Connected' : 'Not connected';
    els.exchangeState.className = `exchange-state ${result.connected ? 'connected' : ''}`;
  } catch (e) {
    els.exchangeState.textContent = 'Error';
  }
}

async function checkSessionStatus() {
  try {
    const status = await api('/api/session/status');
    sessionRunning = status.running;
    if (status.running) {
      els.sessionStatus.textContent = 'Running';
      els.sessionStatus.style.color = 'var(--success)';
      setBotIndicator(true);
      // Auto-select the active strategy so controls work after navigation
      if (status.activeStrategyId) {
        selectedStrategyId = status.activeStrategyId;
        localStorage.setItem('selectedStrategyId', status.activeStrategyId);
        renderStrategies();
      }
      // Replay workflow history from server
      if (status.workflowHistory && status.workflowHistory.length > 0) {
        clearWorkflow();
        status.workflowHistory.forEach(entry => addWorkflowEntry(entry));
      }
    }
    if (status.consecutiveLosses !== undefined) updateLossDots(status.consecutiveLosses);
    if (status.hasPendingSignal && status.pendingSignal) {
      showSignalPrompt(status.pendingSignal);
    }
    updateSessionButtons();
  } catch (e) {}
}

// Load initial chart data
async function loadInitialChartData() {
  try {
    const data = await api('/api/chart/btcusdt/15m');
    if (data.candles) {
      updateCharts(data.candles);
    }
  } catch (e) {
    console.log('Chart data not available yet');
  }
}

// Init
async function init() {
  initCharts();

  await loadStrategies();
  await loadAgentStatuses();
  await loadPerformance();
  await checkSessionStatus();
  await loadDashboardSummary();
  await checkExchange();
  await loadInitialChartData();

  api('/api/exchange/connect', { method: 'POST' }).then(() => checkExchange());

  setInterval(loadAgentStatuses, 30000);
  setInterval(loadPerformance, 30000);
  setInterval(loadDashboardSummary, 30000);
  setInterval(checkExchange, 60000);
  setInterval(loadInitialChartData, 60000); // Refresh chart every minute
}

init();
