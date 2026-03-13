const WebSocket = require('ws');
const config = require('../config');

class BlofinWebSocket {
  constructor(io) {
    this.io = io;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.subscriptions = new Set();
  }

  connect() {
    this.ws = new WebSocket(config.blofin.wsUrl);

    this.ws.on('open', () => {
      console.log('BloFin WebSocket connected');
      this.reconnectAttempts = 0;
      // Resubscribe on reconnect
      for (const sub of this.subscriptions) {
        this._send(sub);
      }
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.data) {
          this._handleMessage(msg);
        }
      } catch (err) {
        // ping/pong frames
      }
    });

    this.ws.on('close', () => {
      console.log('BloFin WebSocket disconnected');
      this._reconnect();
    });

    this.ws.on('error', (err) => {
      console.error('BloFin WebSocket error:', err.message);
    });

    // Keep alive
    this._startPing();
  }

  subscribeTicker(instId = 'BTC-USDT') {
    const sub = JSON.stringify({
      op: 'subscribe',
      args: [{ channel: 'tickers', instId }],
    });
    this.subscriptions.add(sub);
    this._send(sub);
  }

  subscribeCandles(instId = 'BTC-USDT', timeframe = '15m') {
    const channel = `candle${timeframe}`;
    const sub = JSON.stringify({
      op: 'subscribe',
      args: [{ channel, instId }],
    });
    this.subscriptions.add(sub);
    this._send(sub);
  }

  subscribeTrades(instId = 'BTC-USDT') {
    const sub = JSON.stringify({
      op: 'subscribe',
      args: [{ channel: 'trades', instId }],
    });
    this.subscriptions.add(sub);
    this._send(sub);
  }

  _handleMessage(msg) {
    if (!msg.arg) return;

    const channel = msg.arg.channel;

    if (channel === 'tickers' && msg.data) {
      const ticker = msg.data[0];
      this.io.emit('market:update', {
        price: parseFloat(ticker.last),
        high24h: parseFloat(ticker.high24h),
        low24h: parseFloat(ticker.low24h),
        volume24h: parseFloat(ticker.vol24h),
        timestamp: Date.now(),
      });
    }

    if (channel && channel.startsWith('candle') && msg.data) {
      const timeframe = channel.replace('candle', '');
      this.io.emit('chart:update', {
        timeframe,
        candle: {
          timestamp: parseInt(msg.data[0][0]),
          open: parseFloat(msg.data[0][1]),
          high: parseFloat(msg.data[0][2]),
          low: parseFloat(msg.data[0][3]),
          close: parseFloat(msg.data[0][4]),
          volume: parseFloat(msg.data[0][5]),
        },
      });
    }

    if (channel === 'trades' && msg.data) {
      this.io.emit('trade:update', {
        trades: msg.data.map((t) => ({
          price: parseFloat(t.px),
          size: parseFloat(t.sz),
          side: t.side,
          timestamp: parseInt(t.ts),
        })),
      });
    }
  }

  _send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  _reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max WebSocket reconnect attempts reached');
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    setTimeout(() => this.connect(), delay);
  }

  _startPing() {
    setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, 25000);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = BlofinWebSocket;
