const indicatorService = require('../services/indicatorService');
const groqService = require('../services/groqService');

/**
 * ConditionEvaluator — shared scoring engine for all condition agents.
 *
 * Design principles:
 * 1. Mathematical indicators (RSI, EMA, SMA, etc.) are ALWAYS computed in code
 * 2. AI is only used for qualitative/pattern conditions the computer can't calculate
 * 3. Scores of 5/5 are NEVER returned — there is always a lean
 * 4. Default timeframe is 15m; only macro conditions use 1h/4h
 * 5. longScore + shortScore always equals 10
 */

// Keywords that map to code-computed indicators
const MATH_KEYWORDS = {
  rsi: ['rsi', 'relative strength'],
  ema: ['ema', 'exponential moving average'],
  sma: ['sma', 'simple moving average', 'moving average'],
  support_resistance: ['support', 'resistance', 'level', 's/r', 'key level'],
  volume: ['volume', 'vol '],
  divergence: ['divergence', 'diverging'],
  bos: ['break of structure', 'bos', 'structure break'],
  fvg: ['fair value gap', 'fvg', 'imbalance'],
  trend: ['trend', 'trending', 'upward', 'downward', 'direction', 'price action', 'momentum'],
  price_move: ['major movement', 'big move', 'significant', 'spike', 'dump', 'pump', 'rally', 'crash', 'drop', 'moved'],
};

// Keywords indicating macro/higher timeframe
const MACRO_KEYWORDS = ['macro', '1h', '4h', '1 hour', '4 hour', 'daily', 'weekly',
  'higher timeframe', 'bigger picture', 'long-term', 'long term', 'overall', 'larger'];

class ConditionEvaluator {

  /**
   * Main entry point — evaluates a condition and returns { longScore, shortScore, summary }.
   * Automatically decides whether to use math or AI.
   */
  static async evaluate(conditionText, candles15m, candles1h, candles4h) {
    if (!conditionText || !candles15m || candles15m.length < 20) {
      return { longScore: 4, shortScore: 6, summary: 'Insufficient data or no condition' };
    }

    const lower = conditionText.toLowerCase();
    const isMacro = MACRO_KEYWORDS.some(kw => lower.includes(kw));
    const detected = this._detectIndicators(lower);

    // Choose candles based on macro flag
    const primaryCandles = candles15m;
    const macroCandles = isMacro ? (candles4h || candles1h || candles15m) : candles15m;

    // Always use AI-powered evaluation with pre-computed indicator data
    // Math indicators are computed in code and passed as context to the AI
    return this._evaluateWithAI(conditionText, primaryCandles, isMacro ? macroCandles : null, detected);
  }

  /**
   * Check if a condition requires macro (higher timeframe) data
   */
  static isMacroCondition(conditionText) {
    const lower = conditionText.toLowerCase();
    return MACRO_KEYWORDS.some(kw => lower.includes(kw));
  }

  // ─── INDICATOR DETECTION ────────────────────────────────────────

  static _detectIndicators(lowerText) {
    const found = [];
    for (const [name, keywords] of Object.entries(MATH_KEYWORDS)) {
      if (keywords.some(kw => lowerText.includes(kw))) found.push(name);
    }
    return found;
  }

  // ─── DIRECTION PARSING ──────────────────────────────────────────

  /**
   * Parse user's condition to understand which direction they intend.
   * e.g. "RSI over 80 means Short" → above threshold = short
   */
  static _parseDirections(conditionText) {
    const lower = conditionText.toLowerCase();
    const mapping = { aboveAction: null, belowAction: null };

    // Split on commas, semicolons, periods, "and"
    const parts = lower.split(/[,;.]|\band\b/);
    for (const part of parts) {
      const hasAbove = /(?:over|above|greater|higher|overbought|high\s+rsi|>\s*\d)/.test(part);
      const hasBelow = /(?:under|below|less|lower|oversold|low\s+rsi|<\s*\d)/.test(part);
      const meansLong = /(?:\blong\b|\bbuy\b|\bbullish\b)/.test(part);
      const meansShort = /(?:\bshort\b|\bsell\b|\bbearish\b)/.test(part);

      if (hasAbove && meansShort) mapping.aboveAction = 'short';
      if (hasAbove && meansLong) mapping.aboveAction = 'long';
      if (hasBelow && meansLong) mapping.belowAction = 'long';
      if (hasBelow && meansShort) mapping.belowAction = 'short';
    }

    // Trend direction parsing
    if (/(?:upward|uptrend|up\s*trend|bullish)/.test(lower) && /(?:\blong\b|\bbuy\b)/.test(lower)) {
      mapping.trendUp = 'long';
    }
    if (/(?:downward|downtrend|down\s*trend|bearish)/.test(lower) && /(?:\bshort\b|\bsell\b)/.test(lower)) {
      mapping.trendDown = 'short';
    }

    return mapping;
  }

