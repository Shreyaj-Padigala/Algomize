const RSIAgent = require('../src/agents/rsiAgent');
const ExitAgent = require('../src/agents/exitAgent');

// Mock geminiService
jest.mock('../src/services/geminiService', () => ({
  analyze: jest.fn().mockResolvedValue({ analysis: 'mocked' }),
}));

describe('RSI Agent', () => {
  let agent;

  beforeEach(() => {
    agent = new RSIAgent();
  });

  it('should detect overbought condition', async () => {
    // Create candles where RSI would be very high (all gains)
    const candles = [];
    for (let i = 0; i < 30; i++) {
      candles.push({
        open: 100 + i * 2,
        high: 102 + i * 2,
        low: 99 + i * 2,
        close: 101 + i * 2,
        volume: 1000,
      });
    }

    const result = await agent.analyze(candles);
    expect(result.agent).toBe('rsi');
    expect(result.currentRSI).toBeGreaterThan(70);
    expect(result.overbought).toBe(true);
  });

  it('should detect oversold condition', async () => {
    const candles = [];
    for (let i = 0; i < 30; i++) {
      candles.push({
        open: 200 - i * 2,
        high: 202 - i * 2,
        low: 198 - i * 2,
        close: 199 - i * 2,
        volume: 1000,
      });
    }

    const result = await agent.analyze(candles);
    expect(result.agent).toBe('rsi');
    expect(result.currentRSI).toBeLessThan(30);
    expect(result.oversold).toBe(true);
  });
});

describe('Exit Agent', () => {
  let agent;

  beforeEach(() => {
    agent = new ExitAgent();
  });

  it('should return no_open_trade when no trade provided', async () => {
    const result = await agent.analyze({ openTrade: null, candles15m: [], rsiData: null });
    expect(result.action).toBe('no_open_trade');
  });

  it('should trigger stop loss for long position', async () => {
    const candles = [];
    for (let i = 0; i < 20; i++) {
      candles.push({
        open: 95 + Math.random(),
        high: 96 + Math.random(),
        low: 94 + Math.random(),
        close: 95,
        volume: 1000,
      });
    }

    const openTrade = {
      id: 1,
      side: 'buy',
      entry_price: '100',
      position_size: '1',
      entry_time: new Date().toISOString(),
    };

    const result = await agent.analyze({ openTrade, candles15m: candles, rsiData: null });
    expect(result.shouldClose).toBe(true);
    expect(result.triggers).toContain('stop_loss');
  });

  it('should trigger take profit for long position', async () => {
    const candles = [];
    for (let i = 0; i < 20; i++) {
      candles.push({
        open: 105 + Math.random(),
        high: 106 + Math.random(),
        low: 104 + Math.random(),
        close: 105,
        volume: 1000,
      });
    }

    const openTrade = {
      id: 1,
      side: 'buy',
      entry_price: '100',
      position_size: '1',
      entry_time: new Date().toISOString(),
    };

    const result = await agent.analyze({ openTrade, candles15m: candles, rsiData: null });
    expect(result.shouldClose).toBe(true);
    expect(result.triggers).toContain('take_profit');
  });
});
