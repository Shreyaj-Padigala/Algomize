// Auth check
const token = localStorage.getItem('token');
if (!token) window.location.href = '/login.html';

const API_BASE = '';
const socket = io();

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(options.headers || {}) };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem('token');
    window.location.href = '/login.html';
    return {};
  }
  const ct = res.headers.get('content-type');
  if (ct && ct.includes('audio/mpeg')) return res;
  return res.json();
}

// State
let strategies = [];
let selectedStrategyId = parseInt(localStorage.getItem('selectedStrategyId')) || null;
let sessionRunning = false;
let workflowCount = 0;
let priceChart = null;
let candleSeries = null;
let entryPriceLine = null;

// DOM
const els = {
  currentPrice: document.getElementById('currentPrice'),
  connectionDot: document.getElementById('connectionDot'),
  statusText: document.getElementById('statusText'),
  sessionStatus: document.getElementById('sessionStatus'),
  btnStartSession: document.getElementById('btnStartSession'),
  btnStopSession: document.getElementById('btnStopSession'),
  btnNewStrategy: document.getElementById('btnNewStrategy'),
  strategyList: document.getElementById('strategyList'),
  agentList: document.getElementById('agentList'),
  sessionPnl: document.getElementById('sessionPnl'),
  lifetimePnl: document.getElementById('lifetimePnl'),
  winRate: document.getElementById('winRate'),
  tradeCount: document.getElementById('tradeCount'),
  workflowFeed: document.getElementById('workflowFeed'),
  workflowCount: document.getElementById('workflowCount'),
  exchangeState: document.getElementById('exchangeState'),
  botStatus: document.getElementById('botStatus'),
  loss1: document.getElementById('loss1'),
  loss2: document.getElementById('loss2'),
  loss3: document.getElementById('loss3'),
  chartUpdateTime: document.getElementById('chartUpdateTime'),
  strategyModal: document.getElementById('strategyModal'),
  btnCancelStrategy: document.getElementById('btnCancelStrategy'),
  btnCreateStrategy: document.getElementById('btnCreateStrategy'),
  modalStrategyName: document.getElementById('modalStrategyName'),
  modalCond1: document.getElementById('modalCond1'),
  modalCond2: document.getElementById('modalCond2'),
  modalCond3: document.getElementById('modalCond3'),
  modalExitStrategy: document.getElementById('modalExitStrategy'),
  modalError: document.getElementById('modalError'),
  btnVoiceAnalysis: document.getElementById('btnVoiceAnalysis'),
  voiceOverlay: document.getElementById('voiceOverlay'),
  voiceStatus: document.getElementById('voiceStatus'),
  voiceText: document.getElementById('voiceText'),
  btnCloseVoice: document.getElementById('btnCloseVoice'),
  btnLogout: document.getElementById('btnLogout'),
};

// ---------- Logout ----------
els.btnLogout.addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userId');
  window.location.href = '/login.html';
});

// ---------- Cash Register Sound ----------
function playCashRegister() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [[800,200,0,0.05,0.3,'square'],[2000,2000,0.05,0.6,0.2,'sine'],[2500,2500,0.15,0.8,0.15,'sine'],[3200,3200,0.25,1.2,0.2,'sine']].forEach(([f1,f2,start,end,vol,type]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f1, now + start);
      if (f1 !== f2) o.frequency.exponentialRampToValueAtTime(f2, now + start + 0.05);
      g.gain.setValueAtTime(vol, now + start);
      g.gain.exponentialRampToValueAtTime(0.001, now + end);
      o.connect(g).connect(ctx.destination); o.start(now + start); o.stop(now + end);
    });
    setTimeout(() => ctx.close(), 2000);
  } catch (e) {}
}

// ---------- Exit Bell Sound ----------
function playExitBell() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    // Light bell: two soft sine tones
    [[1200, 0, 0.6, 0.15], [900, 0.15, 0.8, 0.12]].forEach(([freq, start, dur, vol]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, now + start);
      g.gain.setValueAtTime(vol, now + start);
      g.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      o.connect(g).connect(ctx.destination);
      o.start(now + start);
      o.stop(now + start + dur);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch (e) {}
}