  /**
   * Extract numeric thresholds from condition text
   */
  static _extractThresholds(conditionText) {
    const result = {};
    const aboveMatch = conditionText.match(/(?:over|above|greater than|higher than|exceeds?|>=?)\s*(\d+(?:\.\d+)?)/i);
    if (aboveMatch) result.above = parseFloat(aboveMatch[1]);

    const belowMatch = conditionText.match(/(?:under|below|less than|lower than|<=?)\s*(\d+(?:\.\d+)?)/i);
    if (belowMatch) result.below = parseFloat(belowMatch[1]);

    return result;
  }

  // ─── MATHEMATICAL SCORERS ──────────────────────────────────────

  static _scoreRSI(closes, conditionText) {
    const rsiValues = indicatorService.calculateRSI(closes, 14);
    if (rsiValues.length === 0) return this._computedFallback(closes);

    const rsi = rsiValues[rsiValues.length - 1];
    const thresholds = this._extractThresholds(conditionText);
    const mapping = this._parseDirections(conditionText);

    // Default thresholds based on common RSI usage
    const overboughtLevel = thresholds.above || 70;
    const oversoldLevel = thresholds.below || 30;

    // Default: overbought = short, oversold = long
    const aboveAction = mapping.aboveAction || 'short';
    const belowAction = mapping.belowAction || 'long';

    let longScore, shortScore;

    if (rsi >= overboughtLevel) {
      // In overbought zone — strength scales with how far past threshold
      const strength = Math.min(9, 7 + Math.floor((rsi - overboughtLevel) / 5));
      if (aboveAction === 'short') {
        shortScore = strength; longScore = 10 - strength;
      } else {
        longScore = strength; shortScore = 10 - strength;
      }
    } else if (rsi <= oversoldLevel) {
      const strength = Math.min(9, 7 + Math.floor((oversoldLevel - rsi) / 5));
      if (belowAction === 'long') {
        longScore = strength; shortScore = 10 - strength;
      } else {
        shortScore = strength; longScore = 10 - strength;
      }
    } else {
      // Middle zone — lean based on proximity to thresholds
      const mid = (overboughtLevel + oversoldLevel) / 2;
      const range = (overboughtLevel - oversoldLevel) / 2;
      const normalized = (rsi - mid) / range; // -1 to 1

      if (normalized > 0) {
        // Closer to overbought
        const lean = Math.round(1 + normalized * 2); // 1-3
        if (aboveAction === 'short') {
          shortScore = 5 + lean; longScore = 5 - lean;
        } else {
          longScore = 5 + lean; shortScore = 5 - lean;
        }
      } else {
        // Closer to oversold
        const lean = Math.round(1 + Math.abs(normalized) * 2);
        if (belowAction === 'long') {
          longScore = 5 + lean; shortScore = 5 - lean;
        } else {
          shortScore = 5 + lean; longScore = 5 - lean;
        }
      }
    }

    return this._clamp(longScore, shortScore,
      `RSI(14) = ${rsi.toFixed(1)} | OB: ${overboughtLevel} OS: ${oversoldLevel} | ${rsi >= overboughtLevel ? 'OVERBOUGHT' : rsi <= oversoldLevel ? 'OVERSOLD' : 'Neutral zone'}`);
  }

