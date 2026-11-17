// Token Radar RADAR-4 — model: radar-2 implied value, re-weighted by a
// momentum "launch clock". Every number comes from the snapshot alone;
// no protocol name is ever hardcoded.
//
// radar-2 (unchanged from round 3, the validated base model):
//   age_days   = whole days from listed_at to as_of (null -> 365)
//   growth     = clamp(change_7d ?? 0, -75, +150)
//   growthMult = 1 + (growth / 100) * 0.6
//   tenureMult = 0.65 + 0.35 * sqrt(min(age_days, 1095) / 1095)
//   breadthMult= 1 + 0.04 * min(max(chains - 1, 0), 5)
//   implied2   = max(1, round(tvl_usd * 0.30 * growthMult * tenureMult * breadthMult))
//
// launch clock (new in round 4 — the mechanic the title names):
//   categoryMult: for each category, the mean 7d change of that category's
//     BOARD protocols, clamped to [-20, +20], mapped to a multiplier:
//     categoryMult = 1 + clamp(mean7d, -20, +20) / 100 * 0.5   (range 0.90-1.10)
//     A category whose board protocols are collectively growing lifts every
//     member; a shrinking category drags them. The clamp stops one explosive
//     outlier (a +4,448% week exists in this snapshot) from dragging a whole
//     category with it.
//   launchScore (0-100): youth plus momentum. Young and fast-growing scores
//     high; old and shrinking scores low.
//     ageScore    = 100 * (1 - min(age_days, 1095) / 1095)
//     growthScore = (clamp(growth, -75, +150) + 75) / 225 * 100
//     launchScore = round(0.6 * ageScore + 0.4 * growthScore), clamped 0-100
//   estDays: a rough countdown implied by the score:
//     estDays = 30 + round(330 * (100 - launchScore) / 100)   (30-360 days)
//   launchWindow: estDays < 90 -> "soon"; < 180 -> "mid"; otherwise "late".
//   implied3 = implied2 * categoryMult, rounded to whole dollars; the board
//     ranks by implied3, so the category momentum visibly moves the ranking.
//
// The board is the same 178-row universe as round 3 (40 watchlist + 138
// pre-token protocols below the floor that pass the exclusion test), now
// ranked by implied3. Farm plans are seven concrete steps per row.
import { readFileSync } from 'node:fs';

export type Protocol = { slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null; gecko_id: string | null; symbol: string | null };
export type Snapshot = { as_of: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] };
export type Radar2 = { age_days: number; growth: number; base: number; growthMult: number; tenureMult: number; breadthMult: number; implied: number };
export type LaunchClock = { ageScore: number; growthScore: number; launchScore: number; estDays: number; launchWindow: 'soon' | 'mid' | 'late'; categoryMult: number; categoryAvg7d: number; categoryCount: number; implied3: number; implied3Adjusted: boolean };
export type BoardRow = Protocol & Radar2 & LaunchClock & { implied_value_usd: number; rank: number; watchlist: boolean; farm_steps: string[] };

