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
     * Calculates stake distribution for a given total investment amount.
     * @param {number} totalInvestment - Total amount to invest (e.g., $100).
     * @param {number} odds1 - Decimal odds for outcome 1.
     * @param {number} odds2 - Decimal odds for outcome 2.
     * @returns {Object} { stake1, stake2, riskFreeProfit, roi }
     */
    static calculateStakes(totalInvestment, odds1, odds2) {
        if (!totalInvestment || !odds1 || !odds2) return null;

        const ip1 = 1 / odds1;
        const ip2 = 1 / odds2;
        const marketMargin = ip1 + ip2;

        // Stake Allocation
        const s1 = (totalInvestment * ip1) / marketMargin;
        const s2 = (totalInvestment * ip2) / marketMargin;

        // Expected Return (should be equal for both if perfect arb)
        const return1 = s1 * odds1;
        // const return2 = s2 * odds2; // should be roughly same

        const profit = return1 - totalInvestment;

        return {
            stake1: parseFloat(s1.toFixed(2)),
            stake2: parseFloat(s2.toFixed(2)),
            totalReturn: parseFloat(return1.toFixed(2)),
            profit: parseFloat(profit.toFixed(2)),
            roi: ((profit / totalInvestment) * 100).toFixed(2) + '%'
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
        const normalize = (str) => str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        
        // Extract core name by removing common prefixes/suffixes
        const extractCoreName = (str) => {
            let s = str.toUpperCase();
            // Remove common prefixes like "G1", "T1", etc.
            s = s.replace(/^[A-Z]\d\s*/i, '');
            // Remove common suffixes
            s = s.replace(/\s*(TEAM|ESPORTS|GAMING|CLUB|PRO|CLAN|ESPORT)$/i, '');
            return s.trim();
        };
        
        // Check if two team names likely refer to the same team
        const teamsMatch = (name1, name2) => {
            const n1 = normalize(name1);
            const n2 = normalize(name2);
            
            // 1. Direct normalized match
            if (n1 === n2) return true;
            if (n1.includes(n2) || n2.includes(n1)) return true;
            
            // 2. Core name extraction (handles "GenOne" vs "G1 GenOne")
            const core1 = normalize(extractCoreName(name1));
            const core2 = normalize(extractCoreName(name2));
            if (core1 && core2 && (core1.includes(core2) || core2.includes(core1))) return true;
            
            // 3. Handle number-based names like "33 Team" vs "33 33"
            // Extract leading numbers
            const num1 = name1.match(/^\d+/)?.[0];
            const num2 = name2.match(/^\d+/)?.[0];
            if (num1 && num2 && num1 === num2) {
                // Both start with same number - likely same team
                return true;
            }
            
            // 4. Token overlap with minimum length 2 (to catch "33")
            const tokens1 = name1.toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length >= 2);
            const tokens2 = name2.toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length >= 2);
            
            const commons = ['TEAM', 'ESPORTS', 'GAMING', 'CLUB', 'PRO', 'CLAN', 'ESPORT', 'ORG'];
            const intersection = tokens1.filter(t => tokens2.includes(t));
            
            if (intersection.length > 0) {
                const meaningful = intersection.filter(t => !commons.includes(t));
                // If any meaningful token matches, or if it's a number token
                if (meaningful.length > 0) return true;
            }
            
            // 5. G1/T1 style abbreviation matching (G1 = GenOne, T1 = TeamOne)
            const abbrevMatch = (abbr, full) => {
                const a = abbr.toUpperCase();
                const f = full.toUpperCase();
                if (a.length !== 2) return false;
                const letter = a[0];
                const num = a[1];
                
                // Check if full name starts with same letter
                if (f[0] !== letter) return false;
                
                // Check if number part matches (1=ONE, 2=TWO, etc.)
                const numWords = { '1': 'ONE', '2': 'TWO', '3': 'THREE', '4': 'FOUR', '5': 'FIVE' };
                if (numWords[num] && f.includes(numWords[num])) return true;
                if (f.includes(num)) return true;
                
                return false;
            };
            
            if (name1.length === 2 && name2.length > 3) {
                if (abbrevMatch(name1, name2)) return true;
            } else if (name2.length === 2 && name1.length > 3) {
                if (abbrevMatch(name2, name1)) return true;
            }
            
            // 6. Handle prefix abbreviations (NEM = Nemesis, FORZER = FORZE)
            // e.g., "NEM Team Nemesis" vs "Team Nemesis" or "FORZER FORZE Reload" vs "FORZE Reload"
            const words1 = name1.toUpperCase().split(/\s+/).filter(w => w.length >= 2);
            const words2 = name2.toUpperCase().split(/\s+/).filter(w => w.length >= 2);
            
            // Check if one name contains all words from the other (ignoring abbreviation prefix)
            const containsAllWords = (longer, shorter) => {
                if (shorter.length === 0) return false;
                return shorter.every(word => 
                    longer.some(w => w === word || w.includes(word) || word.includes(w))
                );
            };
            
            if (words1.length > words2.length && containsAllWords(words1, words2)) return true;
            if (words2.length > words1.length && containsAllWords(words2, words1)) return true;
            
            // 7. Fuzzy prefix match - if one team name starts with abbreviation of the other
            // e.g., "NEM" starts "NEMESIS", "FORZER" ~ "FORZE"
            const fuzzyStartMatch = (short, long) => {
                if (short.length < 3 || long.length < 3) return false;
                // Check if short is prefix of long (with 1 char tolerance)
                if (long.startsWith(short.slice(0, -1))) return true;
                if (short.startsWith(long.slice(0, 3))) return true;
                return false;
            };
            
            // Compare significant tokens between names
            for (const t1 of tokens1) {
                if (commons.includes(t1)) continue;
                for (const t2 of tokens2) {
                    if (commons.includes(t2)) continue;
                    if (fuzzyStartMatch(t1, t2) || fuzzyStartMatch(t2, t1)) return true;
                }
            }
            
            return false;
        };

        const findOdds = (list, name) => {
            if (strictMatch) {
                return list.find(x => x.team === name);
            } else {
                return list.find(x => teamsMatch(name, x.team));
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