  static _scoreMovingAverage(closes, conditionText) {
    // Extract period from condition (default 20)
    const periodMatch = conditionText.match(/(\d+)\s*(?:period|ema|sma|ma\b)/i);
    const period = periodMatch ? parseInt(periodMatch[1]) : 20;
    const isEMA = /ema|exponential/i.test(conditionText);

    const ma = isEMA
      ? indicatorService.calculateEMA(closes, period)
      : indicatorService.calculateSMA(closes, period);

    if (ma.length === 0) return this._computedFallback(closes);

    const currentPrice = closes[closes.length - 1];
    const lastMA = ma[ma.length - 1];
    const pctDiff = ((currentPrice - lastMA) / lastMA) * 100;

    const mapping = this._parseDirections(conditionText);

    let longScore, shortScore;

    if (pctDiff > 1.0) {
      // Well above MA
      longScore = Math.min(9, 7 + Math.floor(pctDiff / 0.5));
      shortScore = 10 - longScore;
    } else if (pctDiff > 0.3) {
      longScore = 7; shortScore = 3;
    } else if (pctDiff > 0) {
      longScore = 6; shortScore = 4;
    } else if (pctDiff > -0.3) {
      shortScore = 6; longScore = 4;
    } else if (pctDiff > -1.0) {
      shortScore = 7; longScore = 3;
    } else {
      shortScore = Math.min(9, 7 + Math.floor(Math.abs(pctDiff) / 0.5));
      longScore = 10 - shortScore;
    }

    // Respect user's inverted mapping
    if (mapping.aboveAction === 'short') {
      [longScore, shortScore] = [shortScore, longScore];
    }

    const label = isEMA ? 'EMA' : 'SMA';
    return this._clamp(longScore, shortScore,
      `Price $${currentPrice.toFixed(0)} vs ${label}(${period}) $${lastMA.toFixed(0)} | ${pctDiff > 0 ? '+' : ''}${pctDiff.toFixed(2)}% ${pctDiff > 0 ? 'above' : 'below'}`);
  }

  static _scoreTrend(candles, conditionText) {
    const structure = indicatorService.detectMarketStructure(candles);
    const mapping = this._parseDirections(conditionText);

    let longScore, shortScore;

    if (structure.trend === 'bullish') {
      longScore = 7; shortScore = 3;
      if (structure.bos && structure.bos.type === 'bullish_bos') {
        longScore = 8; shortScore = 2;
      }
    } else if (structure.trend === 'bearish') {
      shortScore = 7; longScore = 3;
      if (structure.bos && structure.bos.type === 'bearish_bos') {
        shortScore = 8; longScore = 2;
      }
    } else {
      // Neutral — use recent structures to pick a lean
      const recent = structure.structures.slice(-4);
      const bull = recent.filter(s => s.type === 'HH' || s.type === 'HL').length;
      const bear = recent.filter(s => s.type === 'LL' || s.type === 'LH').length;
      if (bull > bear) { longScore = 6; shortScore = 4; }
      else if (bear > bull) { shortScore = 6; longScore = 4; }
      else { longScore = 4; shortScore = 6; }
    }

    // Respect inverted mapping
    if (mapping.trendUp === 'short' || mapping.trendDown === 'long') {
      [longScore, shortScore] = [shortScore, longScore];
    }

    return this._clamp(longScore, shortScore,
      `Trend: ${structure.trend} | BOS: ${structure.bos ? structure.bos.type : 'none'} | ${structure.structures.slice(-3).map(s => s.type).join(', ')}`);
  }

  static _scoreSupportResistance(candles) {
    const levels = indicatorService.findSupportResistance(candles);
    const currentPrice = candles[candles.length - 1].close;

    const supports = levels.filter(l => l.type === 'support' && l.price < currentPrice)
      .sort((a, b) => b.price - a.price);
    const resistances = levels.filter(l => l.type === 'resistance' && l.price > currentPrice)
      .sort((a, b) => a.price - b.price);

    let longScore, shortScore;
    const nearest_s = supports[0];
    const nearest_r = resistances[0];

    if (nearest_s && nearest_r) {
      const distS = (currentPrice - nearest_s.price) / currentPrice;
      const distR = (nearest_r.price - currentPrice) / currentPrice;
      const ratio = distS / (distS + distR); // 0 = at support, 1 = at resistance

      if (ratio < 0.25) { longScore = 8; shortScore = 2; }
      else if (ratio < 0.4) { longScore = 7; shortScore = 3; }
      else if (ratio < 0.5) { longScore = 6; shortScore = 4; }
      else if (ratio < 0.6) { shortScore = 6; longScore = 4; }
      else if (ratio < 0.75) { shortScore = 7; longScore = 3; }
      else { shortScore = 8; longScore = 2; }
    } else if (nearest_s) {
      longScore = 6; shortScore = 4;
    } else if (nearest_r) {
      shortScore = 6; longScore = 4;
    } else {
      longScore = 4; shortScore = 6;
    }

    return this._clamp(longScore, shortScore,
      `S: $${nearest_s ? nearest_s.price.toFixed(0) : 'N/A'} | R: $${nearest_r ? nearest_r.price.toFixed(0) : 'N/A'} | Price: $${currentPrice.toFixed(0)}`);
  }

