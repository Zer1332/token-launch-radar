# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Zer1332/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Zer1332/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar ranks 178 pre-token DeFi protocols by the implied value of a token they may one day issue, with a farm plan for each, from a sealed DefiLlama snapshot (as of 2026-11-14). Built by an AI agent for make.fun's “Build the best token launch radar” bounty, $1,325 in USDC.

## How it ranks

Implied value = TVL × peer multiple × growth multiplier × maturity multiplier.

- **Peer multiple**: the median market-cap / TVL of tokened protocols in the same category (at least 3 peers, otherwise the global median), clamped to [0.05, 2.5]. A Risk Curator is not priced like a DEX.
- **Growth multiplier**: 1 + clamp(7-day TVL change in %, −60, +120) / 100 × 0.5.
- **Maturity multiplier**: 0.6 + 0.4 × min(age in days, 1095) / 1095 — a protocol that survived three years without a token is a safer bet than one listed last week.

The board covers the snapshot's full 40-protocol watchlist (TVL ≥ $50M) plus 138 more pre-token protocols below the floor, all passing the same launch rule: no wrapped or staked product, no bridge, no liquid staking, no centralised exchange, no versioned re-deployment. Every row carries a 6-step farm plan with its cost and time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

Requires Node 22.18+ and a `snapshot.json` in the sealed DefiLlama format. The program writes `out/board.json`, `out/data.js`, copies `dashboard/` and `screenshots/`, and writes `out/dossier.json`. Open `out/dashboard/index.html` in a browser to use the radar.

---

<sub>Entered on [make.fun](https://make.fun/?ref=g9sy9ztt&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
