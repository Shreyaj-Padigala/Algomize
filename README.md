# Algomize

Algomize is an AI agent-based crypto trading bot that autonomously analyzes BTC/USDT price data from the BloFin exchange and executes trades using multiple specialized agents for price action, market structure, and RSI analysis across multiple timeframes. Built with Node.js/Express, PostgreSQL, Socket.IO for real-time data, and Groq AI for intelligent decision-making. The platform includes a live dashboard with agent status, performance metrics, and chart data streamed directly from BloFin market feeds.


How to run:

1) create .env file with the following format:

# =============================================
# Algomize - AI Crypto Trading Bot Configuration
# =============================================
# Copy this file to .env and fill in your values:
#   cp .env.example .env

# ----- Server -----
PORT=3000
NODE_ENV=development

# ----- PostgreSQL Database -----
DB_HOST=localhost:3000
DB_PORT=****
DB_NAME=****
DB_USER=*****
DB_PASSWORD=*****

# ----- BloFin Exchange API -----
# Get your API credentials from https://blofin.com
BLOFIN_API_KEY=******
BLOFIN_API_SECRET=*******
BLOFIN_PASSPHRASE=******
BLOFIN_BASE_URL=https://openapi.blofin.com
BLOFIN_WS_URL=wss://openapi.blofin.com/ws/public

# ----- Trading Configuration -----
TRADING_SYMBOL=BTC-USDT
MAX_PORTFOLIO_PERCENT=50
SESSION_DURATION_HOURS=12

# ----- Logging -----
LOG_LEVEL=info
CSV_LOG_DIR=./csv_logs



2)  npm install 

3)  npm run db:migrate

4)  npm start

Then it should run locally on localhost:3000
