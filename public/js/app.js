const API_BASE = '';
const socket = io();

// State
let strategies = [];
let selectedStrategyId = null;
let sessionRunning = false;
let workflowCount = 0;

// DOM Elements
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
  tradesBody: document.getElementById('tradesBody'),
  workflowFeed: document.getElementById('workflowFeed'),
  workflowCount: document.getElementById('workflowCount'),
  signalPrompt: document.getElementById('signalPrompt'),
  signalSide: document.getElementById('signalSide'),
  signalPrice: document.getElementById('signalPrice'),
  signalConfidence: document.getElementById('signalConfidence'),
  btnAcceptSignal: document.getElementById('btnAcceptSignal'),
  btnRejectSignal: document.getElementById('btnRejectSignal'),
  exchangeState: document.getElementById('exchangeState'),
  botStatus: document.getElementById('botStatus'),
  loss1: document.getElementById('loss1'),
  loss2: document.getElementById('loss2'),
  loss3: document.getElementById('loss3'),
};

// API helper
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

// Socket events
socket.on('connect', () => {
  updateConnectionStatus(true);
  socket.emit('market:subscribe');
});

socket.on('disconnect', () => updateConnectionStatus(false));

socket.on('market:update', (data) => {
  els.currentPrice.textContent = `$${parseFloat(data.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
});

socket.on('agent:update', (data) => {
  loadAgentStatuses();
});

socket.on('trade:update', () => {
  loadRecentTrades();
  loadPerformance();
});

socket.on('session:update', (data) => {
  if (data.status === 'started') {
    sessionRunning = true;
    els.sessionStatus.textContent = 'Running';
    els.sessionStatus.style.color = 'var(--success)';
    setBotIndicator(true);
    clearWorkflow();
  } else {
    sessionRunning = false;
    els.sessionStatus.textContent = data.reason || 'Stopped';
    els.sessionStatus.style.color = 'var(--text-dim)';
    setBotIndicator(false);
    els.signalPrompt.style.display = 'none';
  }
  updateSessionButtons();
  updateLossDots(0);
});

socket.on('workflow:update', (data) => {
  addWorkflowEntry(data);
});

socket.on('signal:prompt', (data) => {
  showSignalPrompt(data);
});

// Connection status
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

// Workflow feed
const WF_ICONS = {
  scan: '~',
  agent: '>',
  signal: '!',
  trade: '$',
  exit: 'x',
  holding: '=',
  system: '*',
  error: '!',
  terminate: 'X',
};

function clearWorkflow() {
  workflowCount = 0;
  els.workflowFeed.innerHTML = '';
  els.workflowCount.textContent = '0 events';
}

function addWorkflowEntry(data) {
  // Remove empty state if present
  const empty = els.workflowFeed.querySelector('.workflow-empty');
  if (empty) empty.remove();

  workflowCount++;
  els.workflowCount.textContent = `${workflowCount} events`;

  const time = new Date(data.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const icon = WF_ICONS[data.type] || '>';

  const entry = document.createElement('div');
  entry.className = 'wf-entry';
  entry.innerHTML = `
    <span class="wf-time">${time}</span>
    <span class="wf-icon ${data.type}">${icon}</span>
    <div class="wf-body">
      <span class="wf-title">${data.title}</span>
      <div class="wf-detail">${data.detail}</div>
    </div>
  `;

  els.workflowFeed.appendChild(entry);
  els.workflowFeed.scrollTop = els.workflowFeed.scrollHeight;
}

// Signal prompt
function showSignalPrompt(data) {
  els.signalPrompt.style.display = 'block';
  els.signalSide.textContent = data.side === 'buy' ? 'LONG' : 'SHORT';
  els.signalSide.className = `signal-side ${data.side}`;
  els.signalPrice.textContent = `$${parseFloat(data.entryPrice).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  els.signalConfidence.textContent = `${(data.confidence * 100).toFixed(0)}%`;

  // Scroll to signal
  els.signalPrompt.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

els.btnAcceptSignal.addEventListener('click', async () => {
  els.signalPrompt.style.display = 'none';
  await api('/api/session/signal/respond', {
    method: 'POST',
    body: JSON.stringify({ accepted: true }),
  });
});

els.btnRejectSignal.addEventListener('click', async () => {
  els.signalPrompt.style.display = 'none';
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
        <div class="meta">PnL: $${parseFloat(s.pnl_total || 0).toFixed(2)}</div>
      </div>
      <div class="actions">
        <button class="btn-sm" onclick="event.stopPropagation(); deleteStrategy(${s.id})">del</button>
      </div>
    </div>
  `).join('');
}

function selectStrategy(id) {
  selectedStrategyId = id;
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

// Session controls
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
const AGENT_LABELS = {
  confluence: 'Confluence',
  microTrend: 'Micro Trend',
  macroTrend: 'Macro Trend',
  rsi: 'RSI',
  ict: 'ICT',
  finalDecision: 'Decision',
  exit: 'Exit',
  data: 'Data',
};

function renderAgents(statuses) {
  els.agentList.innerHTML = AGENT_NAMES.map((name) => {
    const status = statuses?.[name];
    const hasOutput = !!status?.lastOutput;
    const badgeClass = hasOutput ? 'active' : 'idle';
    const badgeText = hasOutput ? 'active' : 'idle';
    return `
      <div class="agent-row">
        <span class="agent-name">${AGENT_LABELS[name]}</span>
        <span class="agent-badge ${badgeClass}">${badgeText}</span>
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
    els.lifetimePnl.textContent = `$${(perf.totalPnl || 0).toFixed(2)}`;
    els.lifetimePnl.className = `perf-value ${perf.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
    els.winRate.textContent = `${perf.winRate || 0}%`;
    els.tradeCount.textContent = perf.totalTrades || 0;
  } catch (e) {}
}

// Recent trades
async function loadRecentTrades() {
  try {
    const trades = await api('/api/dashboard/trades');
    els.tradesBody.innerHTML = trades.map((t) => `
      <tr>
        <td>${t.id}</td>
        <td class="trade-${t.side}">${t.side.toUpperCase()}</td>
        <td>$${parseFloat(t.entry_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
        <td>${t.exit_price ? '$' + parseFloat(t.exit_price).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '--'}</td>
        <td class="${parseFloat(t.pnl || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}">
          ${t.pnl ? '$' + parseFloat(t.pnl).toFixed(2) : '--'}
        </td>
        <td class="${t.result === 'win' ? 'trade-win' : t.result === 'loss' ? 'trade-loss' : 'trade-open'}">
          ${t.result || 'open'}
        </td>
        <td>${t.entry_time ? new Date(t.entry_time).toLocaleTimeString() : '--'}</td>
      </tr>
    `).join('');
  } catch (e) {}
}

// Dashboard summary
async function loadDashboardSummary() {
  try {
    const summary = await api('/api/dashboard/summary');
    els.sessionPnl.textContent = `$${(summary.totalPnl || 0).toFixed(2)}`;
    els.sessionPnl.className = `perf-value ${summary.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
  } catch (e) {}
}

// Check exchange status
async function checkExchange() {
  try {
    const result = await api('/api/exchange/status');
    els.exchangeState.textContent = result.connected ? 'Connected' : 'Not connected';
    els.exchangeState.className = `exchange-state ${result.connected ? 'connected' : ''}`;
  } catch (e) {
    els.exchangeState.textContent = 'Error';
  }
}

// Session status
async function checkSessionStatus() {
  try {
    const status = await api('/api/session/status');
    sessionRunning = status.running;
    if (status.running) {
      els.sessionStatus.textContent = 'Running';
      els.sessionStatus.style.color = 'var(--success)';
      setBotIndicator(true);
    }
    if (status.consecutiveLosses !== undefined) {
      updateLossDots(status.consecutiveLosses);
    }
    updateSessionButtons();
  } catch (e) {}
}

// Init
async function init() {
  await loadStrategies();
  await loadAgentStatuses();
  await loadRecentTrades();
  await loadPerformance();
  await checkSessionStatus();
  await loadDashboardSummary();
  await checkExchange();

  // Auto-connect exchange from .env
  api('/api/exchange/connect', { method: 'POST' }).then(() => checkExchange());

  setInterval(loadAgentStatuses, 30000);
  setInterval(loadRecentTrades, 30000);
  setInterval(loadPerformance, 30000);
  setInterval(loadDashboardSummary, 30000);
  setInterval(checkExchange, 60000);
}

init();
