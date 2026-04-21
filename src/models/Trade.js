'use strict';
// ── StillBlvck Elite — Trade Model ────────────────────────────────

const mongoose = require('mongoose');

const TradeSchema = new mongoose.Schema({
  // Core
  pair:       { type:String, required:true, uppercase:true, index:true },
  label:      { type:String, default:'' },
  direction:  { type:String, enum:['BUY','SELL'], required:true },
  // Levels
  entry:      { type:Number, required:true },
  sl:         { type:Number, required:true },
  tp1:        { type:Number, required:true },
  tp2:        { type:Number },
  // Signal quality
  confidence: { type:Number, required:true, min:0, max:100 },
  confluence: { type:Number, default:0 },
  rawScore:   { type:Number, default:0 },
  rrRatio:    { type:Number, default:0 },
  plannedRR:  { type:Number, default:0 },
  // Classification
  setupType:  { type:String, enum:['BOS','CHOCH','FVG','OB','LIQUIDITY','MIXED','MANUAL','UNKNOWN'], default:'UNKNOWN', index:true },
  session:    { type:String, default:'UNKNOWN', index:true },
  mtfBias:    { type:String, default:'NEUTRAL' },
  marketPhase:{ type:String, default:'UNKNOWN' },
  factors:    [{ type:String }],
  reason:     { type:String, default:'' },
  // Lifecycle
  status:     { type:String, enum:['OPEN','WIN','LOSS','BE','CANCELLED'], default:'OPEN', index:true },
  outcome:    { type:String, enum:['WIN','LOSS','BE','CANCELLED','OPEN'], default:'OPEN' },
  lifecycle:  { type:String, enum:['OPEN','ACTIVE','CLOSED','STORED','ANALYZED'], default:'OPEN' },
  // Close data
  closePrice: { type:Number },
  pnlPips:    { type:Number },
  pnlR:       { type:Number },
  pnlUSD:     { type:Number },
  pnlPercent: { type:Number },
  hitTP1:     { type:Boolean, default:false },
  hitTP2:     { type:Boolean, default:false },
  hitSL:      { type:Boolean, default:false },
  // Timestamps
  openedAt:   { type:Date, default:Date.now, index:true },
  closedAt:   { type:Date },
  analyzedAt: { type:Date },
  // Journal
  notes:      { type:String, default:'' },
  emotion:    { type:String, enum:['CONFIDENT','NEUTRAL','UNCERTAIN','FOMO','FEARFUL',''], default:'' },
  grade:      { type:String, enum:['A','B','C','D','','N/A'], default:'' },
  screenshot: { type:String, default:'' },
  // Meta
  alertSent:  { type:Boolean, default:false },
  source:     { type:String, default:'ENGINE' },
  simulated:  { type:Boolean, default:false },
}, {
  timestamps: true,
  toJSON: { virtuals:true },
});

// Indexes for analytics queries
TradeSchema.index({ status:1, openedAt:-1 });
TradeSchema.index({ pair:1,  status:1 });
TradeSchema.index({ setupType:1, status:1 });
TradeSchema.index({ session:1,   status:1 });

// Virtuals
TradeSchema.virtual('durationMin').get(function() {
  return this.closedAt ? Math.round((this.closedAt - this.openedAt) / 60000) : null;
});

// Pre-save: sync outcome and auto-detect setupType
TradeSchema.pre('save', function(next) {
  if (this.status !== 'OPEN') {
    this.outcome = this.status;
    if (this.status === 'WIN')  { this.hitTP1 = true; this.lifecycle = 'ANALYZED'; }
    if (this.status === 'LOSS') { this.hitSL  = true; this.lifecycle = 'ANALYZED'; }
    if (['BE','CANCELLED'].includes(this.status)) this.lifecycle = 'ANALYZED';
    if (!this.analyzedAt && this.lifecycle === 'ANALYZED') this.analyzedAt = new Date();
  }
  if (this.setupType === 'UNKNOWN' && this.factors && this.factors.length) {
    const f = this.factors.join(' ').toUpperCase();
    if (f.includes('CHOCH'))      this.setupType = 'CHOCH';
    else if (f.includes('BOS'))   this.setupType = 'BOS';
    else if (f.includes('FVG'))   this.setupType = 'FVG';
    else if (f.includes('OB'))    this.setupType = 'OB';
    else if (f.includes('LIQ'))   this.setupType = 'LIQUIDITY';
    else if (this.factors.length > 1) this.setupType = 'MIXED';
  }
  if (!this.plannedRR && this.rrRatio) this.plannedRR = this.rrRatio;
  next();
});

// Static: basic stats
TradeSchema.statics.getStats = async function() {
  const [total, wins, losses, open, be] = await Promise.all([
    this.countDocuments(),
    this.countDocuments({ status:'WIN' }),
    this.countDocuments({ status:'LOSS' }),
    this.countDocuments({ status:'OPEN' }),
    this.countDocuments({ status:'BE' }),
  ]);
  const closed  = wins + losses;
  const winRate = closed > 0 ? Math.round((wins / closed) * 100) : 0;
  const pf      = losses > 0 ? parseFloat((wins / losses).toFixed(2)) : null;
  return { total, wins, losses, open, be, closed, winRate, profitFactor:pf };
};

