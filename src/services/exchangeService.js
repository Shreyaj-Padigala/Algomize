const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');

class ExchangeService {
  constructor() {
    this.credentials = {
      apiKey: config.blofin.apiKey,
      apiSecret: config.blofin.apiSecret,
      passphrase: config.blofin.passphrase,
    };
    this.baseUrl = config.blofin.baseUrl;
    this.connected = false;
  }

  setCredentials(apiKey, apiSecret, passphrase) {
    this.credentials = { apiKey, apiSecret, passphrase };
    this.connected = false;
  }

  clearCredentials() {
    this.credentials = { apiKey: '', apiSecret: '', passphrase: '' };
    this.connected = false;
  }

  _generateSignature(timestamp, method, path, body = '') {
    const prehash = timestamp + method.toUpperCase() + path + body;
    return crypto
      .createHmac('sha256', this.credentials.apiSecret)
      .update(prehash)
      .digest('base64');
  }

  _getHeaders(method, path, body = '') {
    const timestamp = new Date().toISOString();
    const signature = this._generateSignature(timestamp, method, path, body);
    return {
      'ACCESS-KEY': this.credentials.apiKey,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': this.credentials.passphrase,
      'Content-Type': 'application/json',
    };
  }

  async request(method, path, data = null) {
    const body = data ? JSON.stringify(data) : '';
    const headers = this._getHeaders(method, path, body);
    const url = `${this.baseUrl}${path}`;

    const response = await axios({
      method,
      url,
      headers,
      data: data || undefined,
    });

    return response.data;
  }

  async checkConnection() {
    try {
      const result = await this.request('GET', '/api/v1/account/balance');
      this.connected = true;
      return { connected: true, data: result };
    } catch (err) {
      this.connected = false;
      return { connected: false, error: err.message };
    }
  }

  async getAccountBalance() {
    return this.request('GET', '/api/v1/account/balance');
  }

  async getTicker(instId = 'BTC-USDT') {
    return this.request('GET', `/api/v1/market/ticker?instId=${instId}`);
  }

  async getCandles(instId = 'BTC-USDT', bar = '15m', limit = 100) {
    return this.request(
      'GET',
      `/api/v1/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`
    );
  }

  async getOrderbook(instId = 'BTC-USDT', depth = 20) {
    return this.request(
      'GET',
      `/api/v1/market/books?instId=${instId}&sz=${depth}`
    );
  }

  async getRecentTrades(instId = 'BTC-USDT', limit = 50) {
    return this.request(
      'GET',
      `/api/v1/market/trades?instId=${instId}&limit=${limit}`
    );
  }

  async placeOrder({ instId = 'BTC-USDT', side, size, price, orderType = 'market' }) {
    const orderData = {
      instId,
      tdMode: 'cross',
      side,
      ordType: orderType,
      sz: String(size),
    };
    if (orderType === 'limit' && price) {
      orderData.px = String(price);
    }
    return this.request('POST', '/api/v1/trade/order', orderData);
  }

  async closePosition(instId = 'BTC-USDT', side) {
    // To close a position, place an opposite-side market order
    // Or use the close-position endpoint
    return this.request('POST', '/api/v1/trade/close-position', {
      instId,
      tdMode: 'cross',
    });
  }

  async getOpenPositions(instId = 'BTC-USDT') {
    return this.request('GET', `/api/v1/account/positions?instId=${instId}`);
  }

  async setLeverage(instId = 'BTC-USDT', lever = 1) {
    return this.request('POST', '/api/v1/account/set-leverage', {
      instId,
      lever: String(lever),
      mgnMode: 'cross',
    });
  }

}

module.exports = new ExchangeService();