  static _scoreVolume(candles) {
    if (candles.length < 50) return { longScore: 4, shortScore: 6, summary: 'Insufficient volume data' };

    const avgVol = candles.slice(-50).reduce((s, c) => s + c.volume, 0) / 50;
    const currentVol = candles[candles.length - 1].volume;
    const ratio = currentVol / avgVol;
    const priceDir = candles[candles.length - 1].close - candles[candles.length - 2].close;

    let longScore, shortScore;

    if (ratio > 1.5 && priceDir > 0) {
      longScore = 7 + Math.min(2, Math.floor((ratio - 1.5) * 2));
      shortScore = 10 - longScore;
    } else if (ratio > 1.5 && priceDir < 0) {
      shortScore = 7 + Math.min(2, Math.floor((ratio - 1.5) * 2));
      longScore = 10 - shortScore;
    } else if (ratio > 1.0) {
      if (priceDir > 0) { longScore = 6; shortScore = 4; }
      else { shortScore = 6; longScore = 4; }
    } else {
      // Low volume — no conviction, slight bearish lean
      longScore = 4; shortScore = 6;
    }

    return this._clamp(longScore, shortScore,
      `Vol: ${ratio.toFixed(1)}x avg | ${priceDir > 0 ? 'Bullish' : 'Bearish'} candle | ${ratio > 1.5 ? 'HIGH' : ratio > 1 ? 'Normal' : 'Low'}`);
  }

  static _scoreDivergence(closes) {
    const rsiValues = indicatorService.calculateRSI(closes, 14);
    if (rsiValues.length < 20) return this._computedFallback(closes);

    const div = indicatorService.detectDivergence(closes, rsiValues, 10);
    const hidden = indicatorService.detectHiddenDivergence(closes, rsiValues, 20);

    let longScore, shortScore;

    if (div.bullish) { longScore = 8; shortScore = 2; }
    else if (div.bearish) { shortScore = 8; longScore = 2; }
    else if (hidden.hiddenBullish) { longScore = 7; shortScore = 3; }
    else if (hidden.hiddenBearish) { shortScore = 7; longScore = 3; }
    else {
      // No divergence — lean based on RSI
      const rsi = rsiValues[rsiValues.length - 1];
      if (rsi > 55) { shortScore = 6; longScore = 4; }
      else if (rsi < 45) { longScore = 6; shortScore = 4; }
      else { longScore = 4; shortScore = 6; }
    }

    return this._clamp(longScore, shortScore,
      `BullDiv: ${div.bullish} | BearDiv: ${div.bearish} | HidBull: ${hidden.hiddenBullish} | HidBear: ${hidden.hiddenBearish}`);
  }

  static _scoreBOS(candles) {
    const structure = indicatorService.detectMarketStructure(candles);
    let longScore, shortScore;

    if (structure.bos) {
      if (structure.bos.type === 'bullish_bos') { longScore = 8; shortScore = 2; }
      else { shortScore = 8; longScore = 2; }
    } else {
      if (structure.trend === 'bullish') { longScore = 6; shortScore = 4; }
      else if (structure.trend === 'bearish') { shortScore = 6; longScore = 4; }
      else { longScore = 4; shortScore = 6; }
    }

    return this._clamp(longScore, shortScore,
      `BOS: ${structure.bos ? structure.bos.type : 'none'} | Trend: ${structure.trend}`);
  }

  static _scoreFVG(candles) {
    const fvgs = indicatorService.findFairValueGaps(candles.slice(-30));
    const currentPrice = candles[candles.length - 1].close;

    const nearBull = fvgs.filter(f => f.type === 'bullish' && currentPrice >= f.bottom && currentPrice <= f.top * 1.005);
    const nearBear = fvgs.filter(f => f.type === 'bearish' && currentPrice <= f.top && currentPrice >= f.bottom * 0.995);

    let longScore, shortScore;

    if (nearBull.length > 0 && nearBear.length === 0) { longScore = 7; shortScore = 3; }
    else if (nearBear.length > 0 && nearBull.length === 0) { shortScore = 7; longScore = 3; }
    else {
      const b = fvgs.filter(f => f.type === 'bullish').length;
      const s = fvgs.filter(f => f.type === 'bearish').length;
      if (b > s) { longScore = 6; shortScore = 4; }
      else if (s > b) { shortScore = 6; longScore = 4; }
      else { longScore = 4; shortScore = 6; }
    }

    return this._clamp(longScore, shortScore,
      `Bull FVGs: ${fvgs.filter(f => f.type === 'bullish').length} | Bear FVGs: ${fvgs.filter(f => f.type === 'bearish').length}`);
  }

