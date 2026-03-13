const API_BASE = '';
const socket = io();

// State
let strategies = [];
let selectedStrategyId = null;
let sessionRunning = false;

// DOM Elements
const els = {
  currentPrice: document.getElementById('currentPrice'),
  priceChange: document.getElementById('priceChange'),
  connectionStatus: document.getElementById('connectionStatus'),
  statusText: document.getElementById('statusText'),
  sessionStatus: document.getElementById('sessionStatus'),
  btnStartSession: document.getElementById('btnStartSession'),
  btnStopSession: document.getElementById('btnStopSession'),
  strategyName: document.getElementById('strategyName'),
  strategyLeverage: document.getElementById('strategyLeverage'),
  btnCreateStrategy: document.getElementById('btnCreateStrategy'),
  strategyList: document.getElementById('strategyList'),
  agentList: document.getElementById('agentList'),
  sessionPnl: document.getElementById('sessionPnl'),
  lifetimePnl: document.getElementById('lifetimePnl'),
  winRate: document.getElementById('winRate'),
  tradeCount: document.getElementById('tradeCount'),
  tradesBody: document.getElementById('tradesBody'),
  agentOutputs: document.getElementById('agentOutputs'),
  apiKey: document.getElementById('apiKey'),
  apiSecret: document.getElementById('apiSecret'),
  passphrase: document.getElementById('passphrase'),
  btnConnect: document.getElementById('btnConnect'),
  btnDisconnect: document.getElementById('btnDisconnect'),
  exchangeStatus: document.getElementById('exchangeStatus'),
};

// API helpers
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
  els.currentPrice.textContent = `$${data.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
});

socket.on('agent:update', (data) => {
  updateAgentOutput(data.agent, data);
});

socket.on('trade:update', (data) => {
  loadRecentTrades();
  loadPerformance();
});

socket.on('session:update', (data) => {
  if (data.status === 'started') {
    sessionRunning = true;
    els.sessionStatus.textContent = 'Session Active';
    els.sessionStatus.style.color = 'var(--success)';
  } else {
    sessionRunning = false;
    els.sessionStatus.textContent = 'Session Ended';
    els.sessionStatus.style.color = 'var(--text-secondary)';
  }
  updateSessionButtons();
});

function updateConnectionStatus(connected) {
  const dot = els.connectionStatus.querySelector('.dot');
  dot.className = `dot ${connected ? 'connected' : 'disconnected'}`;
  els.statusText.textContent = connected ? 'Connected' : 'Disconnected';
}

function updateSessionButtons() {
  els.btnStartSession.disabled = sessionRunning || !selectedStrategyId;
  els.btnStopSession.disabled = !sessionRunning;
}

// Strategies
async function loadStrategies() {
  strategies = await api('/api/strategies');
  renderStrategies();
}

function renderStrategies() {
  els.strategyList.innerHTML = strategies.map((s) => `
    <div class="strategy-item ${selectedStrategyId === s.id ? 'selected' : ''}" data-id="${s.id}">
      <div>
        <span class="name">${s.name}</span>
        <span class="meta"> | Leverage: ${s.leverage}x | PnL: $${parseFloat(s.pnl_total || 0).toFixed(2)}</span>
        ${s.session_active ? '<span class="badge active">Active</span>' : ''}
      </div>
      <div class="actions">
        <button class="btn btn-primary btn-select" onclick="selectStrategy(${s.id})">Select</button>
        <button class="btn btn-danger btn-delete" onclick="deleteStrategy(${s.id})">Delete</button>
      </div>
    </div>
  `).join('');
}

async function selectStrategy(id) {
  selectedStrategyId = id;
  renderStrategies();
  updateSessionButtons();
  loadPerformance();
}

els.btnCreateStrategy.addEventListener('click', async () => {
  const name = els.strategyName.value.trim();
  const leverage = parseInt(els.strategyLeverage.value) || 1;
  if (!name) return;

  await api('/api/strategies', {
    method: 'POST',
    body: JSON.stringify({ name, leverage }),
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
  await api('/api/session/start', {
    method: 'POST',
    body: JSON.stringify({ strategyId: selectedStrategyId }),
  });
});

els.btnStopSession.addEventListener('click', async () => {
  await api('/api/session/stop', { method: 'POST' });
});

// Exchange connection
els.btnConnect.addEventListener('click', async () => {
  const result = await api('/api/exchange/connect', {
    method: 'POST',
    body: JSON.stringify({
      apiKey: els.apiKey.value,
      apiSecret: els.apiSecret.value,
      passphrase: els.passphrase.value,
    }),
  });
  els.exchangeStatus.textContent = result.connected ? 'Connected to BloFin' : 'Connection failed';
  els.exchangeStatus.style.color = result.connected ? 'var(--success)' : 'var(--danger)';
});

els.btnDisconnect.addEventListener('click', async () => {
  await api('/api/exchange/disconnect', { method: 'DELETE' });
  els.exchangeStatus.textContent = 'Disconnected';
  els.exchangeStatus.style.color = 'var(--text-secondary)';
});

// Agents
const AGENT_NAMES = ['confluence', 'microTrend', 'macroTrend', 'rsi', 'ict', 'finalDecision', 'exit', 'data'];

function renderAgents(statuses) {
  els.agentList.innerHTML = AGENT_NAMES.map((name) => {
    const status = statuses?.[name];
    const enabled = status?.enabled ?? true;
    const hasOutput = !!status?.lastOutput;
    const badgeClass = enabled ? (hasOutput ? 'active' : 'idle') : 'inactive';
    const badgeText = enabled ? (hasOutput ? 'Active' : 'Idle') : 'Off';
    return `
      <div class="agent-card">
        <span class="agent-name">${name}</span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
  }).join('');
}

