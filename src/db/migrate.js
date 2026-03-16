const pool = require('./pool');

const migration = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    blofin_api_key VARCHAR(255),
    blofin_api_secret VARCHAR(255),
    blofin_passphrase VARCHAR(255),
    portfolio_balance NUMERIC(20, 8) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS strategies (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    symbol VARCHAR(50) DEFAULT 'BTC-USDT',
    leverage INTEGER DEFAULT 1,
    session_active BOOLEAN DEFAULT FALSE,
    pnl_total NUMERIC(20, 8) DEFAULT 0,
    rules JSONB DEFAULT '{}',
    conditions JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS strategy_agents (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    agent_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
  );

  CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    side VARCHAR(10) NOT NULL,
    entry_price NUMERIC(20, 8),
    exit_price NUMERIC(20, 8),
    position_size NUMERIC(20, 8),
    leverage INTEGER DEFAULT 1,
    pnl NUMERIC(20, 8),
    entry_time TIMESTAMP,
    exit_time TIMESTAMP,
    result VARCHAR(20),
    agent_signals JSONB DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    strategy_id INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
    start_time TIMESTAMP DEFAULT NOW(),
    end_time TIMESTAMP,
    active BOOLEAN DEFAULT TRUE
  );
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('Database migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };
