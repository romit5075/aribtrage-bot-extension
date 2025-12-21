// Core Arbitrage Logic & Logging
// separated into a module/file as requested by "make a new file for this"

class ArbitrageCalculator {
    /**
     * Calculates arbitrage opportunity between two odds.
     * @param {number} odds1 - Decimal odds from site A
     * @param {number} odds2 - Decimal odds from site B
     * @returns {Object} { isArb, profit, roi }
     */
    static calculate(odds1, odds2) {
        if (!odds1 || !odds2) return { isArb: false, profit: 0 };
        const ip1 = 1 / odds1;
        const ip2 = 1 / odds2;
        const totalIp = ip1 + ip2;
        const roi = ((1 / totalIp) - 1) * 100;

        return {
            isArb: roi > 0,
            profit: roi,
            roi: roi.toFixed(2)
        };
    }

    /**
     * Scans for arbitrage between two datasets (Poly vs Stake/Stack)
     * @param {Array} polyData - Array of objects { team, odds, ... }
     * @param {Array} stackData - Array of objects { team, odds, ... }
     * @param {boolean} strictMatch - If true, requires exact name match.
     * @returns {Array} List of opportunities
     */
    static findOpportunities(polyData, stackData, strictMatch = false) {
        const opportunities = [];

        // Helper to find team in list
        const findOdds = (list, name) => {
            if (strictMatch) {
                return list.find(x => x.team === name);
            } else {
                // Relaxed Match: Includes check
                const n1 = name.toUpperCase();
                return list.find(x => {
                    const n2 = x.team.toUpperCase();
                    return n1.includes(n2) || n2.includes(n1);
                });
            }
        };

        // Iterate Poly items in pairs (assuming HOU, DEN format)
        for (let i = 0; i < polyData.length - 1; i += 2) {
            const home = polyData[i];
            const away = polyData[i + 1];

            const stakeHome = findOdds(stackData, home.team);
            const stakeAway = findOdds(stackData, away.team);

            if (stakeHome && stakeAway) {
                // Arb 1: Poly Home vs Stake Away
                const arb1 = this.calculate(home.odds, stakeAway.odds);
                if (arb1.isArb) {
                    opportunities.push({
                        match: `${home.team} vs ${away.team}`,
                        betOn: `${home.team} (Poly) / ${away.team} (Stack)`,
                        odds: [home.odds, stakeAway.odds],
                        profit: arb1.profit,
                        type: 'High Value'
                    });
                }

                // Arb 2: Poly Away vs Stake Home
                const arb2 = this.calculate(away.odds, stakeHome.odds);
                if (arb2.isArb) {
                    opportunities.push({
                        match: `${home.team} vs ${away.team}`,
                        betOn: `${away.team} (Poly) / ${home.team} (Stack)`,
                        odds: [away.odds, stakeHome.odds],
                        profit: arb2.profit,
                        type: 'High Value'
                    });
                }
            }
        }
        return opportunities;
    }
}

// Simple Logger "File"
const ArbitrageLogger = {
    logPositive(opportunity) {
        chrome.storage.local.get(['arbHistory'], (result) => {
            const history = result.arbHistory || [];

            const entry = {
                timestamp: new Date().toISOString(),
                ...opportunity
            };

            // Prepend new entry
            history.unshift(entry);

            // Limit history to last 50
            if (history.length > 50) history.pop();

            chrome.storage.local.set({ arbHistory: history });
        });
    }
};

// Export for usage in Background (via importScripts or copy-paste if modules not supported in SW easily without configuration)
// Since we are continuously monitoring, we'll keep this simple.
// Note: In MV3 Service Worker, we use `importScripts`.