// ---------- Charts ----------
function initCharts() {
  const priceContainer = document.getElementById('priceChart');
  priceChart = LightweightCharts.createChart(priceContainer, {
    width: priceContainer.clientWidth, height: priceContainer.clientHeight,
    layout: { background: { type: 'solid', color: '#1a1a2e' }, textColor: '#7f8c8d', fontSize: 10 },
    grid: { vertLines: { color: 'rgba(35,53,84,0.3)' }, horzLines: { color: 'rgba(35,53,84,0.3)' } },
    crosshair: { mode: 0 },
    rightPriceScale: { borderColor: '#233554' },
    timeScale: { borderColor: '#233554', timeVisible: true, secondsVisible: false },
  });
  candleSeries = priceChart.addCandlestickSeries({
    upColor: '#00d2ff', downColor: '#e94560', borderUpColor: '#00d2ff',
    borderDownColor: '#e94560', wickUpColor: '#00d2ff', wickDownColor: '#e94560',
  });
  new ResizeObserver(() => {
    priceChart.applyOptions({ width: priceContainer.clientWidth, height: priceContainer.clientHeight });
  }).observe(priceContainer);
}

// Candle data cache keyed by timestamp for dedup/merge
let candleDataMap = {};

function updateCharts(candles15m) {
  if (!candleSeries || !candles15m || candles15m.length === 0) return;
  candles15m.forEach(c => {
    const time = Math.floor(c.timestamp / 1000);
    candleDataMap[time] = {
      time, open: parseFloat(c.open),
      high: parseFloat(c.high), low: parseFloat(c.low), close: parseFloat(c.close),
    };
  });
  const data = Object.values(candleDataMap).sort((a, b) => a.time - b.time);
  candleSeries.setData(data);
  els.chartUpdateTime.textContent = new Date().toLocaleTimeString();
}