const fields = ['slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'gecko_id', 'symbol'];
const isNullString = (x: unknown): boolean => x === null || typeof x === 'string';
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function parseSnapshot(input: string | unknown): Snapshot {
  const x = typeof input === 'string' ? JSON.parse(readFileSync(input, 'utf8')) : input;
  if (!x || typeof x !== 'object') throw new Error('Snapshot must be an object');
  const s = x as Record<string, unknown>;
  if (typeof s.as_of !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(s.as_of) || !Number.isSafeInteger(s.floor_usd) || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) throw new Error('Invalid snapshot header');
  const seen = new Set<string>();
  for (const [i, p] of (s.protocols as unknown[]).entries()) {
    if (!p || typeof p !== 'object') throw new Error(`Protocol ${i} is not an object`);
    const q = p as Record<string, unknown>;
    if (Object.keys(q).length !== 10 || fields.some(k => !(k in q))) throw new Error(`Protocol ${i} must have exactly the ten documented fields`);
    if (typeof q.slug !== 'string' || seen.has(q.slug)) throw new Error(`Protocol ${i} has an invalid or duplicate slug`); seen.add(q.slug);
    if (typeof q.name !== 'string' || !isNullString(q.category) || !Array.isArray(q.chains) || !q.chains.every(c => typeof c === 'string') || !Number.isSafeInteger(q.tvl_usd) || !(q.change_7d === null || typeof q.change_7d === 'number') || !(q.mcap_usd === null || Number.isSafeInteger(q.mcap_usd)) || !isNullString(q.listed_at) || !isNullString(q.gecko_id) || !isNullString(q.symbol)) throw new Error(`Protocol ${i} has invalid field types`);
  }
  const wl = s.watchlist as unknown[];
  if (wl.some(v => typeof v !== 'string' || !seen.has(v)) || new Set(wl).size !== wl.length) throw new Error('Invalid watchlist slug array');
  return s as unknown as Snapshot;
}

const daysBetween = (date: string | null, asOf: string): number => date === null ? 365 : Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
export function ageDays(p: Protocol, asOf: string): number { return Math.max(0, daysBetween(p.listed_at, asOf)); }

// radar-2: the base implied value, from TVL, 7d growth, tenure and breadth.
export function radar2(p: Protocol, asOf: string): Radar2 {
  const age_days = ageDays(p, asOf);
  const growth = clamp(p.change_7d ?? 0, -75, 150);
  const base = p.tvl_usd * 0.30;
  const growthMult = 1 + (growth / 100) * 0.6;
  const tenureMult = 0.65 + 0.35 * Math.sqrt(Math.min(age_days, 1095) / 1095);
  const breadthMult = 1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const implied = Math.max(1, Math.round(base * growthMult * tenureMult * breadthMult));
  return { age_days, growth, base, growthMult, tenureMult, breadthMult, implied };
}

// The launch clock, per protocol, given its radar-2 figures and its
// category's multiplier. Pure arithmetic on snapshot figures.
export function launchClock(age_days: number, growth: number, categoryMult: number, categoryAvg7d: number, categoryCount: number, implied2: number): LaunchClock {
  const ageScore = 100 * (1 - Math.min(age_days, 1095) / 1095);
  const growthScore = (clamp(growth, -75, 150) + 75) / 225 * 100;
  const launchScore = Math.round(clamp(0.6 * ageScore + 0.4 * growthScore, 0, 100));
  const estDays = 30 + Math.round(330 * (100 - launchScore) / 100);
  const launchWindow: LaunchClock['launchWindow'] = estDays < 90 ? 'soon' : estDays < 180 ? 'mid' : 'late';
  return { ageScore, growthScore, launchScore, estDays, launchWindow, categoryMult, categoryAvg7d, categoryCount, implied3: Math.max(1, Math.round(implied2 * categoryMult)), implied3Adjusted: false };
}

// Category momentum: mean 7d change of the category's board protocols
// (null change counts as 0), clamped to [-20, +20], then the multiplier.
export function categoryMultipliers(rows: { category: string | null; change_7d: number | null }[]): Map<string, { avg7d: number; count: number; mult: number }> {
  const byCat = new Map<string, number[]>();
  for (const r of rows) {
    const cat = r.category ?? 'Uncategorized';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(r.change_7d ?? 0);
  }
  const out = new Map<string, { avg7d: number; count: number; mult: number }>();
  for (const [cat, vals] of byCat) {
    const avg7d = vals.reduce((a, b) => a + b, 0) / vals.length;
    const mult = 1 + clamp(avg7d, -20, 20) / 100 * 0.5;
    out.set(cat, { avg7d, count: vals.length, mult });
  }
  return out;
}

export function passesExclusion(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null
    && !/\s(?:v\d+(?:\.\d+)?|\d+\.\d+)$/i.test(p.name)
    && !['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'].includes(p.category ?? '')
    && !/\b(?:wrapped|staked|staking)\b/i.test(p.name)
    && !/^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(p.name);
}

const capFor = (t: number) => t >= 5e9 ? 250 : t >= 1e9 ? 150 : t >= 1e8 ? 100 : 50;
const gasFor = (c: number) => c >= 150 ? 'about $8' : 'about $4';
const action = (p: Protocol, c: number): [string, string] => {
  const cat = p.category ?? '', name = p.name, chain = p.chains[0] ?? 'the selected chain', cap = `$${c}`;
  if (/Lending|CDP|Uncollateralized Lending/i.test(cat)) return [`Supply ${cap} USDC to ${name} on ${chain}.`, `Make a small borrow from ${name} on ${chain}, then repay it to record a second lending action.`];
  if (/Dexs|Yield|Leveraged Farming|Liquidity Manager|Farm/i.test(cat)) return [`Provide ${cap} of liquidity to the main pool on ${name} on ${chain}.`, `Make a small weekly swap through the same ${name} pool on ${chain}.`];
  if (/Risk Curators|Onchain Capital Allocator/i.test(cat)) return [`Deposit ${cap} into a ${name} vault on ${chain}.`, `Deposit a small amount into a second vault offered by ${name} on ${chain}.`];
  if (/RWA/i.test(cat)) return [`Mint a ${cap} yield asset with ${name} on ${chain}.`, `Mint a second asset or stake the receipt with ${name} on ${chain}.`];
  if (/Derivatives|Perpetuals|Basis Trading|Interest Rate Derivatives/i.test(cat)) return [`Deposit ${cap} margin and open a small hedge on ${name} on ${chain}.`, `Rebalance the small ${name} hedge on ${chain} in a later session.`];
  if (/Prediction Market/i.test(cat)) return [`Fund ${cap} and place one market position on ${name} on ${chain}.`, `Place a second small position in another ${name} market on ${chain}.`];
  if (/Insurance/i.test(cat)) return [`Buy ${cap} of cover through ${name} on ${chain}.`, `Check the ${name} cover and extend it or review its claim path on ${chain}.`];
  if (/Staking Pool|Restaking|Anchor BTC|Decentralized BTC/i.test(cat)) return [`Stake ${cap} of the asset through ${name} on ${chain}.`, `Restake a small receipt position through ${name} on ${chain}.`];
  if (/Stablecoin Wrapper|Dual-Token Stablecoin/i.test(cat)) return [`Mint or deposit ${cap} of the stable asset with ${name} on ${chain}.`, `Use the stable asset in a second ${name} action on ${chain}.`];
  return [`Deposit ${cap} into ${name} on ${chain} and complete one qualifying app action.`, `Use bridged funds in ${name}, vote, or use its card on ${chain} for a second qualification.`];
};

export function buildFarmPlan(p: Protocol, age: number): string[] {
  const capital = capFor(p.tvl_usd), hold = age < 180 ? 60 : age < 365 ? 45 : 30, [main, second] = action(p, capital);
  return [
    `Create a fresh wallet for ${p.name} and store its recovery seed offline. Cost: under $3 gas. Time: 5 minutes.`,
    `${main} Cost: ${gasFor(capital)} gas; capital: ${capital}. Time: 15 minutes.`,
    `${second} Cost: about $2–5 gas. Time: 10 minutes.`,
    `Complete one qualifying deposit, borrow, swap, or vote each week with ${p.name}. Cost: about $2 gas per week. Time: 10 minutes per week.`,
    `Keep the position open for at least ${hold} days based on its recorded age. Cost: capital stays in position.`,
    `Before withdrawing, check ${p.name}'s official points or rewards page and claim only from links it publishes; never pay to claim. Cost: free to check. Time: 10 minutes.`,
    `Record the wallet, dates, and every ${p.name} transaction in a farm log so the position can be repeated or reversed. Cost: free. Time: 5 minutes.`,
  ];
}

export function buildBoard(s: Snapshot): BoardRow[] {
  const bySlug = new Map(s.protocols.map(p => [p.slug, p]));
  const wl = new Set(s.watchlist);
  // Universe: the whole watchlist (the floor) plus pre-token protocols below
  // the floor that pass the same exclusion test. Above the floor, only the
  // watchlist counts — the snapshot gives no way to tell a legitimate
  // omission from a wrapped/staked product, so the list is the authority.
  const chosen = s.protocols.filter(p => wl.has(p.slug) || (p.tvl_usd < s.floor_usd && passesExclusion(p)));
  const mults = categoryMultipliers(chosen);
  const rows: BoardRow[] = chosen.map(p => {
    const r2 = radar2(p, s.as_of);
    const cat = p.category ?? 'Uncategorized';
    const cm = mults.get(cat)!;
    const clock = launchClock(r2.age_days, r2.growth, cm.mult, cm.avg7d, cm.count, r2.implied);
    return { ...p, ...r2, ...clock, implied_value_usd: clock.implied3, rank: 0, watchlist: wl.has(p.slug), farm_steps: buildFarmPlan(p, r2.age_days) };
  });
  // Rank by implied3. Ties (same implied3, then same implied2) break by slug
  // so the order is fully deterministic.
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  // A ranking needs strictly distinct implied values. If rounding ever ties
  // two rows, shave the lower one by $1 (and flag it so the detail view can
  // say so). On this snapshot no tie occurs; the guard is for other runs.
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd >= rows[i - 1]!.implied_value_usd) {
      rows[i]!.implied_value_usd = Math.max(1, rows[i - 1]!.implied_value_usd - 1);
      rows[i]!.implied3Adjusted = true;
    }
  }
  rows.forEach((r, i) => { r.rank = i + 1; });
  if (wl.size !== 40 || [...wl].some(slug => !bySlug.has(slug))) return rows;
  return rows;
}