  static _scorePriceChange(candles, conditionText) {
    const currentPrice = candles[candles.length - 1].close;
    const change5 = candles.length >= 5
      ? ((currentPrice - candles[candles.length - 5].close) / candles[candles.length - 5].close * 100) : 0;
    const change20 = candles.length >= 20
      ? ((currentPrice - candles[candles.length - 20].close) / candles[candles.length - 20].close * 100) : 0;

    const mapping = this._parseDirections(conditionText);
    let longScore, shortScore;

    // Use the larger move for scoring
    const move = Math.abs(change5) > Math.abs(change20) * 0.5 ? change5 : change20;

    if (move > 1.5) {
      longScore = Math.min(9, 7 + Math.floor(move)); shortScore = 10 - longScore;
    } else if (move > 0.5) {
      longScore = 7; shortScore = 3;
    } else if (move > 0.1) {
      longScore = 6; shortScore = 4;
    } else if (move > -0.1) {
      // Very flat — use 20-candle for direction
      if (change20 > 0) { longScore = 6; shortScore = 4; }
      else { shortScore = 6; longScore = 4; }
    } else if (move > -0.5) {
      shortScore = 6; longScore = 4;
    } else if (move > -1.5) {
      shortScore = 7; longScore = 3;
    } else {
      shortScore = Math.min(9, 7 + Math.floor(Math.abs(move))); longScore = 10 - shortScore;
    }

    if (mapping.trendUp === 'short') {
      [longScore, shortScore] = [shortScore, longScore];
    }

    return this._clamp(longScore, shortScore,
      `5-candle: ${change5 > 0 ? '+' : ''}${change5.toFixed(2)}% | 20-candle: ${change20 > 0 ? '+' : ''}${change20.toFixed(2)}%`);
  }

  // ─── AI EVALUATION (qualitative conditions only) ───────────────

  static async _evaluateWithAI(conditionText, candles15m, macroCandles, detected = []) {
    const closes = candles15m.map(c => c.close);
    const currentPrice = closes[closes.length - 1];

    // Pre-compute ALL relevant indicators so AI has full context
    const rsiValues = indicatorService.calculateRSI(closes, 14);
    const currentRSI = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1].toFixed(1) : 'N/A';
    const ema20 = indicatorService.calculateEMA(closes, 20);
    const lastEma20 = ema20.length > 0 ? ema20[ema20.length - 1].toFixed(0) : 'N/A';
    const ema50 = indicatorService.calculateEMA(closes, 50);
    const lastEma50 = ema50.length > 0 ? ema50[ema50.length - 1].toFixed(0) : 'N/A';
    const structure = indicatorService.detectMarketStructure(candles15m);

    // Build extra indicator context based on what the condition mentions
    let extraIndicators = '';

    if (detected.includes('divergence')) {
      const div = indicatorService.detectDivergence(closes, rsiValues, 10);
      const hidden = indicatorService.detectHiddenDivergence(closes, rsiValues, 20);
      extraIndicators += `\n- RSI Divergence: Bullish=${div.bullish}, Bearish=${div.bearish}, HiddenBull=${hidden.hiddenBullish}, HiddenBear=${hidden.hiddenBearish}`;
    }

    if (detected.includes('support_resistance')) {
      const levels = indicatorService.findSupportResistance(candles15m);
      const supports = levels.filter(l => l.type === 'support' && l.price < currentPrice).sort((a, b) => b.price - a.price);
      const resistances = levels.filter(l => l.type === 'resistance' && l.price > currentPrice).sort((a, b) => a.price - b.price);
      extraIndicators += `\n- Nearest Support: $${supports[0] ? supports[0].price.toFixed(0) : 'N/A'} | Nearest Resistance: $${resistances[0] ? resistances[0].price.toFixed(0) : 'N/A'}`;
    }