// ---------- Socket Events ----------
socket.on('connect', () => { updateConnectionStatus(true); socket.emit('market:subscribe'); });
socket.on('disconnect', () => updateConnectionStatus(false));
socket.on('market:update', (d) => {
  els.currentPrice.textContent = `$${parseFloat(d.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
});
socket.on('chart:data', (d) => { if (d.candles15m) updateCharts(d.candles15m); });
socket.on('chart:update', (d) => {
  if (!candleSeries || !d.candle || d.timeframe !== '15m') return;
  const c = d.candle;
  const time = Math.floor(c.timestamp / 1000);
  const candle = { time, open: parseFloat(c.open), high: parseFloat(c.high), low: parseFloat(c.low), close: parseFloat(c.close) };
  candleDataMap[time] = candle;
  candleSeries.update(candle);
  els.chartUpdateTime.textContent = new Date().toLocaleTimeString();
});
socket.on('chart:entry-line', (d) => {
  if (!candleSeries) return;
  // Remove existing entry line if any
  if (entryPriceLine) {
    try { candleSeries.removePriceLine(entryPriceLine); } catch {}
    entryPriceLine = null;
  }
  // Add dashed horizontal line: green for long (buy), red for short (sell)
  const isLong = d.side === 'buy';
  entryPriceLine = candleSeries.createPriceLine({
    price: d.price,
    color: isLong ? '#00d2ff' : '#e94560',
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: isLong ? 'LONG Entry' : 'SHORT Entry',
  });
});
socket.on('chart:remove-entry-line', () => {
  if (candleSeries && entryPriceLine) {
    try { candleSeries.removePriceLine(entryPriceLine); } catch {}
    entryPriceLine = null;
  }
});
socket.on('trade:exit-sound', () => { playExitBell(); });
socket.on('agent:update', () => loadAgentStatuses());
socket.on('trade:update', () => loadPerformance());
socket.on('session:update', (d) => {
  if (d.status === 'started') {
    sessionRunning = true; els.sessionStatus.textContent = 'Running';
    els.sessionStatus.style.color = 'var(--success)'; setBotIndicator(true); clearWorkflow();
  } else if (d.status === 'loss_update') {
    updateLossDots(d.consecutiveLosses || 0);
  } else {
    sessionRunning = false; els.sessionStatus.textContent = d.reason || 'Stopped';
    els.sessionStatus.style.color = 'var(--text-dim)'; setBotIndicator(false);
  }
  updateSessionButtons();
});
socket.on('workflow:update', (d) => addWorkflowEntry(d));
// Auto-trade notification — play sound when bot places a trade automatically
socket.on('trade:auto-opened', (d) => {
  playCashRegister();
  loadPerformance();
});

// ---------- UI Helpers ----------
function updateConnectionStatus(connected) {
  els.connectionDot.className = `connection-dot ${connected ? 'connected' : ''}`;
  els.statusText.textContent = connected ? 'Connected' : 'Disconnected';
}
function setBotIndicator(active) {
  els.botStatus.querySelector('.bot-indicator').className = `bot-indicator ${active ? 'active' : 'inactive'}`;
}
function updateSessionButtons() {
  els.btnStartSession.disabled = sessionRunning || !selectedStrategyId;
  els.btnStopSession.disabled = !sessionRunning;
}

// Workflow
const WF_ICONS = { scan:'~', agent:'>', signal:'!', trade:'$', exit:'x', holding:'=', system:'*', error:'!', terminate:'X' };
function clearWorkflow() {
  workflowCount = 0; els.workflowFeed.innerHTML = ''; els.workflowCount.textContent = '0 events';
}
function addWorkflowEntry(d) {
  const empty = els.workflowFeed.querySelector('.workflow-empty');
  if (empty) empty.remove();
  workflowCount++;
  els.workflowCount.textContent = `${workflowCount} events`;
  const time = new Date(d.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = 'wf-entry';
  entry.innerHTML = `<span class="wf-time">${time}</span><span class="wf-icon ${d.type}">${WF_ICONS[d.type] || '>'}</span><div class="wf-body"><span class="wf-title">${d.title}</span><div class="wf-detail">${d.detail}</div></div>`;
  els.workflowFeed.appendChild(entry);
  els.workflowFeed.scrollTop = els.workflowFeed.scrollHeight;
}

function updateLossDots(count) {
  [els.loss1, els.loss2, els.loss3].forEach((dot, i) => { dot.className = `loss-dot ${i < count ? 'hit' : ''}`; });
}

// ---------- Strategy Creation Popup ----------
els.btnNewStrategy.addEventListener('click', () => {
  els.modalStrategyName.value = '';
  els.modalCond1.value = '';
  els.modalCond2.value = '';
  els.modalCond3.value = '';
  els.modalExitStrategy.value = '';
  els.modalError.style.display = 'none';
  els.strategyModal.style.display = 'flex';
});

els.btnCancelStrategy.addEventListener('click', () => {
  els.strategyModal.style.display = 'none';
});

els.btnCreateStrategy.addEventListener('click', async () => {
  const name = els.modalStrategyName.value.trim();
  if (!name) {
    els.modalError.textContent = 'Please enter a strategy name';
    els.modalError.style.display = 'block';
    return;
  }

  const conditions = [
    els.modalCond1.value.trim(),
    els.modalCond2.value.trim(),
    els.modalCond3.value.trim(),
  ].filter(Boolean);

  if (conditions.length === 0) {
    els.modalError.textContent = 'Please enter at least one condition';
    els.modalError.style.display = 'block';
    return;
  }

  const exitStrategy = els.modalExitStrategy.value.trim() || 'Exit at 50% profit or 20% loss';

  els.btnCreateStrategy.disabled = true;
  els.btnCreateStrategy.textContent = 'Creating...';

  try {
    await api('/api/strategies', {
      method: 'POST',
      body: JSON.stringify({
        name,
        leverage: 100,
        conditions,
        rules: { exitStrategy },
      }),
    });
    els.strategyModal.style.display = 'none';
    await loadStrategies();
  } catch (err) {
    els.modalError.textContent = 'Failed to create strategy';
    els.modalError.style.display = 'block';
  } finally {
    els.btnCreateStrategy.disabled = false;
    els.btnCreateStrategy.textContent = 'Create Strategy';
  }
});

// ---------- Strategies ----------
async function loadStrategies() {
  strategies = await api('/api/strategies');
  if (!Array.isArray(strategies)) strategies = [];
  renderStrategies();
}

function renderStrategies() {
  if (strategies.length === 0) {
    els.strategyList.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:4px;">No strategies yet — click "+ New Strategy"</div>';
    return;
  }
  els.strategyList.innerHTML = strategies.map(s => {
    let condCount = 0;
    try {
      let c = s.conditions;
      if (typeof c === 'string') c = JSON.parse(c);
      condCount = Array.isArray(c) ? c.filter(Boolean).length : 0;
    } catch {}
    return `
    <div class="strategy-item ${selectedStrategyId === s.id ? 'selected' : ''}" onclick="selectStrategy(${s.id})">
      <div><span class="name">${s.name}</span>
        <div class="meta">PnL: ${parseFloat(s.pnl_total || 0).toFixed(2)}% | ${condCount} conditions</div>
      </div>
      <div class="actions">
        <button class="btn-sm btn-view" onclick="event.stopPropagation(); viewStrategy(${s.id})" title="View conditions">view</button>
        <button class="btn-sm" onclick="event.stopPropagation(); deleteStrategy(${s.id})">del</button>
      </div>
    </div>`;
  }).join('');
}

function viewStrategy(id) {
  const strat = strategies.find(s => s.id === id);
  if (!strat) return;

  let conditions = [];
  try {
    let c = strat.conditions;
    if (typeof c === 'string') c = JSON.parse(c);
    if (Array.isArray(c)) conditions = c.map(x => typeof x === 'string' ? x : x.description || '');
  } catch {}

  let exitStrategy = '';
  try {
    let r = strat.rules;
    if (typeof r === 'string') r = JSON.parse(r);
    if (r && r.exitStrategy) exitStrategy = r.exitStrategy;
  } catch {}

  const modal = document.getElementById('strategyViewModal');
  document.getElementById('viewStrategyName').textContent = strat.name;
  document.getElementById('viewPnl').textContent = `${parseFloat(strat.pnl_total || 0).toFixed(2)}%`;
  document.getElementById('viewPnl').className = `view-pnl ${parseFloat(strat.pnl_total || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}`;

  const condList = document.getElementById('viewConditions');
  condList.innerHTML = conditions.map((c, i) => c ? `
    <div class="view-condition">
      <span class="view-cond-label">Condition ${i + 1}</span>
      <span class="view-cond-text">${c}</span>
    </div>` : '').join('') || '<div style="color:var(--text-dim)">No conditions set</div>';

  document.getElementById('viewExitStrategy').textContent = exitStrategy || 'Exit at 50% profit or 20% loss (default)';

  modal.style.display = 'flex';
}
window.viewStrategy = viewStrategy;

function selectStrategy(id) {
  selectedStrategyId = id;
  localStorage.setItem('selectedStrategyId', id);
  renderStrategies();
  updateSessionButtons();
  loadPerformance();
}
window.selectStrategy = selectStrategy;

async function deleteStrategy(id) {
  await api(`/api/strategies/${id}`, { method: 'DELETE' });
  if (selectedStrategyId === id) selectedStrategyId = null;
  loadStrategies();
}
window.deleteStrategy = deleteStrategy;

// Session
els.btnStartSession.addEventListener('click', async () => {
  if (!selectedStrategyId) return;
  try {
    const result = await api('/api/session/start', { method: 'POST', body: JSON.stringify({ strategyId: selectedStrategyId }) });
    if (result.error) addWorkflowEntry({ type: 'error', title: 'Error', detail: result.error, timestamp: Date.now() });
  } catch (err) {
    addWorkflowEntry({ type: 'error', title: 'Error', detail: err.message, timestamp: Date.now() });
  }
});
els.btnStopSession.addEventListener('click', async () => { await api('/api/session/stop', { method: 'POST' }); });

// ---------- Agents ----------
function renderAgents(statuses) {
  if (!statuses) return;
  const order = ['condition_1', 'condition_2', 'condition_3', 'entryDecision', 'exit', 'learn', 'data'];
  const labels = {
    condition_1: 'Agent 1', condition_2: 'Agent 2', condition_3: 'Agent 3',
    entryDecision: 'Entry Decision', exit: 'Exit', learn: 'Learn Bot', data: 'Data',
  };
  els.agentList.innerHTML = order.map(name => {
    const s = statuses[name];
    if (!s) return '';
    const lo = s.lastOutput;
    let badge = '';
    if (lo?.longScore !== undefined) badge = `<span class="agent-badge active">${lo.longScore}L/${lo.shortScore}S</span>`;
    else if (lo?.decision) badge = `<span class="agent-badge active">${lo.decision === 'no_trade' ? 'waiting' : lo.decision}</span>`;
    else if (lo?.insight) badge = `<span class="agent-badge active">active</span>`;
    else if (lo) badge = `<span class="agent-badge active">active</span>`;
    else badge = `<span class="agent-badge idle">idle</span>`;
    return `<div class="agent-row"><span class="agent-name">${labels[name] || name}</span>${badge}</div>`;
  }).join('');
}

async function loadAgentStatuses() {
  try { renderAgents(await api('/api/agents/status')); } catch {}
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
  } catch {}
}

async function loadDashboardSummary() {
  try {
    const s = await api('/api/dashboard/summary');
    els.sessionPnl.textContent = `${(s.totalPnl || 0).toFixed(2)}%`;
    els.sessionPnl.className = `perf-value ${s.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
  } catch {}
}

async function checkExchange() {
  try {
    const r = await api('/api/exchange/status');
    els.exchangeState.textContent = r.connected ? 'Connected' : 'Not connected';
    els.exchangeState.className = `exchange-state ${r.connected ? 'connected' : ''}`;
  } catch { els.exchangeState.textContent = 'Error'; }
}

async function checkSessionStatus() {
  try {
    const status = await api('/api/session/status');
    sessionRunning = status.running;
    if (status.running) {
      els.sessionStatus.textContent = 'Running'; els.sessionStatus.style.color = 'var(--success)'; setBotIndicator(true);
      if (status.activeStrategyId) { selectedStrategyId = status.activeStrategyId; localStorage.setItem('selectedStrategyId', status.activeStrategyId); renderStrategies(); }
      if (status.workflowHistory?.length > 0) { clearWorkflow(); status.workflowHistory.forEach(e => addWorkflowEntry(e)); }
    }
    if (status.consecutiveLosses !== undefined) updateLossDots(status.consecutiveLosses);
    // Restore entry price line if there's an open trade
    if (status.currentTrade && candleSeries) {
      if (entryPriceLine) {
        try { candleSeries.removePriceLine(entryPriceLine); } catch {}
      }
      const isLong = status.currentTrade.side === 'buy';
      entryPriceLine = candleSeries.createPriceLine({
        price: status.currentTrade.entry_price,
        color: isLong ? '#00d2ff' : '#e94560',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: isLong ? 'LONG Entry' : 'SHORT Entry',
      });
    }
    updateSessionButtons();
  } catch {}
}

async function loadInitialChartData() {
  try { const d = await api('/api/chart/btcusdt/15m'); if (d.candles) updateCharts(d.candles); } catch {}
}

// ---------- Voice ----------
els.btnVoiceAnalysis.addEventListener('click', async () => {
  els.voiceOverlay.style.display = 'flex';
  els.voiceStatus.textContent = 'Generating analysis...';
  els.voiceText.textContent = '';
  try {
    const res = await fetch('/api/voice/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
    const ct = res.headers.get('content-type');
    if (ct && ct.includes('audio/mpeg')) {
      const textB64 = res.headers.get('X-Voice-Text');
      if (textB64) els.voiceText.textContent = atob(textB64);
      els.voiceStatus.textContent = 'Playing analysis...';
      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      audio.play();
      audio.onended = () => { els.voiceStatus.textContent = 'Analysis complete'; };
    } else {
      const data = await res.json();
      els.voiceText.textContent = data.text || 'No analysis available';
      els.voiceStatus.textContent = data.audio === null ? 'Text only (ElevenLabs not configured)' : 'Analysis complete';
    }
  } catch (err) { els.voiceStatus.textContent = 'Error'; els.voiceText.textContent = err.message; }
});
els.btnCloseVoice.addEventListener('click', () => { els.voiceOverlay.style.display = 'none'; });

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
  if (selectedStrategyId) selectStrategy(selectedStrategyId);
  api('/api/exchange/connect', { method: 'POST' }).then(() => checkExchange());
  setInterval(loadAgentStatuses, 30000);
  setInterval(loadPerformance, 30000);
  setInterval(loadDashboardSummary, 30000);
  setInterval(checkExchange, 60000);
  // Only refresh full chart data every 5 min to fill gaps; WebSocket handles real-time
  setInterval(loadInitialChartData, 300000);
}

init();
