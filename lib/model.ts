// Token Launch Radar — valuation model "radar-2".
//
// The question the board answers: if a protocol that has no token today
// issued one tomorrow, what would that token plausibly be worth?
//
// The answer is built only from the sealed snapshot, in three parts:
//
//   1. A peer multiple. For every category, take the median
//      market-cap / TVL of the protocols in that category whose token
//      already trades (at least 3 peers, otherwise the global median
//      across all tokened protocols). A multiple is what the market
//      actually pays per dollar of TVL in that corner of DeFi, so a
//      Risk Curator is not priced like a DEX. The multiple is clamped
//      to [0.05, 2.5] so one outlier category cannot run away.
//   2. A growth multiplier from the 7-day TVL change (percent, clamped
//      to [-60, +120]): 1 + growth/100 * 0.5, i.e. 0.7x .. 1.6x.
//   3. A maturity multiplier from the protocol's age at the snapshot
//      date: 0.6 for a brand-new protocol, rising linearly to 1.0 at
//      three years. A protocol that survived three bear markets without
//      a token is a safer bet than one listed last week.
//
//   implied value = TVL x peer multiple x growth multiplier x maturity
//
// Board membership follows the same rule the snapshot's own watchlist
// uses (the rule is spelled out in the kit's RULES.txt): pre-token,
// not a wrapped or staked product, not a bridge, not liquid staking,
// not a centralised exchange, not a versioned re-deployment. The
// watchlist (TVL >= $50M) is taken whole; below the floor the same
// rule is applied so the board keeps ranking real token launches
// instead of filling up with wrapped assets.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source?: string;
  floor_usd: number;
  watchlist: string[];
  protocols: SnapshotProtocol[];
}

export interface ModelConstants {
  /** Weight of the 7-day growth term (0.5 => +/-60% at the clamps). */
  growth_weight: number;
  /** 7-day change clamp, percent. */
  growth_floor: number;
  growth_cap: number;
  /** Peer multiple clamps. */
  multiple_floor: number;
  multiple_cap: number;
  /** Peers needed in a category before its own median is trusted. */
  min_peers: number;
  /** Age (days) at which the maturity multiplier reaches 1.0. */
  maturity_days: number;
  /** Maturity multiplier for a protocol listed yesterday. */
  maturity_floor: number;
}

export const DEFAULT_MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  multiple_floor: 0.05,
  multiple_cap: 2.5,
  min_peers: 3,
  maturity_days: 1095,
  maturity_floor: 0.6,
};

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
  "KuCoin",
  "Gate",
];
const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The launch rule: a genuine pre-token protocol, not a wrapped, staked,
 *  bridged or exchange product whose "token" already exists elsewhere. */
export function passesLaunchRule(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Peer multiples
// ---------------------------------------------------------------------------

export interface PeerTable {
  byCategory: Map<string, number>;
  byCategoryCount: Map<string, number>;
  global: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function peerMultiples(
  snapshot: Snapshot,
  model: ModelConstants = DEFAULT_MODEL,
): PeerTable {
  const perCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    // A market cap of 0 is a dead token, not a priced peer: it must not
    // drag a category's median (or the global one) toward zero.
    if (typeof p.mcap_usd !== "number" || p.mcap_usd <= 0) continue;
    if (typeof p.tvl_usd !== "number" || p.tvl_usd <= 0) continue;
    const multiple = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(multiple)) continue;
    const list = perCategory.get(p.category) ?? [];
    list.push(multiple);
    perCategory.set(p.category, list);
    all.push(multiple);
  }
  const global = clamp(median(all), model.multiple_floor, model.multiple_cap);
  const byCategory = new Map<string, number>();
  const byCategoryCount = new Map<string, number>();
  for (const [category, values] of perCategory) {
    byCategoryCount.set(category, values.length);
    if (values.length >= model.min_peers) {
      byCategory.set(category, clamp(median(values), model.multiple_floor, model.multiple_cap));
    }
  }
  return { byCategory, byCategoryCount, global };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Age and valuation
// ---------------------------------------------------------------------------

export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (!p.listed_at) return null;
  const listed = Date.parse(p.listed_at);
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(listed) || !Number.isFinite(asOfMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listed) / 86400000));
}

export interface Valuation {
  implied: number;
  peer_multiple: number;
  peer_count: number;
  peer_category: string;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
}