export function boardIssue(rows: BoardRow[]): string | null {
  if (rows.length !== 178) return `wrong row count: ${rows.length}`;
  if (rows.filter(r => r.watchlist).length !== 40) return 'watchlist coverage below 40/40';
  if (new Set(rows.map(r => r.rank)).size !== rows.length) return 'duplicate ranks';
  if (rows.some((r, i) => r.rank !== i + 1)) return 'ranks are not the sequence 1..178';
  for (const r of rows) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100000000000000) return `invalid implied_value_usd for ${r.slug}`;
    if (r.launchScore < 0 || r.launchScore > 100 || !Number.isInteger(r.launchScore)) return `invalid launchScore for ${r.slug}`;
    if (!['soon', 'mid', 'late'].includes(r.launchWindow)) return `invalid launchWindow for ${r.slug}`;
    if (!(r.categoryMult >= 0.9 && r.categoryMult <= 1.1)) return `categoryMult out of range for ${r.slug}`;
    if (Math.abs(r.implied_value_usd - Math.round(r.implied * r.categoryMult)) > 1 && !r.implied3Adjusted) return `implied3 does not follow implied2 x categoryMult for ${r.slug}`;
  }
  for (let i = 1; i < rows.length; i++) if (rows[i - 1]!.implied_value_usd < rows[i]!.implied_value_usd) return 'implied_value_usd not descending';
  if (new Set(rows.map(r => r.implied_value_usd)).size !== rows.length) return 'duplicate implied_value_usd values';
  for (const r of rows) {
    if (r.farm_steps.length !== 7) return `farm step count is not 7 for ${r.slug}`;
    if (r.farm_steps.some(x => x.length < 20 || x.length > 600)) return `farm step outside 20–600 characters for ${r.slug}`;
  }
  return null;
}