    if (detected.includes('volume') && candles15m.length >= 50) {
      const avgVol = candles15m.slice(-50).reduce((s, c) => s + c.volume, 0) / 50;
      const currentVol = candles15m[candles15m.length - 1].volume;
      const ratio = (currentVol / avgVol).toFixed(1);
      const priceDir = candles15m[candles15m.length - 1].close > candles15m[candles15m.length - 2].close ? 'up' : 'down';
      extraIndicators += `\n- Volume: ${ratio}x average | Last candle direction: ${priceDir}`;
    }

    if (detected.includes('fvg')) {
      const fvgs = indicatorService.findFairValueGaps(candles15m.slice(-30));
      const bullFVG = fvgs.filter(f => f.type === 'bullish').length;
      const bearFVG = fvgs.filter(f => f.type === 'bearish').length;
      extraIndicators += `\n- Fair Value Gaps (last 30 candles): ${bullFVG} bullish, ${bearFVG} bearish`;
    }

    if (detected.includes('price_move')) {
      const change5 = candles15m.length >= 5
        ? ((currentPrice - candles15m[candles15m.length - 5].close) / candles15m[candles15m.length - 5].close * 100).toFixed(2) : '0';
      const change20 = candles15m.length >= 20
        ? ((currentPrice - candles15m[candles15m.length - 20].close) / candles15m[candles15m.length - 20].close * 100).toFixed(2) : '0';
      extraIndicators += `\n- Price Change: 5-candle=${change5}%, 20-candle=${change20}%`;
    }

    let macroContext = '';
    if (macroCandles && macroCandles !== candles15m) {
      const macroCloses = macroCandles.map(c => c.close);
      const macroStructure = indicatorService.detectMarketStructure(macroCandles);
      const macroRSI = indicatorService.calculateRSI(macroCloses, 14);
      const macroRSIVal = macroRSI.length > 0 ? macroRSI[macroRSI.length - 1].toFixed(1) : 'N/A';
      macroContext = `
HIGHER TIMEFRAME:
- Macro Trend: ${macroStructure.trend}
- Macro RSI: ${macroRSIVal}
- Macro BOS: ${macroStructure.bos ? macroStructure.bos.type : 'none'}`;
    }

    const chart = indicatorService.generateAsciiChart(candles15m, 30, 12);

    const prompt = `You are a decisive BTC/USDT trading analyst. Evaluate this condition.

CONDITION: "${conditionText}"

PRE-COMPUTED DATA (15m chart — all math already done, DO NOT recalculate):
- Price: $${currentPrice}
- RSI(14): ${currentRSI}
- EMA20: $${lastEma20} | EMA50: $${lastEma50}
- Trend: ${structure.trend}
- BOS: ${structure.bos ? structure.bos.type : 'none'}
- Structures: ${structure.structures.slice(-5).map(s => s.type).join(', ') || 'none'}${extraIndicators}${macroContext}

CHART (15m):
${chart}

STRICT SCORING RULES:
1. longScore + shortScore MUST equal exactly 10
2. GIVING 5 AND 5 IS FORBIDDEN — you MUST pick a side
3. Minimum gap between scores is 2 (e.g. 6/4, 7/3, 8/2, 9/1)
4. Use the pre-computed data to make your decision — do NOT guess or estimate indicators
5. If the condition clearly favors one side, give 7+ to that side
6. If signals are mixed, give 6/4 — NEVER 5/5

RESPOND WITH ONLY THIS JSON (no markdown, no explanation outside JSON):
{"longScore": X, "shortScore": Y, "summary": "one sentence"}`;