// Static: deep analytics — returns { key } structure for bestPair/bestSession/bestSetup
TradeSchema.statics.getAnalytics = async function() {
  const closed = await this.find({ status:{ $in:['WIN','LOSS','BE'] } }).lean();
  if (!closed.length) return null;

  const wins   = closed.filter(t => t.status === 'WIN');
  const losses = closed.filter(t => t.status === 'LOSS');
  const total  = closed.length;

  const rrs      = closed.filter(t => (t.rrRatio||0) > 0).map(t => t.rrRatio);
  const avgRR    = rrs.length ? parseFloat((rrs.reduce((s,r) => s+r, 0) / rrs.length).toFixed(2)) : 0;
  const totalPnlR= parseFloat(closed.reduce((s,t) => s + (t.pnlR||0), 0).toFixed(2));
  const winR     = wins.reduce((s,t)   => s + Math.abs(t.pnlR || t.rrRatio || 1), 0);
  const lossR    = losses.reduce((s,t) => s + Math.abs(t.pnlR || 1), 0);
  const profitFactor = lossR > 0 ? parseFloat((winR / lossR).toFixed(2)) : null;

  // Streak
  const sorted = [...closed].sort((a,b) => new Date(b.openedAt) - new Date(a.openedAt));
  let streak=0, streakType=null;
  for (const t of sorted) {
    const w = t.status === 'WIN';
    if (!streakType) streakType = w ? 'WIN' : 'LOSS';
    if ((streakType==='WIN'&&w)||(streakType==='LOSS'&&!w)) streak++;
    else break;
  }

  // Build maps
  const pairMap={}, sessMap={}, setupMap={};
  for (const t of closed) {
    const p=t.pair||'?', s=t.session||'?', u=t.setupType||'?';
    if (!pairMap[p])  pairMap[p]  = { wins:0, total:0, pnlR:0 };
    if (!sessMap[s])  sessMap[s]  = { wins:0, total:0, pnlR:0 };
    if (!setupMap[u]) setupMap[u] = { wins:0, total:0, pnlR:0 };
    pairMap[p].total++;  sessMap[s].total++;  setupMap[u].total++;
    pairMap[p].pnlR  += t.pnlR||0;
    sessMap[s].pnlR  += t.pnlR||0;
    setupMap[u].pnlR += t.pnlR||0;
    if (t.status==='WIN') { pairMap[p].wins++; sessMap[s].wins++; setupMap[u].wins++; }
  }

  // rank returns { key, winRate, trades, pnlR } — key is the identifier string
  const rank = (map, min=1) =>
    Object.entries(map)
      .filter(([k,v]) => v.total >= min && k !== '?')
      .map(([k,v]) => ({
        key:     k,
        winRate: Math.round(v.wins / v.total * 100),
        trades:  v.total,
        pnlR:    parseFloat(v.pnlR.toFixed(2)),
      }))
      .sort((a,b) => b.winRate - a.winRate);

  const rankedSetups = rank(setupMap, 1);

  // Direction breakdown
  const buyT  = closed.filter(t => t.direction==='BUY');
  const sellT = closed.filter(t => t.direction==='SELL');
  const dirBreakdown = {
    BUY:  { total:buyT.length,  wins:buyT.filter(t=>t.status==='WIN').length,  winRate: buyT.length>0  ? Math.round(buyT.filter(t=>t.status==='WIN').length/buyT.length*100)   : 0 },
    SELL: { total:sellT.length, wins:sellT.filter(t=>t.status==='WIN').length, winRate: sellT.length>0 ? Math.round(sellT.filter(t=>t.status==='WIN').length/sellT.length*100) : 0 },
  };

  // Weekly PnL (last 4 weeks)
  const now = Date.now();
  const weeks = {};
  for (const t of closed) {
    const age = (now - new Date(t.openedAt).getTime()) / 86400000;
    if (age > 28) continue;
    const wk = `W${Math.ceil((28-age)/7)}`;
    if (!weeks[wk]) weeks[wk] = { wins:0, losses:0, pips:0, pnlR:0, trades:0 };
    if (t.status==='WIN')  weeks[wk].wins++;
    if (t.status==='LOSS') weeks[wk].losses++;
    weeks[wk].pips   += t.pnlPips||0;
    weeks[wk].pnlR   += t.pnlR||0;
    weeks[wk].trades++;
  }
  const weeklyPnL = Object.entries(weeks)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([week,v]) => ({ week, ...v, pips:parseFloat(v.pips.toFixed(1)), pnlR:parseFloat(v.pnlR.toFixed(2)) }));

  const pairStats = Object.entries(pairMap)
    .map(([pair,v]) => ({ pair, total:v.total, wins:v.wins, losses:v.total-v.wins, winRate:Math.round(v.wins/v.total*100), pnlR:parseFloat(v.pnlR.toFixed(2)) }))
    .sort((a,b) => b.total - a.total);

  const setupStats = Object.entries(setupMap)
    .filter(([k]) => k !== '?')
    .map(([setup,v]) => ({ setup, total:v.total, wins:v.wins, winRate:Math.round(v.wins/v.total*100) }))
    .sort((a,b) => b.total - a.total);

  return {
    totalClosed: total,
    wins:        wins.length,
    losses:      losses.length,
    winRate:     Math.round(wins.length / total * 100),
    avgRR, totalPnlR, profitFactor,
    currentStreak: streak,
    streakType,
    bestPair:    rank(pairMap,1)[0]  || null,
    bestSession: rank(sessMap,1)[0]  || null,
    bestSetup:   rankedSetups[0]     || null,
    worstSetup:  rankedSetups[rankedSetups.length-1] || null,
    setupStats, dirBreakdown, weeklyPnL, pairStats, setupMap, sessMap,
  };
};

module.exports = mongoose.model('Trade', TradeSchema);