export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  peers: PeerTable,
  model: ModelConstants = DEFAULT_MODEL,
): Valuation {
  const peerCount = peers.byCategoryCount.get(p.category) ?? 0;
  const categoryMultiple = peers.byCategory.get(p.category);
  const peerMultiple =
    categoryMultiple !== undefined ? categoryMultiple : peers.global;
  const peerCategory = categoryMultiple !== undefined ? p.category : "global";

  const rawGrowth = typeof p.change_7d === "number" && Number.isFinite(p.change_7d)
    ? p.change_7d
    : 0;
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMultiplier = 1 + (growthPct / 100) * model.growth_weight;

  const age = ageDays(p, asOf);
  const knownAge = age ?? 365;
  const maturityMultiplier =
    model.maturity_floor +
    (1 - model.maturity_floor) *
      (Math.min(knownAge, model.maturity_days) / model.maturity_days);

  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * peerMultiple * growthMultiplier * maturityMultiplier),
  );
  return {
    implied,
    peer_multiple: round4(peerMultiple),
    peer_count: peerCount,
    peer_category: peerCategory,
    growth_pct: round4(growthPct),
    growth_multiplier: round4(growthMultiplier),
    maturity_multiplier: round4(maturityMultiplier),
    age_days: age,
  };
}

// ---------------------------------------------------------------------------
// Farm plans
// ---------------------------------------------------------------------------

interface CategoryPlan {
  action: string;
  weekly: string;
}

const CATEGORY_PLANS: Record<string, CategoryPlan> = {
  "Risk Curators": {
    action: "Deposit {capital} into a vault curated by {name} on {chain}",
    weekly: "Read the curator's reallocation notes and rebalance your deposit once a week",
  },
  RWA: {
    action: "Buy {capital} of tokenized real-world assets issued through {name} on {chain}",
    weekly: "Review the new real-world asset offerings on {name} and add a small position weekly",
  },
  Dexs: {
    action: "Swap {capital} through {name} on {chain}",
    weekly: "Swap a small amount through the {name} router each week to keep activity on it",
  },
  Lending: {
    action: "Supply {capital} to {name} on {chain} and leave it earning interest",
    weekly: "Borrow a small amount against your supply once a week, then repay it in full",
  },
  Yield: {
    action: "Stake {capital} in a {name} yield vault on {chain}",
    weekly: "Claim the vault's rewards each week and restake them into the same vault",
  },
  CDP: {
    action: "Open a collateralized debt position on {name} with {capital} of collateral on {chain}",
    weekly: "Check your collateral ratio once a week and top it up if it drifts toward liquidation",
  },
  Derivatives: {
    action: "Open a small {capital} perpetual position on {name} ({chain})",
    weekly: "Open and close one small position each week so your account stays active",
  },
  "Onchain Capital Allocator": {
    action: "Allocate {capital} to a strategy run by {name} on {chain}",
    weekly: "Read the allocator's strategy update and rebalance your allocation once a week",
  },
  "Collateral Markets": {
    action: "Post {capital} of collateral in a {name} market on {chain}",
    weekly: "Check your collateral ratio once a week and top it up if it falls",
  },
  Restaking: {
    action: "Restake {capital} through {name} on {chain}",
    weekly: "Review restaking rewards once a week and claim them when they are worth the gas",
  },
  "Prediction Market": {
    action: "Place a {capital} prediction on a live market at {name} ({chain})",
    weekly: "Place one small prediction each week and close it before the market resolves",
  },
  "Staking Pool": {
    action: "Stake {capital} in a {name} pool on {chain}",
    weekly: "Claim staking rewards weekly and restake them into the same pool",
  },
  "Liquidity Manager": {
    action: "Provide {capital} of liquidity through {name} on {chain}",
    weekly: "Rebalance your liquidity range once a week so the position keeps earning fees",
  },
  Farm: {
    action: "Farm {capital} through {name} on {chain}",
    weekly: "Harvest farm rewards each week and compound them back into the farm",
  },
  Launchpad: {
    action: "Join a {capital} allocation on {name} ({chain})",
    weekly: "Check new launches on {name} weekly and join one small allocation",
  },
  "Leveraged Farming": {
    action: "Open a {capital} leveraged farming position on {name} ({chain})",
    weekly: "Check your position's health factor once a week and deleverage if it tightens",
  },
  "Interest Rate Derivatives": {
    action: "Open a {capital} fixed-rate position on {name} ({chain})",
    weekly: "Roll or adjust your rate position once a week as rates move",
  },
  "Uncollateralized Lending": {
    action: "Lend {capital} through {name} on {chain}",
    weekly: "Review your outstanding loans once a week and collect repayments",
  },
};