    try {
      const result = await groqService.analyze(prompt);

      // Validate AI actually returned usable scores
      if (typeof result.longScore !== 'number' || typeof result.shortScore !== 'number' ||
          isNaN(result.longScore) || isNaN(result.shortScore)) {
        console.warn('AI returned invalid scores, falling back to math:', JSON.stringify(result));
        return this._mathFallback(detected, closes, candles15m, conditionText);
      }

      let longScore = Math.round(result.longScore);
      let shortScore = Math.round(result.shortScore);

      // Force sum to 10
      if (longScore + shortScore !== 10) {
        const total = longScore + shortScore;
        if (total > 0) {
          longScore = Math.round((longScore / total) * 10);
          shortScore = 10 - longScore;
        } else {
          return this._mathFallback(detected, closes, candles15m, conditionText);
        }
      }

      // Reject 5/5 — use computed trend to break tie
      if (longScore === 5 && shortScore === 5) {
        if (structure.trend === 'bullish') { longScore = 6; shortScore = 4; }
        else if (structure.trend === 'bearish') { longScore = 4; shortScore = 6; }
        else {
          const rsi = parseFloat(currentRSI);
          if (!isNaN(rsi) && rsi >= 50) { longScore = 4; shortScore = 6; }
          else { longScore = 6; shortScore = 4; }
        }
      }

      return this._clamp(longScore, shortScore,
        result.summary || `AI: L${longScore}/S${shortScore}`);
    } catch (err) {
      console.error('Groq AI evaluation failed, using math fallback:', err.message);
      return this._mathFallback(detected, closes, candles15m, conditionText);
    }
  }

  /**
   * Math-only fallback used when Groq AI is unavailable.
   * Routes to the best matching math scorer based on detected keywords.
   */
  static _mathFallback(detected, closes, candles, conditionText) {
    if (detected.includes('rsi') && !detected.includes('divergence')) {
      return this._scoreRSI(closes, conditionText);
    }
    if (detected.includes('divergence')) {
      return this._scoreDivergence(closes);
    }
    if (detected.includes('ema') || detected.includes('sma')) {
      return this._scoreMovingAverage(closes, conditionText);
    }
    if (detected.includes('support_resistance')) {
      return this._scoreSupportResistance(candles);
    }
    if (detected.includes('volume')) {
      return this._scoreVolume(candles);
    }
    if (detected.includes('bos')) {
      return this._scoreBOS(candles);
    }
    if (detected.includes('fvg')) {
      return this._scoreFVG(candles);
    }
    if (detected.includes('trend')) {
      return this._scoreTrend(candles, conditionText);
    }
    if (detected.includes('price_move')) {
      return this._scorePriceChange(candles, conditionText);
    }
    return this._computedFallback(closes, candles);
  }

  // ─── COMPUTED FALLBACK ─────────────────────────────────────────

  /**
   * Used when AI fails or is unavailable.
   * Combines RSI + trend + EMA + BOS into a composite score.
   */
  static _computedFallback(closes, candles) {
    if (!candles) {
      // Build minimal candles from closes
      candles = closes.map((c, i) => ({ open: c, high: c, low: c, close: c, volume: 0 }));
    }

    const rsiValues = indicatorService.calculateRSI(closes, 14);
    const rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;
    const structure = indicatorService.detectMarketStructure(candles);
    const ema20 = indicatorService.calculateEMA(closes, 20);
    const currentPrice = closes[closes.length - 1];
    const lastEma = ema20.length > 0 ? ema20[ema20.length - 1] : currentPrice;
    const aboveEma = currentPrice > lastEma;

    // Point system
    let bull = 0, bear = 0;

    if (rsi < 30) bull += 3;
    else if (rsi < 40) bull += 2;
    else if (rsi < 50) bull += 1;
    else if (rsi > 70) bear += 3;
    else if (rsi > 60) bear += 2;
    else if (rsi > 50) bear += 1;

    if (structure.trend === 'bullish') bull += 2;
    else if (structure.trend === 'bearish') bear += 2;

    if (aboveEma) bull += 1; else bear += 1;

    if (structure.bos) {
      if (structure.bos.type === 'bullish_bos') bull += 2;
      else bear += 2;
    }

    const total = bull + bear;
    let longScore, shortScore;

    if (total === 0) {
      longScore = 4; shortScore = 6;
    } else {
      longScore = Math.round((bull / total) * 8) + 1;
      shortScore = 10 - longScore;
    }

    return this._clamp(longScore, shortScore,
      `Computed: RSI=${rsi.toFixed(1)} Trend=${structure.trend} ${aboveEma ? 'Above' : 'Below'} EMA20 (AI unavailable)`);
  }

  // ─── UTILITY ───────────────────────────────────────────────────

  /**
   * Clamp scores to 1-10, ensure sum is 10, and NEVER return 5/5
   */
  static _clamp(longScore, shortScore, summary) {
    longScore = Math.max(1, Math.min(9, Math.round(longScore)));
    shortScore = 10 - longScore;

    // Final safety: no 5/5
    if (longScore === 5) {
      longScore = 4; shortScore = 6;
    }

    return { longScore, shortScore, summary };
  }
}

module.exports = ConditionEvaluator;
