require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'algomize',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  },

  blofin: {
    apiKey: process.env.BLOFIN_API_KEY || '',
    apiSecret: process.env.BLOFIN_API_SECRET || '',
    passphrase: process.env.BLOFIN_PASSPHRASE || '',
    baseUrl: process.env.BLOFIN_BASE_URL || 'https://openapi.blofin.com',
    wsUrl: process.env.BLOFIN_WS_URL || 'wss://openapi.blofin.com/ws/public',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },

  trading: {
    symbol: process.env.TRADING_SYMBOL || 'BTC-USDT',
    maxPortfolioPercent: parseInt(process.env.MAX_PORTFOLIO_PERCENT, 10) || 50,
    sessionDurationHours: parseInt(process.env.SESSION_DURATION_HOURS, 10) || 12,
  },

  csv: {
    logDir: process.env.CSV_LOG_DIR || './csv_logs',
  },
};
