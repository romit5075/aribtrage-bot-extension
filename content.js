// Inject CSS for team highlighting
(function injectHighlightStyles() {
    if (document.getElementById('arb-highlight-styles')) return;
    const style = document.createElement('style');
    style.id = 'arb-highlight-styles';
    style.textContent = `
        [data-arb-highlight="team1"] {
            border: 3px solid #9b59b6 !important;
            box-shadow: 0 0 15px rgba(155, 89, 182, 0.6), 0 0 25px rgba(155, 89, 182, 0.4) !important;
            background-color: rgba(155, 89, 182, 0.1) !important;
            transition: all 0.3s ease !important;
        }
        [data-arb-highlight="team2"] {
            border: 3px solid #e91e63 !important;
            box-shadow: 0 0 15px rgba(233, 30, 99, 0.6), 0 0 25px rgba(233, 30, 99, 0.4) !important;
            background-color: rgba(233, 30, 99, 0.1) !important;
            transition: all 0.3s ease !important;
        }
        [data-arb-highlight="arb1"] {
            border: 3px solid #9b59b6 !important;
            box-shadow: 0 0 15px rgba(0, 230, 118, 0.8), 0 0 30px rgba(0, 230, 118, 0.5) !important;
            background-color: rgba(155, 89, 182, 0.15) !important;
            animation: arbPulse 1.5s ease-in-out infinite !important;
        }
        [data-arb-highlight="arb2"] {
            border: 3px solid #e91e63 !important;
            box-shadow: 0 0 15px rgba(0, 230, 118, 0.8), 0 0 30px rgba(0, 230, 118, 0.5) !important;
            background-color: rgba(233, 30, 99, 0.15) !important;
            animation: arbPulse 1.5s ease-in-out infinite !important;
        }
        @keyframes arbPulse {
            0%, 100% { box-shadow: 0 0 15px rgba(0, 230, 118, 0.8), 0 0 30px rgba(0, 230, 118, 0.5); }
            50% { box-shadow: 0 0 25px rgba(0, 230, 118, 1), 0 0 45px rgba(0, 230, 118, 0.7); }
        }
    `;
    document.head.appendChild(style);
})();

// Expose to window
window.scrapePageData = scrapePageData;

// --- ROBUST SCRAPER (Ported from Background) ---
function scrapePageData() {
    const data = { type: 'unknown', odds: [] };

    const parsePolyOdds = (str) => {
        if (!str) return null;
        if (str.toLowerCase().includes('suspended')) return 'Suspended';

        // 1. Try Cents (e.g. 78¢)
        const matchCents = str.match(/(\d+)\s*¢/);
        if (matchCents) {
            const cents = parseInt(matchCents[1], 10);
            return cents > 0 ? (100 / cents).toFixed(2) : null;
        }

        // 2. Try Decimal (e.g. 1.28)
        // Look for typical decimal odds format: digit(s) dot digit(s)
        const matchDecimal = str.match(/(\d+\.\d{2})/);
        if (matchDecimal) {
            return parseFloat(matchDecimal[1]);
        }

        return null;
    };

    const parseStakeOdds = (str) => {
        if (!str) return null;
        if (str.toLowerCase().includes('suspended') || str.toLowerCase().includes('unavailable')) return 'Suspended';
        const match = str.match(/(\d+(\.\d+)?)/);
        return match ? parseFloat(match[1]) : null;
    };

    // Time Parser
    const parseTime = (dateStr, timeStr) => {
        try {
            // Normalize to "Dec 22 2:00 AM" or similar key
            const dBase = dateStr.replace(/^[A-Za-z]+, /, '').replace('December', 'Dec').trim();
            return `${dBase} ${timeStr}`;
        } catch (e) { return null; }
    };

    // 1. Polymarket Scraper
    const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
    if (polyButtons.length > 0) {
        data.type = 'polymarket';
        polyButtons.forEach(btn => {
            let team = 'UNKNOWN';
            const teamNode = btn.querySelector('.opacity-70');
            if (teamNode) {
                team = teamNode.textContent.trim().toUpperCase();
            } else {
                const txt = btn.textContent.trim();
                const match = txt.match(/^([A-Z]{3})/);
                if (match) team = match[1];

                // Improved Name Extraction (Same as popup fallback)
                // Fix for "33 33" -> "33"
                if (team === 'UNKNOWN' || team.length <= 4) {
                    const linkEl = btn.closest('a');
                    if (linkEl) {
                        const fullText = linkEl.textContent.trim().toUpperCase();
                        let btnText = btn.textContent.trim().toUpperCase();

                        // If btnText is "33 79¢ 1.27", we only want to remove odds
                        // Clean fullText: "33 33" -> we want "33"
                        // Or if page says "33 33", it's the name twice?

                        let cleanName = fullText.replace(btnText, '').trim();
                        // Remove odds if leaked
                        cleanName = cleanName.replace(/\d+\s*¢/g, '').replace(/(\d+\.\d{2})/g, '').trim();

                        // Special case for repeated numeric names "33 33"
                        const tokens = cleanName.split(' ');
                        if (tokens.length === 2 && tokens[0] === tokens[1]) {
                            cleanName = tokens[0];
                        }

                        if (cleanName.length >= 1) { // Allow short names like "33"
                            team = cleanName;
                        }
                    }
                }
            }

            const clone = btn.cloneNode(true);
            const tags = clone.querySelectorAll('.odds-converted-tag');
            tags.forEach(t => t.remove());
            const teamEl = clone.querySelector('.opacity-70');
            if (teamEl) teamEl.remove();

            const rawText = clone.textContent.trim();
            const odds = parsePolyOdds(rawText);

            // Get Link
            const linkEl = btn.closest('a');
            const link = linkEl ? linkEl.href : window.location.href;

            if (team !== 'UNKNOWN' && odds) {
                data.odds.push({
                    team,
                    odds: odds === 'Suspended' ? 'Suspended' : parseFloat(odds),
                    source: 'Poly',
                    link: link,
                    id: btn.id // Capture ID
                });
            }
        });
    }

    // 2. Stake/SX Scraper
    if (data.odds.length === 0) {
        const stackItems = document.querySelectorAll('.outcome-content');
        if (stackItems.length > 0) {
            data.type = 'stack';
            stackItems.forEach(item => {
                const nameEl = item.querySelector('[data-testid="outcome-button-name"]');
                const oddsContainer = item.querySelector('[data-testid="fixture-odds"]');

                const team = nameEl ? nameEl.textContent.trim().toUpperCase() : 'UNKNOWN';
                let odds = null;

                if (oddsContainer) {
                    odds = parseStakeOdds(oddsContainer.textContent);
                } else {
                    const btn = item.closest('button');
                    if (btn && btn.disabled) odds = 'Suspended';
                }

                // Time Extraction
                const fixture = item.closest('[data-testid="fixture-preview"]');
                let timeKey = null;
                if (fixture) {
                    const fixtureDetails = fixture.querySelector('.fixture-details');
                    if (fixtureDetails) {
                        timeKey = fixtureDetails.textContent.trim();
                    }
                }

                // Get Link
                const linkEl = item.closest('a');
                const link = linkEl ? linkEl.href : window.location.href;

                if (team !== 'UNKNOWN' && odds) {
                    const finalOdds = (odds === 'Suspended') ? 'Suspended' : parseFloat(odds);
                    if (finalOdds === 'Suspended' || !isNaN(finalOdds)) {
                        data.odds.push({
                            team,
                            odds: finalOdds,
                            source: 'Stack',
                            time: timeKey,
                            link: link
                        });
                    }
                }
            });


            // Auto Click Load More (Throttle check?)
            // Only click if we are NOT in a tight loop. For Live Monitor, maybe avoid spam clicking?
            // Let's allow it but maybe careful.
            const buttons = Array.from(document.querySelectorAll('button, div[role="button"], div.contents'));
            const loadMore = buttons.find(b => b.textContent.trim().toLowerCase() === 'load more');
            if (loadMore) {
                // console.log("Live: Auto-clicking Load More...");
                // loadMore.click(); 
                // Allow it for now, observer will re-trigger
            }
        }
    }

    // Auto-highlight team buttons on scrape
    autoHighlightTeams(data);

    return data;
}

// Clear all highlights including data attributes and inline styles
let highlightEnabled = true; // Global flag for highlight state

function clearAllHighlights() {
    console.log('[Auto] Clearing all highlights...');

    // Remove data-arb-highlight attributes
    document.querySelectorAll('[data-arb-highlight]').forEach(el => {
        el.removeAttribute('data-arb-highlight');
        // Also remove any stored outline
        if (el.dataset.origOutline !== undefined) {
            el.style.outline = el.dataset.origOutline || '';
            delete el.dataset.origOutline;
        }
    });

    // Remove inline highlight styles from inputs
    document.querySelectorAll('input').forEach(input => {
        if (input.dataset.originalBorder !== undefined) {
            input.style.border = input.dataset.originalBorder || '';
            input.style.boxShadow = input.dataset.originalBoxShadow || '';
            delete input.dataset.originalBorder;
            delete input.dataset.originalBoxShadow;
        }
        // Also clear green/pink borders we added
        if (input.style.border && (input.style.border.includes('rgb(0, 230, 118)') || input.style.border.includes('#00e676'))) {
            input.style.border = '';
            input.style.boxShadow = '';
        }
    });

    // Remove inline highlight styles from buttons
    document.querySelectorAll('button').forEach(btn => {
        if (btn.style.border && (
            btn.style.border.includes('rgb(0, 230, 118)') ||
            btn.style.border.includes('#00e676') ||
            btn.style.border.includes('rgb(233, 30, 99)') ||
            btn.style.border.includes('#e91e63')
        )) {
            btn.style.border = '';
            btn.style.boxShadow = '';
            btn.style.transform = '';
        }
    });

    console.log('[Auto] All highlights cleared');
}

// Auto-highlight function to visually mark team buttons
function autoHighlightTeams(data) {
    // Skip if highlighting is disabled
    if (!highlightEnabled) return;

    if (!data || !data.odds || data.odds.length < 2) return;

    // Remove old highlights
    document.querySelectorAll('[data-arb-highlight]').forEach(el => {
        el.removeAttribute('data-arb-highlight');
    });

    if (data.type === 'stack') {
        const stackItems = document.querySelectorAll('.outcome-content');
        stackItems.forEach((item, index) => {
            const container = item.closest('button');
            if (container) {
                container.setAttribute('data-arb-highlight', index === 0 ? 'team1' : 'team2');
            }
        });
    } else if (data.type === 'polymarket') {
        const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
        polyButtons.forEach((btn, index) => {
            btn.setAttribute('data-arb-highlight', index === 0 ? 'team1' : 'team2');
        });
    }
}

// --- Live Monitoring (Ultra Low Latency with Smart Change Detection) ---
let liveObserver = null;
let liveRafId = null;
let isScanPending = false;
let lastOddsSnapshot = null; // Cache to detect actual changes
let liveDebounceTimer = null;

// Helper to create a snapshot of current odds for comparison
function createOddsSnapshot(data) {
    if (!data || !data.odds) return '';
    return data.odds.map(o => `${o.team}:${o.odds}`).sort().join('|');
}

function startLiveMonitoring() {
    stopLiveMonitoring(); // reset
    console.log("Starting Real-Time Monitoring (Targeted Observer)...");

    const pushUpdate = (force = false) => {
        isScanPending = false;
        const data = scrapePageData();

        if (data.odds.length > 0) {
            const newSnapshot = createOddsSnapshot(data);

            // Only send update if odds actually changed OR force update
            if (force || newSnapshot !== lastOddsSnapshot) {
                lastOddsSnapshot = newSnapshot;
                console.log("[Live] Odds changed, pushing update:", data.odds.length, "items");
                try {
                    chrome.runtime.sendMessage({ action: "live_data_update", data: data }, (response) => {
                        if (chrome.runtime.lastError) { }
                    });
                } catch (err) {
                    stopLiveMonitoring();
                }
            }
        }
    };

    // Initial Push (force)
    pushUpdate(true);

    // Debounced update function - much faster than rAF
    const scheduleUpdate = () => {
        if (liveDebounceTimer) {
            clearTimeout(liveDebounceTimer);
        }
        // 50ms debounce - fast enough to feel instant, slow enough to batch rapid changes
        liveDebounceTimer = setTimeout(() => {
            pushUpdate(false);
        }, 50);
    };

    // Create targeted observers for specific odds containers
    liveObserver = new MutationObserver((mutations) => {
        let hasRelevantChange = false;

        for (const mutation of mutations) {
            // Check if mutation is relevant to odds display
            const target = mutation.target;

            // Check for Stake odds changes
            if (target.matches && (
                target.matches('[data-testid="fixture-odds"]') ||
                target.matches('[data-testid="outcome-button-name"]') ||
                target.closest('[data-testid="fixture-odds"]') ||
                target.closest('.outcome-content')
            )) {
                hasRelevantChange = true;
                break;
            }

            // Check for Polymarket odds changes
            if (target.matches && (
                target.matches('.trading-button') ||
                target.matches('button[class*="trading-button"]') ||
                target.closest('.trading-button') ||
                target.closest('button[class*="trading-button"]')
            )) {
                hasRelevantChange = true;
                break;
            }

            // Check text content changes for odds patterns
            if (mutation.type === 'characterData') {
                const text = target.textContent || '';
                // Check if text contains odds-like patterns
                if (/\d+\s*¢/.test(text) || /^\d+\.\d{2}$/.test(text.trim())) {
                    hasRelevantChange = true;
                    break;
                }
            }

            // Check added nodes for odds elements
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.querySelector && (
                            node.querySelector('[data-testid="fixture-odds"]') ||
                            node.querySelector('.outcome-content') ||
                            node.querySelector('.trading-button') ||
                            node.matches('[data-testid="fixture-odds"]') ||
                            node.matches('.outcome-content')
                        )) {
                            hasRelevantChange = true;
                            break;
                        }
                    }
                    // Text node with odds
                    if (node.nodeType === Node.TEXT_NODE) {
                        const text = node.textContent || '';
                        if (/\d+\s*¢/.test(text) || /^\d+\.\d{2}$/.test(text.trim())) {
                            hasRelevantChange = true;
                            break;
                        }
                    }
                }
            }

            if (hasRelevantChange) break;
        }

        if (hasRelevantChange) {
            scheduleUpdate();
        }
    });

    // Observe with optimized settings
    liveObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'data-testid', 'disabled'], // Only watch relevant attributes
        characterData: true,
        characterDataOldValue: false
    });

    // Also set up a polling fallback for sites that update via Canvas/WebGL or complex frameworks
    // This runs every 2 seconds as a safety net, but only sends if data actually changed
    setInterval(() => {
        if (!isScanPending) {
            pushUpdate(false);
        }
    }, 2000);
}

function stopLiveMonitoring() {
    if (liveObserver) {
        liveObserver.disconnect();
        liveObserver = null;
    }
    if (liveRafId) {
        cancelAnimationFrame(liveRafId);
        liveRafId = null;
    }
    if (liveDebounceTimer) {
        clearTimeout(liveDebounceTimer);
        liveDebounceTimer = null;
    }
    isScanPending = false;
    lastOddsSnapshot = null;
}

// Handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrape_odds") {
        sendResponse(scrapePageData());
    }
    if (request.action === "toggleState") {
        if (request.isEnabled) {
            runConverter();
            startObserver();
        } else {
            removeConversions();
            stopObserver();
            // Clear all highlights including inline styles
            clearAllHighlights();
        }
    }
    if (request.action === "toggleLive") {
        if (request.enabled) startLiveMonitoring();
        else stopLiveMonitoring();
    }

    // Toggle Highlight on/off
    if (request.action === "toggleHighlight") {
        highlightEnabled = request.enabled;
        if (!highlightEnabled) {
            clearAllHighlights();
        }
        sendResponse({ success: true });
    }

    // Clear all highlights on request
    if (request.action === "clear_highlights") {
        clearAllHighlights();
        sendResponse({ success: true });
    }

    // ... highlight handler below ...
    if (request.action === "highlight_odds") {
        // Skip if highlighting is disabled
        if (!highlightEnabled) {
            sendResponse({ success: false, reason: 'highlighting disabled' });
            return;
        }

        const targets = request.targets || []; // Array of { team, type, teamIndex, isArb } 
        // type: 'polymarket' or 'stack'
        // teamIndex: 0 = Team 1 (Pink), 1 = Team 2 (Orange)
        // isArb: if true, use green glow animation

        // Remove old highlights first
        document.querySelectorAll('[data-arb-highlight]').forEach(el => {
            el.removeAttribute('data-arb-highlight');
        });

        // Highlight new targets using CSS classes
        targets.forEach(tgt => {
            const highlightClass = tgt.isArb
                ? (tgt.teamIndex === 0 ? 'arb1' : 'arb2')  // Arb with green glow
                : (tgt.teamIndex === 0 ? 'team1' : 'team2'); // Regular team colors

            // Logic to find and highlight in DOM
            if (tgt.type === 'stack') {
                const stackItems = document.querySelectorAll('.outcome-content');
                stackItems.forEach(item => {
                    const nameEl = item.querySelector('[data-testid="outcome-button-name"]');
                    if (nameEl) {
                        const teamName = nameEl.textContent.trim().toUpperCase();
                        // Simple includes match
                        if (teamName.includes(tgt.team) || tgt.team.includes(teamName)) {
                            const container = item.closest('button');
                            if (container) {
                                container.setAttribute('data-arb-highlight', highlightClass);
                            }
                        }
                    }
                });
            } else if (tgt.type === 'polymarket') {
                const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
                polyButtons.forEach(btn => {
                    const txt = btn.textContent.trim().toUpperCase();
                    if (txt.includes(tgt.team)) {
                        btn.setAttribute('data-arb-highlight', highlightClass);
                    }
                });
            }
        });
    }

    // Auto-highlight teams when arb data is received (for live updates)
    if (request.action === "highlight_arb_teams") {
        // Skip if highlighting is disabled
        if (!highlightEnabled) return;

        const arbData = request.arbData; // { team1, team2, isArb }
        if (!arbData) return;

        // Remove old highlights
        document.querySelectorAll('[data-arb-highlight]').forEach(el => {
            el.removeAttribute('data-arb-highlight');
        });

        // Detect page type and highlight using CSS classes
        const isStake = document.querySelector('.outcome-content');
        const isPoly = document.querySelector('button.trading-button, button[class*="trading-button"]');

        if (isStake) {
            const stackItems = document.querySelectorAll('.outcome-content');
            stackItems.forEach((item, index) => {
                const container = item.closest('button');
                if (container) {
                    const highlightClass = arbData.isArb
                        ? (index === 0 ? 'arb1' : 'arb2')
                        : (index === 0 ? 'team1' : 'team2');
                    container.setAttribute('data-arb-highlight', highlightClass);
                }
            });
        }

        if (isPoly) {
            const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
            polyButtons.forEach((btn, index) => {
                const highlightClass = arbData.isArb
                    ? (index === 0 ? 'arb1' : 'arb2')
                    : (index === 0 ? 'team1' : 'team2');
                btn.setAttribute('data-arb-highlight', highlightClass);
            });
        }
    }

    if (request.action === "click_bet_button") {
        sendResponse({ status: "received" });

        const targetTeam = request.team ? request.team.toUpperCase() : null;
        const targetId = request.id;
        const expectedOdds = parseFloat(request.expectedOdds); // The decimal odds we want
        const retryLimit = request.retryLimit || 10; // More retries for slower pages
        const tolerance = 0.15; // Slightly larger tolerance for odds drift

        console.log(`[Auto] ========== CLICK BET BUTTON ==========`);
        console.log(`[Auto] Target Team: ${targetTeam}`);
        console.log(`[Auto] Target ID: ${targetId}`);
        console.log(`[Auto] Expected Odds: ${expectedOdds}`);
        console.log(`[Auto] Amount: ${request.amount}`);

        // Fuzzy team name matching helper
        const fuzzyMatch = (searchTerm, buttonText) => {
            if (!searchTerm || !buttonText) return false;
            const s = searchTerm.toUpperCase().trim();
            const b = buttonText.toUpperCase().trim();

            // Exact match
            if (b === s) return true;

            // Button text contains search term
            if (b.includes(s)) return true;

            // Search term contains button text (for short names like "CLE")
            if (s.includes(b.split(' ')[0]) && b.split(' ')[0].length >= 2) return true;

            // First 3 chars match (team abbreviations)
            if (s.length >= 3 && b.substring(0, 3) === s.substring(0, 3)) return true;

            // Extract first word from button text and compare
            const firstWord = b.split(/[\s\d¢]+/)[0];
            if (firstWord && firstWord.length >= 2 && (s.includes(firstWord) || firstWord.includes(s))) return true;

            // NBA team abbrev matching (e.g., "CLEV" matches "CLE", "NYK" matches "NEW YORK")
            const nbaAbbrevs = {
                'CLE': ['CLEV', 'CLEVELAND', 'CAVALIERS', 'CAVS'],
                'NYK': ['NEW YORK', 'KNICKS', 'NY'],
                'LAL': ['LOS ANGELES', 'LAKERS', 'LA LAKERS'],
                'GSW': ['GOLDEN STATE', 'WARRIORS', 'GS'],
                'BOS': ['BOSTON', 'CELTICS'],
                'MIA': ['MIAMI', 'HEAT'],
                'CHI': ['CHICAGO', 'BULLS'],
                'PHX': ['PHOENIX', 'SUNS'],
                'DEN': ['DENVER', 'NUGGETS'],
                'MIL': ['MILWAUKEE', 'BUCKS'],
                'PHI': ['PHILADELPHIA', 'SIXERS', '76ERS'],
                'DAL': ['DALLAS', 'MAVERICKS', 'MAVS'],
                'SAS': ['SAN ANTONIO', 'SPURS'],
                'OKC': ['OKLAHOMA', 'THUNDER'],
                'MEM': ['MEMPHIS', 'GRIZZLIES'],
                'NOP': ['NEW ORLEANS', 'PELICANS'],
                'MIN': ['MINNESOTA', 'TIMBERWOLVES', 'WOLVES'],
                'SAC': ['SACRAMENTO', 'KINGS'],
                'POR': ['PORTLAND', 'BLAZERS', 'TRAIL BLAZERS'],
                'IND': ['INDIANA', 'PACERS'],
                'ATL': ['ATLANTA', 'HAWKS'],
                'TOR': ['TORONTO', 'RAPTORS'],
                'BKN': ['BROOKLYN', 'NETS'],
                'CHA': ['CHARLOTTE', 'HORNETS'],
                'DET': ['DETROIT', 'PISTONS'],
                'ORL': ['ORLANDO', 'MAGIC'],
                'WAS': ['WASHINGTON', 'WIZARDS'],
                'UTA': ['UTAH', 'JAZZ'],
                'LAC': ['LA CLIPPERS', 'CLIPPERS'],
                'HOU': ['HOUSTON', 'ROCKETS']
            };

            // Check if search term or button text is a known abbreviation
            for (const [abbrev, aliases] of Object.entries(nbaAbbrevs)) {
                if (s === abbrev || s.includes(abbrev)) {
                    for (const alias of aliases) {
                        if (b.includes(alias)) return true;
                    }
                }
                if (aliases.some(a => s.includes(a))) {
                    if (b.includes(abbrev) || aliases.some(a => b.includes(a))) return true;
                }
            }

            return false;
        };

        // Helper to extract numeric odds from text
        const parseOddsFromText = (text) => {
            // Polymarket: "59¢" -> 1.69
            const cents = text.match(/(\d+)\s*¢/);
            if (cents) return parseFloat((100 / parseInt(cents[1])).toFixed(2));
            // Decimal odds: "2.86" or "CLE 2.86"
            const dec = text.match(/(\d+\.\d+)/);
            if (dec) return parseFloat(dec[1]);
            return null;
        };

        // --- STAKE CLEAR LOGIC ---
        const clearStakeBets = (callback) => {
            console.log(`[Auto] Checking for Clear Bets button...`);
            const clearBtn = document.querySelector('button[data-testid="reset-betslip"]');

            if (clearBtn) {
                console.log(`[Auto] Clearing previous bets...`);
                // Robust click on clear button
                clearBtn.click();

                // Also pointer events just in case
                const rect = clearBtn.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;

                clearBtn.dispatchEvent(new PointerEvent('pointerdown', {
                    bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY, pointerId: 1, pointerType: 'mouse', isPrimary: true
                }));
                clearBtn.dispatchEvent(new PointerEvent('pointerup', {
                    bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY, pointerId: 1, pointerType: 'mouse', isPrimary: true
                }));
                clearBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY }));

                // Wait a bit for clearing to happen
                setTimeout(() => {
                    console.log(`[Auto] Bets cleared.`);
                    if (callback) callback();
                }, 400);
            } else {
                console.log(`[Auto] "Clear Bets" button not found (Slip might be empty). Proceeding...`);
                if (callback) callback();
            }
        };

        const checkAndClick = (attempts = 0) => {
            // Special initialization for Stake: Clear bets on first attempt
            if (attempts === 0) {
                // Determine if we are on Stake (via URL or element check)
                const isStake = document.querySelector('.outcome-content') || window.location.hostname.includes('stake');
                if (isStake) {
                    clearStakeBets(() => {
                        proceedWithCheck(attempts);
                    });
                    return;
                }
            }
            proceedWithCheck(attempts);
        };

        const proceedWithCheck = (attempts) => {
            if (attempts >= retryLimit) {
                console.warn(`[Auto] Max retries (${retryLimit}) reached.`);
                chrome.runtime.sendMessage({
                    action: "bet_error",
                    error: `Element not found or odds mismatch after ${retryLimit} retries`,
                    team: targetTeam
                });
                return;
            }

            let found = false;
            console.log(`[Auto] Attempt ${attempts + 1}/${retryLimit}`);

            // --- POLYMARKET CHECK ---
            // Try multiple selector patterns
            const polySelectors = [
                'button.trading-button',
                'button[class*="trading-button"]',
                'button[data-color="custom"]',
                'button[class*="c-"]' // Polymarket uses dynamic class names
            ];

            let polyButtons = [];
            for (const sel of polySelectors) {
                const btns = document.querySelectorAll(sel);
                if (btns.length > 0) {
                    polyButtons = btns;
                    console.log(`[Auto] Found ${btns.length} buttons with selector: ${sel}`);
                    break;
                }
            }

            // Also check for the specific buy panel buttons
            const buyPanelButtons = document.querySelectorAll('button[class*="bg-"]');
            console.log(`[Auto] Found ${buyPanelButtons.length} bg-* buttons`);

            // Log all potential buttons for debugging
            const allButtons = document.querySelectorAll('button');
            console.log(`[Auto] Total buttons on page: ${allButtons.length}`);

            if (!found && polyButtons.length > 0) {
                for (const btn of polyButtons) {
                    const txt = btn.textContent.trim().toUpperCase();
                    console.log(`[Auto] Checking Poly button: "${txt}"`);

                    // Match Team using fuzzy matching
                    let isMatch = false;
                    if (targetId && btn.id === targetId) {
                        isMatch = true;
                        console.log(`[Auto] Matched by ID: ${targetId}`);
                    } else if (targetTeam && fuzzyMatch(targetTeam, txt)) {
                        isMatch = true;
                        console.log(`[Auto] Fuzzy matched: ${targetTeam} ~ ${txt}`);
                    }

                    // Also check the parent link element for team name
                    if (!isMatch && targetTeam) {
                        const linkEl = btn.closest('a');
                        if (linkEl) {
                            const linkText = linkEl.textContent.trim().toUpperCase();
                            if (fuzzyMatch(targetTeam, linkText)) {
                                isMatch = true;
                                console.log(`[Auto] Fuzzy matched via parent link: ${targetTeam} ~ ${linkText}`);
                            }
                        }
                    }

                    if (isMatch) {
                        console.log(`[Auto] MATCH found for ${targetTeam} in button: "${txt}"`);

                        // Match Odds
                        const currentOdds = parseOddsFromText(txt);
                        console.log(`[Auto] Parsed odds from button: ${currentOdds}`);

                        if (currentOdds && expectedOdds) {
                            const diff = Math.abs(currentOdds - expectedOdds);
                            console.log(`[Auto] Odds diff: ${diff} (tolerance: ${tolerance})`);
                            if (diff > tolerance) {
                                console.log(`[Auto] Poly Odds mismatch. Saw ${currentOdds}, Want ${expectedOdds}. Retrying...`);
                                setTimeout(() => checkAndClick(attempts + 1), 500);
                                return;
                            }
                        }

                        // Found & Valid!
                        console.log("[Auto] ✓ Poly Match Found. Clicking...");
                        robustClick(btn);
                        fillPolySlip(request.amount);
                        found = true;
                        break;
                    }
                }
            }

            // --- STAKE CHECK ---
            if (!found) {
                const stackItems = document.querySelectorAll('.outcome-content');
                console.log(`[Auto] Found ${stackItems.length} Stake outcome items`);

                for (const item of stackItems) {
                    const nameEl = item.querySelector('[data-testid="outcome-button-name"]');
                    if (nameEl) {
                        const team = nameEl.textContent.trim().toUpperCase();
                        console.log(`[Auto] Checking Stake team: "${team}"`);

                        // Use fuzzy matching for Stake as well
                        if (fuzzyMatch(targetTeam, team)) {
                            console.log(`[Auto] Fuzzy matched Stake: ${targetTeam} ~ ${team}`);
                            const oddsContainer = item.querySelector('[data-testid="fixture-odds"]');
                            let currentOdds = null;
                            if (oddsContainer) currentOdds = parseOddsFromText(oddsContainer.textContent);

                            if (currentOdds && expectedOdds) {
                                if (Math.abs(currentOdds - expectedOdds) > tolerance) {
                                    console.log(`[Auto] Stake Odds mismatch. Saw ${currentOdds}, Want ${expectedOdds}. Retrying...`);
                                    setTimeout(() => checkAndClick(attempts + 1), 500);
                                    return;
                                }
                            }

                            console.log("[Auto] ✓ Stake Match Found. Clicking...");
                            const btn = item.closest('button');
                            if (btn) {
                                btn.scrollIntoView({ block: 'center' });
                                robustClick(btn);
                            } else {
                                // Fallback: click the item itself
                                item.scrollIntoView({ block: 'center' });
                                robustClick(item);
                            }
                            fillStakeSlip(request.amount);
                            found = true;
                            break;
                        }
                    }
                }
            }

            if (!found) {
                // Not found yet - retry with delay
                console.log(`[Auto] Not found yet, retrying in 500ms...`);
                setTimeout(() => checkAndClick(attempts + 1), 500);
            }
        };

        const robustClick = (el) => {
            console.log(`[Auto] robustClick called on:`, el);
            console.log(`[Auto] Element text: "${el.textContent.trim().substring(0, 50)}"`);

            // Ensure element is visible
            el.scrollIntoView({ behavior: 'auto', block: 'center' });

            // Get element position
            const rect = el.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            console.log(`[Auto] Element position: (${centerX}, ${centerY})`);

            // Visual feedback
            el.style.border = "4px solid #00e676";
            el.style.boxShadow = "0 0 20px rgba(0, 230, 118, 0.8)";

            // Helper function to perform all click methods
            const performClick = () => {
                // Focus first
                if (el.focus) el.focus();

                // Direct click
                el.click();

                // Pointer events
                el.dispatchEvent(new PointerEvent('pointerdown', {
                    bubbles: true, cancelable: true, view: window,
                    clientX: centerX, clientY: centerY, pointerId: 1,
                    pointerType: 'mouse', isPrimary: true
                }));
                el.dispatchEvent(new PointerEvent('pointerup', {
                    bubbles: true, cancelable: true, view: window,
                    clientX: centerX, clientY: centerY, pointerId: 1,
                    pointerType: 'mouse', isPrimary: true
                }));

                // Mouse events
                el.dispatchEvent(new MouseEvent('mousedown', {
                    bubbles: true, cancelable: true, view: window,
                    clientX: centerX, clientY: centerY, button: 0
                }));
                el.dispatchEvent(new MouseEvent('mouseup', {
                    bubbles: true, cancelable: true, view: window,
                    clientX: centerX, clientY: centerY, button: 0
                }));
                el.dispatchEvent(new MouseEvent('click', {
                    bubbles: true, cancelable: true, view: window,
                    clientX: centerX, clientY: centerY, button: 0
                }));
            };

            // Click 1: Immediate
            console.log(`[Auto] Click attempt 1`);
            performClick();

            // Click 2: After 100ms
            setTimeout(() => {
                console.log(`[Auto] Click attempt 2`);
                performClick();

                // Also try clicking the parent span wrapper (Polymarket wraps buttons in spans)
                const parentSpan = el.closest('span[style*="display: flex"]');
                if (parentSpan && parentSpan !== el) {
                    console.log(`[Auto] Also clicking parent span`);
                    parentSpan.click();
                }
            }, 100);

            // Click 3: After 200ms - click inner span
            setTimeout(() => {
                console.log(`[Auto] Click attempt 3 - inner elements`);
                const innerSpan = el.querySelector('span.trading-button-text');
                if (innerSpan) {
                    innerSpan.click();
                }
                // Also try the p element with team name
                const pEl = el.querySelector('p');
                if (pEl) {
                    pEl.click();
                }
            }, 200);

            // Click 4: After 300ms - final attempt with different event
            setTimeout(() => {
                console.log(`[Auto] Click attempt 4 - final`);
                // Try triggering the button's native onclick
                if (el.onclick) {
                    el.onclick(new MouseEvent('click'));
                }
                // Dispatch on document at element coordinates
                document.elementFromPoint(centerX, centerY)?.click();
            }, 300);

            console.log(`[Auto] robustClick initiated - 4 attempts scheduled`);
        };

        const fillPolySlip = (amount) => {
            console.log(`[Auto] fillPolySlip called with amount: ${amount}, team: ${targetTeam}`);

            const attempt = (n) => {
                if (n > 40) {
                    console.log(`[Auto] fillPolySlip max attempts reached`);
                    return;
                }

                console.log(`[Auto] fillPolySlip attempt ${n}`);

                // Step 1: Look for the bet panel (div with width: 340px)
                const betPanel = document.querySelector('div[style*="width: 340px"]');

                if (!betPanel) {
                    console.log(`[Auto] Bet panel not found yet, retrying...`);
                    setTimeout(() => attempt(n + 1), 200);
                    return;
                }

                console.log(`[Auto] Bet panel found`);

                // Step 2: Find and click the correct outcome button
                // These are inside #outcome-buttons with role="radio"
                const outcomeButtons = document.querySelectorAll('#outcome-buttons button[role="radio"]');
                console.log(`[Auto] Found ${outcomeButtons.length} outcome buttons`);

                let targetOutcomeBtn = null;
                let isAlreadySelected = false;

                for (const btn of outcomeButtons) {
                    const btnText = btn.textContent.trim().toUpperCase();
                    console.log(`[Auto] Checking outcome: "${btnText}"`);

                    if (fuzzyMatch(targetTeam, btnText)) {
                        targetOutcomeBtn = btn;
                        isAlreadySelected = btn.getAttribute('aria-checked') === 'true';
                        console.log(`[Auto] Found target outcome: "${btnText}", selected: ${isAlreadySelected}`);
                        break;
                    }
                }

                // If target team button found but not selected, click it with robust method
                if (targetOutcomeBtn && !isAlreadySelected) {
                    console.log(`[Auto] Clicking to select team: ${targetTeam}`);

                    // Use multiple click methods for the outcome button
                    const rect = targetOutcomeBtn.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;

                    const clickOutcome = () => {
                        targetOutcomeBtn.focus();
                        targetOutcomeBtn.click();

                        targetOutcomeBtn.dispatchEvent(new PointerEvent('pointerdown', {
                            bubbles: true, cancelable: true, view: window,
                            clientX: centerX, clientY: centerY, pointerId: 1,
                            pointerType: 'mouse', isPrimary: true
                        }));
                        targetOutcomeBtn.dispatchEvent(new PointerEvent('pointerup', {
                            bubbles: true, cancelable: true, view: window,
                            clientX: centerX, clientY: centerY, pointerId: 1,
                            pointerType: 'mouse', isPrimary: true
                        }));
                        targetOutcomeBtn.dispatchEvent(new MouseEvent('mousedown', {
                            bubbles: true, cancelable: true, view: window,
                            clientX: centerX, clientY: centerY, button: 0
                        }));
                        targetOutcomeBtn.dispatchEvent(new MouseEvent('mouseup', {
                            bubbles: true, cancelable: true, view: window,
                            clientX: centerX, clientY: centerY, button: 0
                        }));
                        targetOutcomeBtn.dispatchEvent(new MouseEvent('click', {
                            bubbles: true, cancelable: true, view: window,
                            clientX: centerX, clientY: centerY, button: 0
                        }));
                    };

                    // Click multiple times
                    clickOutcome();
                    setTimeout(clickOutcome, 100);
                    setTimeout(clickOutcome, 200);

                    // Wait for UI to update after selection
                    setTimeout(() => attempt(n + 1), 400);
                    return;
                }

                // If we couldn't find matching outcome button, the wrong panel might be open
                if (!targetOutcomeBtn && outcomeButtons.length > 0) {
                    console.log(`[Auto] Target team ${targetTeam} not found in panel outcomes. Panel might be for wrong game.`);
                    // Log what teams are available
                    for (const btn of outcomeButtons) {
                        console.log(`[Auto] Available: "${btn.textContent.trim()}"`);
                    }
                    // Still retry in case panel updates
                    setTimeout(() => attempt(n + 1), 300);
                    return;
                }

                // Step 3: Find the amount input
                const input = document.querySelector('#market-order-amount-input');

                if (!input) {
                    console.log(`[Auto] Input not found, retrying...`);
                    setTimeout(() => attempt(n + 1), 200);
                    return;
                }

                console.log(`[Auto] Input found, current value: "${input.value}"`);

                // Extract odds from the selected outcome button
                let extractedOdds = null;
                const selectedOutcome = document.querySelector('#outcome-buttons button[aria-checked="true"]');
                if (selectedOutcome) {
                    const btnText = selectedOutcome.textContent;
                    const oddsMatch = btnText.match(/(\d+\.\d+)/);
                    if (oddsMatch) {
                        extractedOdds = parseFloat(oddsMatch[1]);
                        console.log(`[Auto] Extracted odds: ${extractedOdds}`);
                    }
                }

                // Also try avg price tag
                if (!extractedOdds) {
                    const avgPriceEl = document.querySelector('.odds-converted-tag');
                    if (avgPriceEl) {
                        extractedOdds = parseFloat(avgPriceEl.textContent.trim());
                        console.log(`[Auto] Extracted odds from avg price: ${extractedOdds}`);
                    }
                }

                const finalOdds = extractedOdds || expectedOdds;
                console.log(`[Auto] Final odds: ${finalOdds}`);

                // Set input value using React's native value setter
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                nativeInputValueSetter.call(input, '1');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));

                console.log(`[Auto] Input value set to: "${input.value}"`);

                // Wait for panel to expand (shows "To win" section)
                setTimeout(() => {
                    console.log(`[Auto] Looking for Buy button...`);

                    // Step 4: Find the Buy button
                    // It's a trading-button with tabindex="0" (not "-1" like outcome buttons)
                    // And NOT inside #outcome-buttons
                    let buyBtn = null;
                    const allBtns = document.querySelectorAll('button.trading-button');

                    for (const btn of allBtns) {
                        // Skip if inside outcome-buttons
                        if (btn.closest('#outcome-buttons')) continue;

                        // Skip if it's a radio button
                        if (btn.getAttribute('role') === 'radio') continue;

                        const txt = btn.textContent.toLowerCase().replace(/\s+/g, ' ').trim();
                        console.log(`[Auto] Checking button: "${txt}"`);

                        if (txt.startsWith('buy ')) {
                            buyBtn = btn;
                            console.log(`[Auto] Found Buy button: "${txt}"`);
                            break;
                        }
                    }

                    if (!buyBtn) {
                        console.log(`[Auto] Buy button not found, retrying...`);
                        setTimeout(() => attempt(n + 1), 300);
                        return;
                    }

                    // Click the Buy button multiple times
                    console.log(`[Auto] Clicking Buy button...`);

                    const rect = buyBtn.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;

                    const clickBuy = () => {
                        buyBtn.focus();
                        buyBtn.click();

                        // Pointer events
                        buyBtn.dispatchEvent(new PointerEvent('pointerdown', {
                            bubbles: true, cancelable: true, view: window,
                            clientX: centerX, clientY: centerY, pointerId: 1,
                            pointerType: 'mouse', isPrimary: true
                        }));
                        buyBtn.dispatchEvent(new PointerEvent('pointerup', {
                            bubbles: true, cancelable: true, view: window,
                            clientX: centerX, clientY: centerY, pointerId: 1,
                            pointerType: 'mouse', isPrimary: true
                        }));

                        // Mouse events
                        buyBtn.dispatchEvent(new MouseEvent('mousedown', {
                            bubbles: true, cancelable: true, view: window,
                            clientX: centerX, clientY: centerY, button: 0
                        }));
                        buyBtn.dispatchEvent(new MouseEvent('mouseup', {
                            bubbles: true, cancelable: true, view: window,
                            clientX: centerX, clientY: centerY, button: 0
                        }));
                        buyBtn.dispatchEvent(new MouseEvent('click', {
                            bubbles: true, cancelable: true, view: window,
                            clientX: centerX, clientY: centerY, button: 0
                        }));
                    };

                    // Click 1
                    clickBuy();

                    // Click 2 after 100ms
                    setTimeout(() => {
                        console.log(`[Auto] Buy button click 2`);
                        clickBuy();
                    }, 100);

                    // Click 3 after 200ms
                    setTimeout(() => {
                        console.log(`[Auto] Buy button click 3`);
                        clickBuy();
                        // Also try clicking inner span
                        const innerSpan = buyBtn.querySelector('span');
                        if (innerSpan) innerSpan.click();
                    }, 200);

                    console.log(`[Auto] Buy button click sequence initiated`);

                    // Save bet info
                    const betInfo = {
                        platform: 'polymarket',
                        team: targetTeam,
                        amount: 1,
                        odds: finalOdds,
                        timestamp: Date.now(),
                        status: 'placed'
                    };

                    chrome.storage.local.get(['activeBets', 'totalBets'], (res) => {
                        const activeBets = res.activeBets || [];
                        const totalBets = res.totalBets || 0;
                        activeBets.push(betInfo);
                        chrome.storage.local.set({
                            activeBets: activeBets,
                            totalBets: totalBets + 1
                        });
                        console.log(`[Auto] Bet saved:`, betInfo);
                    });

                    chrome.runtime.sendMessage({
                        action: "bet_placed_success",
                        team: targetTeam,
                        amount: 1,
                        odds: finalOdds,
                        platform: 'polymarket'
                    });

                }, 800); // Wait for panel to expand after entering amount
            };

            // Start with a small delay to let the panel render
            setTimeout(() => attempt(0), 300);
        };

        const fillStakeSlip = (amount) => {
            console.log(`[Auto] fillStakeSlip called with amount: ${amount}`);

            const attempt = (n) => {
                if (n > 30) {
                    console.log(`[Auto] fillStakeSlip max attempts reached`);
                    return;
                }

                console.log(`[Auto] fillStakeSlip attempt ${n}`);

                // Try multiple selectors for Stake
                const inputSelectors = [
                    'input[data-testid="input-bet-amount"]',
                    'input[name="stake"]',
                    'input[placeholder*="0.00"]',
                    '.bet-slip input[type="text"]',
                    '.betslip input'
                ];

                let input = null;
                for (const sel of inputSelectors) {
                    input = document.querySelector(sel);
                    if (input) {
                        console.log(`[Auto] Found Stake input with selector: ${sel}`);
                        break;
                    }
                }

                const placeBtnSelectors = [
                    'button[data-testid="betSlip-place-bets-button"]',
                    'button[data-testid="place-bet-button"]',
                    'button.place-bet',
                    'button[class*="place"]'
                ];

                let placeBtn = null;
                for (const sel of placeBtnSelectors) {
                    placeBtn = document.querySelector(sel);
                    if (placeBtn) {
                        console.log(`[Auto] Found place bet button with selector: ${sel}`);
                        break;
                    }
                }

                // Also look for button by text
                if (!placeBtn) {
                    const allBtns = document.querySelectorAll('button');
                    for (const btn of allBtns) {
                        const txt = btn.textContent.toLowerCase();
                        if (txt.includes('place bet') || txt.includes('place bets')) {
                            placeBtn = btn;
                            console.log(`[Auto] Found place bet button by text: "${btn.textContent}"`);
                            break;
                        }
                    }
                }

                if (input && placeBtn) {
                    console.log(`[Auto] Stake input and Place Bet button found!`);
                    const valueToSet = amount || "0.01";

                    input.focus();
                    input.click();

                    // Multiple methods to set value
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                    nativeSetter.call(input, valueToSet);
                    input.value = valueToSet;

                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new InputEvent('input', {
                        bubbles: true,
                        inputType: 'insertText',
                        data: valueToSet
                    }));

                    // Try execCommand
                    input.select();
                    document.execCommand('insertText', false, valueToSet);

                    console.log(`[Auto] Stake input value set to: ${input.value}`);
                    input.style.border = "3px solid #00e676";

                    setTimeout(() => {
                        console.log(`[Auto] Final Stake input value: ${input.value}`);

                        // Highlight and click Place Bet button
                        placeBtn.style.border = "4px solid #e91e63";
                        placeBtn.style.boxShadow = "0 0 15px rgba(233, 30, 99, 0.8)";

                        console.log(`[Auto] 🚀 Clicking Place Bet button...`);
                        robustClick(placeBtn);

                        // Store the bet info
                        const betInfo = {
                            platform: 'stake',
                            team: targetTeam,
                            amount: parseFloat(amount) || 0.01,
                            odds: expectedOdds,
                            timestamp: Date.now(),
                            status: 'pending'
                        };

                        chrome.storage.local.get(['activeBets', 'totalBets'], (res) => {
                            const activeBets = res.activeBets || [];
                            const totalBets = res.totalBets || 0;
                            activeBets.push(betInfo);
                            chrome.storage.local.set({
                                activeBets: activeBets,
                                totalBets: totalBets + 1
                            });
                            console.log(`[Auto] ✅ Stake bet recorded:`, betInfo);
                        });

                        chrome.runtime.sendMessage({
                            action: "bet_placed_success",
                            team: targetTeam,
                            amount: amount,
                            odds: expectedOdds,
                            platform: 'stake'
                        });

                        // Monitor for result
                        monitorStakeResult(targetTeam, parseFloat(amount) || 0.01, expectedOdds);

                    }, 500);
                } else if (input && !placeBtn) {
                    // Input found but no Place Bet button - still fill the input
                    console.log(`[Auto] Found Stake input but no Place Bet button, filling anyway...`);
                    input.focus();
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                    nativeSetter.call(input, amount || "0.01");
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    setTimeout(() => attempt(n + 1), 250);
                } else {
                    console.log(`[Auto] Stake Input: ${!!input}, PlaceBtn: ${!!placeBtn} - retrying...`);
                    setTimeout(() => attempt(n + 1), 250);
                }
            };
            attempt(0);
        };

        // Monitor Polymarket result for win/loss
        const monitorPolymarketResult = (team, amount, odds) => {
            console.log(`[Auto] 📊 Monitoring Polymarket result for ${team}...`);

            let checkCount = 0;
            const maxChecks = 60; // Check for 30 seconds

            const checkResult = () => {
                checkCount++;
                if (checkCount > maxChecks) {
                    console.log(`[Auto] ⏰ Monitoring timeout for ${team}`);
                    return;
                }

                // Look for success/error messages on the page
                const successIndicators = [
                    '.toast-success',
                    '[class*="success"]',
                    '[class*="confirmed"]',
                    'div:contains("Order placed")',
                    'div:contains("Success")'
                ];

                const errorIndicators = [
                    '.toast-error',
                    '[class*="error"]',
                    '[class*="failed"]',
                    'div:contains("Failed")',
                    'div:contains("Error")'
                ];

                let isSuccess = false;
                let isError = false;

                // Check for success
                for (const sel of successIndicators) {
                    try {
                        const el = document.querySelector(sel);
                        if (el && el.offsetParent !== null) {
                            isSuccess = true;
                            break;
                        }
                    } catch (e) { }
                }

                // Check for error
                for (const sel of errorIndicators) {
                    try {
                        const el = document.querySelector(sel);
                        if (el && el.offsetParent !== null) {
                            isError = true;
                            break;
                        }
                    } catch (e) { }
                }

                if (isSuccess) {
                    const profit = (amount * odds) - amount;
                    console.log(`[Auto] ✅ WIN on Polymarket! Team: ${team}, Profit: $${profit.toFixed(4)}`);

                    // Update storage with win
                    chrome.storage.local.get(['totalProfit', 'wins', 'betHistory'], (res) => {
                        const totalProfit = (res.totalProfit || 0) + profit;
                        const wins = (res.wins || 0) + 1;
                        const betHistory = res.betHistory || [];

                        betHistory.push({
                            platform: 'polymarket',
                            team: team,
                            amount: amount,
                            odds: odds,
                            profit: profit,
                            result: 'win',
                            timestamp: Date.now()
                        });

                        chrome.storage.local.set({
                            totalProfit: totalProfit,
                            wins: wins,
                            betHistory: betHistory
                        });

                        console.log(`[Auto] 💰 Total Profit: $${totalProfit.toFixed(4)}, Wins: ${wins}`);
                    });

                    chrome.runtime.sendMessage({
                        action: "bet_result",
                        platform: 'polymarket',
                        team: team,
                        result: 'win',
                        profit: profit
                    });

                } else if (isError) {
                    console.log(`[Auto] ❌ LOSS/ERROR on Polymarket for ${team}`);

                    chrome.storage.local.get(['totalProfit', 'losses', 'betHistory'], (res) => {
                        const totalProfit = (res.totalProfit || 0) - amount;
                        const losses = (res.losses || 0) + 1;
                        const betHistory = res.betHistory || [];

                        betHistory.push({
                            platform: 'polymarket',
                            team: team,
                            amount: amount,
                            odds: odds,
                            profit: -amount,
                            result: 'loss',
                            timestamp: Date.now()
                        });

                        chrome.storage.local.set({
                            totalProfit: totalProfit,
                            losses: losses,
                            betHistory: betHistory
                        });

                        console.log(`[Auto] 📉 Total Profit: $${totalProfit.toFixed(4)}, Losses: ${losses}`);
                    });

                    chrome.runtime.sendMessage({
                        action: "bet_result",
                        platform: 'polymarket',
                        team: team,
                        result: 'loss',
                        profit: -amount
                    });

                } else {
                    // Keep checking
                    setTimeout(checkResult, 500);
                }
            };

            // Start checking after a delay
            setTimeout(checkResult, 1000);
        };

        // Monitor Stake result for win/loss
        const monitorStakeResult = (team, amount, odds) => {
            console.log(`[Auto] 📊 Monitoring Stake result for ${team}...`);

            let checkCount = 0;
            const maxChecks = 60;

            const checkResult = () => {
                checkCount++;
                if (checkCount > maxChecks) {
                    console.log(`[Auto] ⏰ Monitoring timeout for ${team}`);
                    return;
                }

                // Stake-specific success/error selectors
                const successIndicators = [
                    '[data-testid="bet-success"]',
                    '.bet-confirmation',
                    '[class*="success"]',
                    '[class*="confirmed"]'
                ];

                const errorIndicators = [
                    '[data-testid="bet-error"]',
                    '[class*="error"]',
                    '[class*="rejected"]'
                ];

                let isSuccess = false;
                let isError = false;

                for (const sel of successIndicators) {
                    try {
                        const el = document.querySelector(sel);
                        if (el && el.offsetParent !== null) {
                            isSuccess = true;
                            break;
                        }
                    } catch (e) { }
                }

                for (const sel of errorIndicators) {
                    try {
                        const el = document.querySelector(sel);
                        if (el && el.offsetParent !== null) {
                            isError = true;
                            break;
                        }
                    } catch (e) { }
                }

                if (isSuccess) {
                    const profit = (amount * odds) - amount;
                    console.log(`[Auto] ✅ WIN on Stake! Team: ${team}, Profit: $${profit.toFixed(4)}`);

                    chrome.storage.local.get(['totalProfit', 'wins', 'betHistory'], (res) => {
                        const totalProfit = (res.totalProfit || 0) + profit;
                        const wins = (res.wins || 0) + 1;
                        const betHistory = res.betHistory || [];

                        betHistory.push({
                            platform: 'stake',
                            team: team,
                            amount: amount,
                            odds: odds,
                            profit: profit,
                            result: 'win',
                            timestamp: Date.now()
                        });

                        chrome.storage.local.set({
                            totalProfit: totalProfit,
                            wins: wins,
                            betHistory: betHistory
                        });

                        console.log(`[Auto] 💰 Total Profit: $${totalProfit.toFixed(4)}, Wins: ${wins}`);
                    });

                    chrome.runtime.sendMessage({
                        action: "bet_result",
                        platform: 'stake',
                        team: team,
                        result: 'win',
                        profit: profit
                    });

                } else if (isError) {
                    console.log(`[Auto] ❌ LOSS/ERROR on Stake for ${team}`);

                    chrome.storage.local.get(['totalProfit', 'losses', 'betHistory'], (res) => {
                        const totalProfit = (res.totalProfit || 0) - amount;
                        const losses = (res.losses || 0) + 1;
                        const betHistory = res.betHistory || [];

                        betHistory.push({
                            platform: 'stake',
                            team: team,
                            amount: amount,
                            odds: odds,
                            profit: -amount,
                            result: 'loss',
                            timestamp: Date.now()
                        });

                        chrome.storage.local.set({
                            totalProfit: totalProfit,
                            losses: losses,
                            betHistory: betHistory
                        });

                        console.log(`[Auto] 📉 Total Profit: $${totalProfit.toFixed(4)}, Losses: ${losses}`);
                    });

                    chrome.runtime.sendMessage({
                        action: "bet_result",
                        platform: 'stake',
                        team: team,
                        result: 'loss',
                        profit: -amount
                    });

                } else {
                    setTimeout(checkResult, 500);
                }
            };

            setTimeout(checkResult, 1000);
        };

        checkAndClick(0);
    }
});