const DEFAULT_PLAN: CategoryPlan = {
  action: "Use {name} on {chain} with {capital}",
  weekly: "Repeat a small qualifying action on {name} each week",
};

const GAS_COSTS: Record<string, string> = {
  Ethereum: "$8",
  Arbitrum: "$1",
  Optimism: "$1",
  Base: "$1",
  BSC: "$2",
  Solana: "$0.10",
  Polygon: "$0.20",
  Avalanche: "$1",
  Sui: "$0.10",
  Aptos: "$0.10",
  "BNB Chain": "$2",
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}

function capitalTier(tvlUsd: number): string {
  if (tvlUsd >= 5_000_000_000) return "$250";
  if (tvlUsd >= 1_000_000_000) return "$150";
  if (tvlUsd >= 100_000_000) return "$100";
  return "$50";
}

function holdDays(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

/** Six concrete steps: fresh wallet, the qualifying on-chain action,
 *  a weekly habit, the hold, the points check, and a farm log. Every
 *  step names its cost and its time, because a farm plan without a
 *  budget is a wish list. */
export function farmSteps(p: SnapshotProtocol, ageDaysValue: number | null): string[] {
  const chain = p.chains && p.chains.length > 0 ? p.chains[0] : "Ethereum";
  const capital = capitalTier(p.tvl_usd);
  const gas = GAS_COSTS[chain] ?? "$2";
  const plan = CATEGORY_PLANS[p.category] ?? DEFAULT_PLAN;
  const values = { name: p.name, chain, capital };
  const hold = holdDays(ageDaysValue);
  return [
    "Create a fresh wallet and write its seed phrase down on paper, never in a screenshot or a note app. Cost: free. Time: 5 minutes.",
    `${fill(plan.action, values)}. Cost: about ${capital} of capital plus roughly ${gas} in ${chain} gas fees. Time: 15 minutes.`,
    `${fill(plan.weekly, values)}. Cost: about ${gas} in gas each week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days; a snapshot is usually taken without warning. Cost: your ${capital} stays in the position. Time: ${hold} days.`,
    `Check ${p.name}'s official points or rewards page from its own site and claim only through links it publishes. Cost: nothing to check. Time: 10 minutes.`,
    `Keep a short farm log: date, amount, chain and transaction hash for every action above. Cost: free. Time: 5 minutes.`,
  ];
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  peer_category: string;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  mcap_usd: number;
  tvl_usd: number;
  multiple: number;
}

export interface BoardResult {
  rows: BoardRow[];
  live: LiveRow[];
  watchlistCount: number;
  earlyCount: number;
}

export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = DEFAULT_MODEL,
): BoardResult {
  const peers = peerMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);

  const candidates = snapshot.protocols.filter(
    (p) => passesLaunchRule(p) && (watchlist.has(p.slug) || p.tvl_usd < snapshot.floor_usd),
  );

  const valued = candidates.map((p) => {
    const v = impliedValue(p, snapshot.as_of, peers, model);
    return { p, v };
  });
  valued.sort((a, b) => {
    if (b.v.implied !== a.v.implied) return b.v.implied - a.v.implied;
    return a.p.slug.localeCompare(b.p.slug);
  });

  const rows: BoardRow[] = valued.map(({ p, v }, index) => ({
    rank: index + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: v.age_days,
    watchlist: watchlist.has(p.slug),
    implied_value_usd: v.implied,
    peer_multiple: v.peer_multiple,
    peer_count: v.peer_count,
    peer_category: v.peer_category,
    growth_pct: v.growth_pct,
    growth_multiplier: v.growth_multiplier,
    maturity_multiplier: v.maturity_multiplier,
    farm_steps: farmSteps(p, v.age_days),
  }));

  // Live reference: the 24 largest tokened protocols by market cap,
  // so the board can be read against what the market actually pays.
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && typeof p.mcap_usd === "number" && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      mcap_usd: p.mcap_usd as number,
      tvl_usd: p.tvl_usd,
      multiple: round4((p.mcap_usd as number) / p.tvl_usd),
    }));

  return {
    rows,
    live,
    watchlistCount: rows.filter((r) => r.watchlist).length,
    earlyCount: rows.filter((r) => !r.watchlist).length,
  };
}
