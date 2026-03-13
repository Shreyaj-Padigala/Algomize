const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');
const config = require('../config');

class CsvService {
  constructor() {
    this.logDir = config.csv.logDir;
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  _getFilePath(strategyId) {
    return path.join(this.logDir, `strategy_${strategyId}_trades.csv`);
  }

  async logTrade(strategyId, trade) {
    const filePath = this._getFilePath(strategyId);
    const fileExists = fs.existsSync(filePath);

    const writer = createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'trade_id', title: 'trade_id' },
        { id: 'strategy_id', title: 'strategy_id' },
        { id: 'side', title: 'side' },
        { id: 'entry_price', title: 'entry_price' },
        { id: 'exit_price', title: 'exit_price' },
        { id: 'position_size', title: 'position_size' },
        { id: 'leverage', title: 'leverage' },
        { id: 'pnl', title: 'pnl' },
        { id: 'entry_time', title: 'entry_time' },
        { id: 'exit_time', title: 'exit_time' },
        { id: 'result', title: 'result' },
        { id: 'agent_signals', title: 'agent_signals' },
      ],
      append: fileExists,
    });

    await writer.writeRecords([{
      trade_id: trade.id,
      strategy_id: strategyId,
      side: trade.side,
      entry_price: trade.entry_price,
      exit_price: trade.exit_price || '',
      position_size: trade.position_size,
      leverage: trade.leverage,
      pnl: trade.pnl || '',
      entry_time: trade.entry_time,
      exit_time: trade.exit_time || '',
      result: trade.result || 'open',
      agent_signals: JSON.stringify(trade.agent_signals || {}),
    }]);
  }

  getTradeLog(strategyId) {
    const filePath = this._getFilePath(strategyId);
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length <= 1) return [];

    const headers = lines[0].split(',');
    return lines.slice(1).map((line) => {
      const values = line.split(',');
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = values[i];
      });
      return obj;
    });
  }
}

module.exports = new CsvService();