let isEnabled = true;
let observer = null;

// Initialize
chrome.storage.local.get(['isEnabled', 'liveScanEnabled', 'highlightEnabled'], (result) => {
    isEnabled = result.isEnabled !== false; // Default true
    highlightEnabled = result.highlightEnabled !== false; // Default true

    if (isEnabled) {
        runConverter();
        setTimeout(runConverter, 1000);
        startObserver();
    }

    // Auto-start live monitoring if enabled in settings
    if (result.liveScanEnabled === true) {
        console.log("[Content] Auto-starting live monitoring from saved setting");
        startLiveMonitoring();
    }
});

function runConverter() {
    if (!isEnabled) return;

    // Find all text nodes strictly matching pattern
    const walkers = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    const nodesToProcess = [];

    while (node = walkers.nextNode()) {
        if (node.nodeValue.includes('¢')) {
            nodesToProcess.push(node);
        }
    }

    nodesToProcess.forEach(processNode);
}

function processNode(textNode) {
    if (textNode.parentNode &&
        (textNode.parentNode.classList.contains('odds-converted-tag') ||
            textNode.parentNode.classList.contains('odds-original-text'))) {
        return;
    }

    const text = textNode.nodeValue;

    // Strategy 1: Non-destructive update for isolated matches 
    // Relaxed regex: allows "22¢", " 22¢", "22 ¢"
    const simpleMatch = /(\d+)\s*¢/;
    const simpleResult = text.match(simpleMatch);

    if (simpleResult && text.trim().length < 10) {
        // Only treat as simple isolated node if text is short, otherwise use split strategy
        // actually if node text is JUST the price, use strategy 1.

        const cents = parseInt(simpleResult[1], 10);

        // Safety check
        if (isNaN(cents) || cents <= 0) return;

        const decimalOdds = (100 / cents).toFixed(2);

        // Check if we already have a tag immediately following
        let next = textNode.nextSibling;
        if (next && next.nodeType === Node.ELEMENT_NODE &&
            (next.classList.contains('odds-converted-tag') || next.className.includes('odds-converted-tag'))) {
            if (next.textContent !== decimalOdds) {
                next.textContent = decimalOdds;
            }
        } else {
            const conversionSpan = createConversionTag(decimalOdds);
            if (textNode.parentNode) {
                // If the text node contains MORE than just the price, we might want to split?
                // But Strategy 1 was for "text matches pattern exactly".
                // If "Buy Yes 22¢", simpleResult is true, but we don't want to replace trailing text?
                // Actually the Logic below (strategy 2) handles embedding.
                // Strategy 1 should be for "The text node ENDS with price" or IS the price.

                // Let's rely on Strategy 2 for everything to be safe, it's more robust?
                // The previous code had `^\s*(\d+)\s*¢\s*$` for strict match.
                // If the text is "Buy Yes 22¢", that strict match failed, and it went to Stat 2.
                // Strategy 2 regex: `(\d+)\s*¢/g`.
                // "Buy Yes 22¢" -> match "22¢".
                // It splits: "Buy Yes " (text) -> "22¢" (span) -> [1.23] (tag).

                // The user's screenshot shows "Buy Yes 22¢" and NO conversion tag next to it.
                // This implies `processNode` isn't finding it, or `nodeValue` doesn't contain `¢` (maybe different char?),
                // OR `processNode` is returning early.
            }
        }
        // Let's NOT return here if text is complex, fall through to Strategy 2.
        // Revert to strict check for Strategy 1 or just disable Strategy 1 to force split logic which creates tags.
    }

    // Fallback to Strategy 2 (Split & Inject) always? 
    // It's safer for "Buy Yes 22¢".

    // Strategy 2: Splitting for complex strings
    const regex = /(\d+)\s*¢/g;
    if (!regex.test(text)) return;

    regex.lastIndex = 0;

    let match;
    let newContent = document.createDocumentFragment();
    let lastIndex = 0;
    let found = false;

    while ((match = regex.exec(text)) !== null) {
        found = true;
        const fullMatch = match[0];
        const cents = parseInt(match[1], 10);
        if (cents <= 0) continue; // skip zero or invalid

        const decimalOdds = (100 / cents).toFixed(2);

        newContent.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));

        const originalSpan = document.createElement('span');
        originalSpan.textContent = fullMatch;
        originalSpan.className = 'odds-original-text';
        newContent.appendChild(originalSpan);

        newContent.appendChild(createConversionTag(decimalOdds));

        lastIndex = regex.lastIndex;
    }

    if (found) {
        newContent.appendChild(document.createTextNode(text.substring(lastIndex)));
        if (textNode.parentNode) {
            textNode.parentNode.replaceChild(newContent, textNode);
        }
    }
}