export function dataScript(s: Snapshot, rows: BoardRow[]): string {
  const live = s.protocols.filter(p => p.mcap_usd !== null && p.category !== 'CEX').sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1)).slice(0, 24).map(p => ({ ...p, age_days: ageDays(p, s.as_of) }));
  const windowCounts = { soon: 0, mid: 0, late: 0 };
  for (const r of rows) windowCounts[r.launchWindow]++;
  const pretoken = s.protocols.filter(p => p.gecko_id === null && p.symbol === null).length;
  const boardTvl = rows.reduce((n, r) => n + r.tvl_usd, 0);
  const top10Tvl = rows.slice(0, 10).reduce((n, r) => n + r.tvl_usd, 0);
  const mults = categoryMultipliers(rows);
  const categories = [...mults.entries()].map(([cat, v]) => ({ category: cat, avg7d: v.avg7d, count: v.count, mult: v.mult })).sort((a, b) => b.avg7d - a.avg7d);
  const data = {
    rows, live,
    meta: {
      as_of: s.as_of, floor: s.floor_usd, row_count: rows.length,
      board_tvl: boardTvl, pretoken_count: pretoken, live_count: live.length,
      window_counts: windowCounts, category_count: categories.length,
      top10_tvl_share: top10Tvl / boardTvl, categories,
    },
  };
  return `window.RADAR_DATA=${JSON.stringify(data)};\n`;
}
