const exchangeService = require('./exchangeService');

class MarketService {
  constructor() {
    this.candleCache = { '15m': [], '1h': [], '4H': [] };
    this.lastPrice = null;
  }

  async getCurrentPrice() {
    const result = await exchangeService.getTicker();
    if (result.data && result.data.length > 0) {
      this.lastPrice = parseFloat(result.data[0].last);
      return { price: this.lastPrice, timestamp: Date.now() };
    }
    throw new Error('Failed to fetch current price');
  }

  async getCandles(timeframe = '15m', limit = 100) {
    const result = await exchangeService.getCandles('BTC-USDT', timeframe, limit);
    if (result.data) {
      const candles = result.data.map((c) => ({
        timestamp: parseInt(c[0]),
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
      }));
      // BloFin returns candles newest-first; sort ascending by timestamp
      candles.sort((a, b) => a.timestamp - b.timestamp);
      this.candleCache[timeframe] = candles;
      return candles;
    }
    throw new Error(`Failed to fetch ${timeframe} candles`);
  }

  async getOrderbook() {
    const result = await exchangeService.getOrderbook();
    if (result.data && result.data.length > 0) {
      return {
        bids: result.data[0].bids.map((b) => ({
          price: parseFloat(b[0]),
          size: parseFloat(b[1]),
        })),
        asks: result.data[0].asks.map((a) => ({
          price: parseFloat(a[0]),
          size: parseFloat(a[1]),
        })),
      };
    }
    throw new Error('Failed to fetch orderbook');
  }

  async getRecentTrades() {
    const result = await exchangeService.getRecentTrades();
    if (result.data) {
      return result.data.map((t) => ({
        price: parseFloat(t.px),
        size: parseFloat(t.sz),
        side: t.side,
        timestamp: parseInt(t.ts),
      }));
    }
    throw new Error('Failed to fetch recent trades');
  }
}

module.exports = new MarketService();