function createConversionTag(oddsValue) {
    const conversionSpan = document.createElement('span');
    conversionSpan.className = 'odds-converted-tag';
    conversionSpan.style.backgroundColor = '#e0f7fa';
    conversionSpan.style.color = '#006064';
    conversionSpan.style.border = '1px solid #0097a7';
    conversionSpan.style.borderRadius = '3px';
    conversionSpan.style.padding = '0 4px';
    conversionSpan.style.marginLeft = '4px';
    conversionSpan.style.fontSize = '0.9em';
    conversionSpan.style.fontWeight = 'bold';
    conversionSpan.textContent = oddsValue;
    return conversionSpan;
}

function removeConversions() {
    const tags = document.querySelectorAll('.odds-converted-tag');
    tags.forEach(tag => tag.remove());

    const originalTags = document.querySelectorAll('.odds-original-text');
    originalTags.forEach(tag => {
        const text = document.createTextNode(tag.textContent);
        tag.parentNode.replaceChild(text, tag);
    });

    document.body.normalize();
}

function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
        if (!isEnabled) return;

        mutations.forEach(mutation => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        if (node.nodeValue.includes('¢')) {
                            processNode(node);
                        }
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        const walkers = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
                        let childNode;
                        while (childNode = walkers.nextNode()) {
                            if (childNode.nodeValue.includes('¢')) {
                                processNode(childNode);
                            }
                        }
                    }
                });
            } else if (mutation.type === 'characterData') {
                if (mutation.target.nodeValue.includes('¢')) {
                    processNode(mutation.target);
                }
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

// Auto-Scrape for Monitoring
setTimeout(() => {
    if (typeof scrapePageData === 'function') {
        const data = scrapePageData();
        if (data && data.odds && data.odds.length > 0) {
            try {
                chrome.runtime.sendMessage({
                    action: "data_updated",
                    data: data
                });
            } catch (err) {
                // Ignore if background is not listening
            }
        }
    }
}, 3000);

// Play Sound Handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "play_sound") {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            const audioCtx = new AudioContext();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.type = 'sine';
            oscillator.frequency.value = 880; // A5
            gainNode.gain.value = 0.1;

            oscillator.start();
            setTimeout(() => {
                oscillator.stop();
                audioCtx.close();
            }, 200);
        } catch (e) {
            console.error("Audio play failed", e);
        }
    }
});