async function loadAgentStatuses() {
  const statuses = await api('/api/agents/status');
  renderAgents(statuses);
}

function updateAgentOutput(agentName, data) {
  const existing = document.getElementById(`output-${agentName}`);
  const card = `
    <div class="agent-output-card" id="output-${agentName}">
      <h3>${agentName}</h3>
      <pre>${JSON.stringify(data.data || data, null, 2).slice(0, 500)}</pre>
    </div>
  `;
  if (existing) {
    existing.outerHTML = card;
  } else {
    els.agentOutputs.insertAdjacentHTML('beforeend', card);
  }
}

// Performance
async function loadPerformance() {
  const params = selectedStrategyId ? `?strategyId=${selectedStrategyId}` : '';
  const perf = await api(`/api/history/performance${params}`);

  els.lifetimePnl.textContent = `$${(perf.totalPnl || 0).toFixed(2)}`;
  els.lifetimePnl.className = `stat-value ${perf.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
  els.winRate.textContent = `${perf.winRate || 0}%`;
  els.tradeCount.textContent = perf.totalTrades || 0;
}

// Recent trades
async function loadRecentTrades() {
  const trades = await api('/api/dashboard/trades');
  els.tradesBody.innerHTML = trades.map((t) => `
    <tr>
      <td>${t.id}</td>
      <td class="trade-${t.side}">${t.side.toUpperCase()}</td>
      <td>$${parseFloat(t.entry_price || 0).toFixed(2)}</td>
      <td>${t.exit_price ? '$' + parseFloat(t.exit_price).toFixed(2) : '--'}</td>
      <td>${parseFloat(t.position_size || 0).toFixed(4)}</td>
      <td class="${parseFloat(t.pnl || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}">
        ${t.pnl ? '$' + parseFloat(t.pnl).toFixed(2) : '--'}
      </td>
      <td class="${t.result === 'win' ? 'trade-win' : t.result === 'loss' ? 'trade-loss' : ''}">
        ${t.result || 'open'}
      </td>
      <td>${t.entry_time ? new Date(t.entry_time).toLocaleString() : '--'}</td>
    </tr>
  `).join('');
}

// Session status polling
async function checkSessionStatus() {
  try {
    const status = await api('/api/session/status');
    sessionRunning = status.running;
    if (status.running) {
      els.sessionStatus.textContent = `Session Active (${status.activeStrategy?.name || ''})`;
      els.sessionStatus.style.color = 'var(--success)';
    }
    updateSessionButtons();
  } catch (e) {
    // Server not ready yet
  }
}

// Dashboard summary
async function loadDashboardSummary() {
  try {
    const summary = await api('/api/dashboard/summary');
    els.sessionPnl.textContent = `$${(summary.totalPnl || 0).toFixed(2)}`;
    els.sessionPnl.className = `stat-value ${summary.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
  } catch (e) {
    // Server not ready
  }
}

// Init
async function init() {
  await loadStrategies();
  await loadAgentStatuses();
  await loadRecentTrades();
  await loadPerformance();
  await checkSessionStatus();
  await loadDashboardSummary();

  // Refresh every 30s
  setInterval(loadAgentStatuses, 30000);
  setInterval(loadRecentTrades, 30000);
  setInterval(loadPerformance, 30000);
  setInterval(loadDashboardSummary, 30000);
}

init();
