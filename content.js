// Expose to window
window.scrapePageData = scrapePageData;

// Debug function to see what's being scraped
window.debugScrape = function() {
    const data = scrapePageData();
    console.log('[DEBUG] Scraped Data:', JSON.stringify(data, null, 2));
    console.log('[DEBUG] Teams found:', data.odds.map(o => `${o.team} @ ${o.odds}`).join(', '));
    return data;
};

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

        // 2. Try Decimal (e.g. 1.28, 1.85)
        // If it's already a decimal odds value (typically 1.01 to 100.00)
        const matchDecimal = str.match(/(\d+\.\d+)/);
        if (matchDecimal) {
            const val = parseFloat(matchDecimal[1]);
            // If value looks like decimal odds (1.01 to 100), return as-is
            // If it looks like cents converted wrongly (0.xx), convert
            if (val >= 1.01 && val <= 100) {
                return val;
            }
        }

        // 3. Try plain integer as cents (e.g., "52" means 52 cents)
        const matchInt = str.match(/^(\d+)$/);
        if (matchInt) {
            const cents = parseInt(matchInt[1], 10);
            if (cents > 0 && cents <= 100) {
                return (100 / cents).toFixed(2);
            }
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
    // Group by match/event container first
    const polyMarketContainers = document.querySelectorAll('a[href*="/event/"]');
    if (polyMarketContainers.length > 0) {
        data.type = 'polymarket';
        
        polyMarketContainers.forEach(container => {
            const buttons = container.querySelectorAll('button.trading-button, button[class*="trading-button"]');
            const matchTeams = [];
            
            // Try to get full team names from the row/container (not just button labels)
            // Look for team names in the match row - they appear as text before the buttons
            const fullTeamNames = [];
            
            // Look for team name elements in the container (outside buttons)
            // These often have score indicators (0, 1, etc.) next to them
            const textNodes = container.querySelectorAll('span, div, p');
            textNodes.forEach(node => {
                // Skip if it's inside a button
                if (node.closest('button')) return;
                
                const text = node.textContent.trim();
                // Look for team names - they're usually longer text that isn't a number/score
                // Avoid things like "LIVE", "Game 2", scores, etc.
                if (text.length >= 3 && 
                    !/^(LIVE|Game \d|Best of \d|\$[\d.]+k|Vol\.|Game View|Load More|\d+)$/i.test(text) &&
                    !/^\d+\.\d+$/.test(text) &&
                    !text.includes('¢')) {
                    
                    // Check if this looks like a team name (has letters)
                    if (/[A-Za-z]{2,}/.test(text) && text.length <= 50) {
                        fullTeamNames.push(text.toUpperCase());
                    }
                }
            });
            
            buttons.forEach((btn, btnIndex) => {
                let team = 'UNKNOWN';
                let fullTeam = null;
                
                // Get short team name from button's .opacity-70
                const teamNode = btn.querySelector('.opacity-70');
                let shortName = '';
                if (teamNode) {
                    let rawTeam = teamNode.textContent.trim().toUpperCase();
                    
                    // Aggressive cleaning for team names:
                    rawTeam = rawTeam.replace(/\d+\.\d+/g, '').trim();
                    rawTeam = rawTeam.replace(/\d+¢/g, '').trim();
                    rawTeam = rawTeam.replace(/\s+\d{1,3}$/g, '').trim();
                    if (/^\d+/.test(rawTeam)) {
                        const numParts = rawTeam.split(/\s+/);
                        if (numParts.length >= 2 && /^\d+$/.test(numParts[0]) && /^\d+$/.test(numParts[1])) {
                            rawTeam = numParts[0];
                        }
                    }
                    const parts = rawTeam.split(/\s+/);
                    if (parts.length === 2 && parts[0] === parts[1]) {
                        rawTeam = parts[0];
                    }
                    
                    shortName = rawTeam;
                    team = rawTeam;
                }
                
                // Try to find matching full team name from the container
                // The full name should START with the short button name
                if (shortName && fullTeamNames.length > 0) {
                    for (const fullName of fullTeamNames) {
                        // Check if full name starts with short name or contains it prominently
                        if (fullName.startsWith(shortName) || 
                            fullName.includes(shortName + ' ') ||
                            fullName.split(/\s+/)[0] === shortName) {
                            fullTeam = fullName;
                            break;
                        }
                    }
                }
                
                // Use full team name if found, otherwise fall back to short name
                if (fullTeam) {
                    team = fullTeam;
                }
                
                // Get odds - try multiple approaches
                let odds = null;
                
                // Method 1: Direct odds span with .ml-1 class (new Polymarket format)
                const oddsSpan = btn.querySelector('.ml-1, [class*="ml-1"]');
                if (oddsSpan) {
                    const oddsText = oddsSpan.textContent.trim();
                    odds = parsePolyOdds(oddsText);
                }
                
                // Method 2: Fallback - clone and remove team element
                if (!odds) {
                    const clone = btn.cloneNode(true);
                    const tags = clone.querySelectorAll('.odds-converted-tag');
                    tags.forEach(t => t.remove());
                    const teamEl = clone.querySelector('.opacity-70');
                    if (teamEl) teamEl.remove();
                    
                    const rawText = clone.textContent.trim();
                    odds = parsePolyOdds(rawText);
                }
                
                if (team && team !== 'UNKNOWN' && team.length > 0 && odds) {
                    matchTeams.push({
                        team,
                        odds: odds === 'Suspended' ? 'Suspended' : parseFloat(odds),
                        source: 'Poly',
                        link: container.href || window.location.href,
                        id: btn.id
                    });
                }
            });
            
            // Add teams from this match to data
            // This keeps teams from the same match together
            matchTeams.forEach(t => data.odds.push(t));
        });
    }
    
    // Fallback: Original button-based scraper if no containers found
    if (data.odds.length === 0) {
        const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
        if (polyButtons.length > 0) {
            data.type = 'polymarket';
            polyButtons.forEach(btn => {
                let team = 'UNKNOWN';
                
                // Get team name from .opacity-70
                const teamNode = btn.querySelector('.opacity-70');
                if (teamNode) {
                    let rawTeam = teamNode.textContent.trim().toUpperCase();
                    
                    // Aggressive cleaning for team names:
                    rawTeam = rawTeam.replace(/\d+\.\d+/g, '').trim();
                    rawTeam = rawTeam.replace(/\d+¢/g, '').trim();
                    rawTeam = rawTeam.replace(/\s+\d{1,3}$/g, '').trim();
                    if (/^\d+/.test(rawTeam)) {
                        const numParts = rawTeam.split(/\s+/);
                        if (numParts.length >= 2 && /^\d+$/.test(numParts[0]) && /^\d+$/.test(numParts[1])) {
                            rawTeam = numParts[0];
                        }
                    }
                    const parts = rawTeam.split(/\s+/);
                    if (parts.length === 2 && parts[0] === parts[1]) {
                        rawTeam = parts[0];
                    }
                    
                    team = rawTeam;
                }
                
                // Get odds - try multiple approaches
                let odds = null;
                
                // Method 1: Direct odds span with .ml-1 class
                const oddsSpan = btn.querySelector('.ml-1, [class*="ml-1"]');
                if (oddsSpan) {
                    const oddsText = oddsSpan.textContent.trim();
                    odds = parsePolyOdds(oddsText);
                }
                
                // Method 2: Fallback - clone and remove team element
                if (!odds) {
                    const clone = btn.cloneNode(true);
                    const tags = clone.querySelectorAll('.odds-converted-tag');
                    tags.forEach(t => t.remove());
                    const teamEl = clone.querySelector('.opacity-70');
                    if (teamEl) teamEl.remove();
                    
                    const rawText = clone.textContent.trim();
                    odds = parsePolyOdds(rawText);
                }

                const linkEl = btn.closest('a');
                const link = linkEl ? linkEl.href : window.location.href;

                if (team !== 'UNKNOWN' && odds) {
                    data.odds.push({
                        team,
                        odds: odds === 'Suspended' ? 'Suspended' : parseFloat(odds),
                        source: 'Poly',
                        link: link,
                        id: btn.id
                    });
                }
            });
        }
    }

    // 2. Stake/SX Scraper
    if (data.odds.length === 0) {
        // Try multiple selector strategies for Stake
        let stackItems = document.querySelectorAll('.outcome-content');
        
        // Alternative selectors if main one doesn't find items
        if (stackItems.length === 0) {
            stackItems = document.querySelectorAll('[data-testid="outcome-button"]');
        }
        if (stackItems.length === 0) {
            stackItems = document.querySelectorAll('.outcome-button');
        }
        
        if (stackItems.length > 0) {
            data.type = 'stack';
            stackItems.forEach(item => {
                // Try multiple ways to get team name
                let nameEl = item.querySelector('[data-testid="outcome-button-name"]');
                if (!nameEl) {
                    nameEl = item.querySelector('.outcome-name, .team-name, [class*="name"]');
                }
                
                // Also check the button text directly
                let team = 'UNKNOWN';
                if (nameEl) {
                    team = nameEl.textContent.trim().toUpperCase();
                } else {
                    // Try to get name from the item itself
                    const btn = item.closest('button') || item;
                    const allText = btn.innerText || btn.textContent;
                    const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    
                    // First non-numeric line is likely the team name
                    for (const line of lines) {
                        // Skip if it looks like odds
                        if (/^\d+\.\d+$/.test(line)) continue;
                        if (line.length >= 2 && line.length <= 30) {
                            team = line.toUpperCase();
                            break;
                        }
                    }
                }
                
                // Get odds
                let oddsContainer = item.querySelector('[data-testid="fixture-odds"]');
                if (!oddsContainer) {
                    oddsContainer = item.querySelector('.odds, [class*="odds"]');
                }
                
                let odds = null;
                if (oddsContainer) {
                    odds = parseStakeOdds(oddsContainer.textContent);
                } else {
                    // Try to find odds in the button
                    const btn = item.closest('button') || item;
                    const text = btn.textContent;
                    const oddsMatch = text.match(/(\d+\.\d{2})/);
                    if (oddsMatch) {
                        odds = parseFloat(oddsMatch[1]);
                    } else {
                        if (btn.disabled) odds = 'Suspended';
                    }
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

    return data;
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
        }
    }
    if (request.action === "toggleLive") {
        if (request.enabled) startLiveMonitoring();
        else stopLiveMonitoring();
    }
    // ... highlight handler below ...
    if (request.action === "highlight_odds") {
        const targets = request.targets || []; // Array of { team, type } 
        // type: 'polymarket' or 'stack'

        // Remove old highlights
        document.querySelectorAll('.arb-highlight-box').forEach(el => el.classList.remove('arb-highlight-box'));

        // Highlight new targets
        targets.forEach(tgt => {
            // Logic to find and highlight in DOM
            if (tgt.type === 'stack') {
                const stackItems = document.querySelectorAll('.outcome-content');
                stackItems.forEach(item => {
                    const nameEl = item.querySelector('[data-testid="outcome-button-name"]');
                    if (nameEl) {
                        const teamName = nameEl.textContent.trim().toUpperCase();
                        // Simple includes match
                        if (teamName.includes(tgt.team) || tgt.team.includes(teamName)) {
                            // Found it! Apply style to the BUTTON container group
                            const container = item.closest('button');
                            if (container) {
                                container.setAttribute('style', 'background-color: #ffe0b2 !important; border: 2px solid #e65100 !important;');
                            }
                        }
                    }
                });
            } else if (tgt.type === 'polymarket') {
                const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
                polyButtons.forEach(btn => {
                    const txt = btn.textContent.trim().toUpperCase();
                    if (txt.includes(tgt.team)) {
                        btn.setAttribute('style', 'background-color: #ffe0b2 !important; border: 2px solid #e65100 !important;');
                    }
                });
            }
        });
    }

    if (request.action === "click_bet_button") {
        sendResponse({ status: "received" });

        const targetTeam = request.team ? request.team.toUpperCase() : null;
        const targetId = request.id;
        const expectedOdds = parseFloat(request.expectedOdds); // The decimal odds we want
        const retryLimit = request.retryLimit || 1; // Default from request or 1
        const tolerance = 0.05; // increased tolerance slightly for small drifts

        console.log(`[Auto] Target: ${targetTeam}, ID: ${targetId}, Expect: ${expectedOdds}, Amt: ${request.amount}`);

        // Helper to extract numeric odds from text
        const parseOddsFromText = (text) => {
            // Polymarket: "59¢" -> 1.69
            const cents = text.match(/(\d+)\s*¢/);
            if (cents) return (100 / parseInt(cents[1])).toFixed(2);
            // Stake: "1.85"
            const dec = text.match(/(\d+\.\d+)/);
            if (dec) return parseFloat(dec[1]);
            return null;
        };

        const checkAndClick = (attempts = 0) => {
            // Use retryLimit from user settings (e.g. 5 retries)
            // If retryLimit is small (e.g. 1), we don't want to loop forever.
            // But we also have a max timeout safety.

            // Logic: 
            // If we match odds -> good.
            // If we find button but odds mismatch -> consume 1 retry attempt.
            // If we don't find button -> consume 1 retry attempt (maybe loading).

            if (attempts >= retryLimit) {
                console.warn(`[Auto] Max retries (${retryLimit}) reached.`);
                // Send notification to TG instead of alert
                chrome.runtime.sendMessage({ 
                    action: "bet_error", 
                    error: "Max retries reached",
                    details: `Odds mismatch or Element not found after ${retryLimit} retries`,
                    team: targetTeam
                });
                return;
            }

            let found = false;

            // --- POLYMARKET CHECK ---
            if (!found) {
                const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
                for (const btn of polyButtons) {
                    const txt = btn.textContent.trim().toUpperCase();

                    // Match Team
                    let isMatch = false;
                    if (targetId && btn.id === targetId) isMatch = true;
                    else if (targetTeam && (txt.includes(targetTeam) || targetTeam.includes(txt.split(' ')[0]))) isMatch = true;

                    if (isMatch) {
                        // Match Odds
                        const btnText = btn.innerText; // innerText often contains the 59¢ part
                        const currentOdds = parseOddsFromText(btnText);

                        // Poly uses inverse price, so strict decimal check might be tricky due to rounding.
                        // Let's trust if we found the button and odds are "close enough" or if expected is null
                        if (currentOdds) {
                            const diff = Math.abs(currentOdds - expectedOdds);
                            if (diff > tolerance && expectedOdds) {
                                console.log(`[Auto] Poly Odds mismatch. Saw ${currentOdds}, Want ${expectedOdds}. Retrying...`);
                                setTimeout(() => checkAndClick(attempts + 1), 500);
                                return; // Retry loop
                            }
                        }

                        // Found & Valid!
                        console.log("[Auto] Poly Match Found. Clicking...");
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
                for (const item of stackItems) {
                    const nameEl = item.querySelector('[data-testid="outcome-button-name"]');
                    if (nameEl) {
                        const team = nameEl.textContent.trim().toUpperCase();
                        if (team === targetTeam || (targetTeam && team.includes(targetTeam))) {
                            // Check Odds
                            // User says: <span ... data-ds-text="true">1.85</span>
                            // Often inside [data-testid="fixture-odds"]
                            const oddsContainer = item.querySelector('[data-testid="fixture-odds"]');
                            let currentOdds = null;
                            if (oddsContainer) currentOdds = parseOddsFromText(oddsContainer.textContent);

                            if (currentOdds) {
                                if (Math.abs(currentOdds - expectedOdds) > tolerance && expectedOdds) {
                                    console.log(`[Auto] Stake Odds mismatch. Saw ${currentOdds}, Want ${expectedOdds}. Retrying...`);
                                    setTimeout(() => checkAndClick(attempts + 1), 500);
                                    return;
                                }
                            }

                            // Found & Valid!
                            console.log("[Auto] Stake Match Found. Clicking...");
                            const btn = item.closest('button');
                            btn.scrollIntoView({ block: 'center' });
                            btn.click();
                            fillStakeSlip(request.amount);
                            found = true;
                            break;
                        }
                    }
                }
            }

            if (!found) {
                // If strictly looking for ID/Text and didn't find button at all -> retry (maybe loading)
                setTimeout(() => checkAndClick(attempts + 1), 100);
            }
        };

        const robustClick = (el) => {
            el.scrollIntoView({ behavior: 'auto', block: 'center' });
            el.click();
            el.style.border = "4px solid #00e676";
        };

        const fillPolySlip = (amount) => {
            const attempt = (n) => {
                if (n > 20) return;
                const input = document.querySelector('input[placeholder="$0"]');
                const actionBtn = document.querySelector('button[data-color="blue"]');
                if (input && actionBtn) {
                    input.focus();
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                    nativeSetter.call(input, amount || "0.01");
                    input.dispatchEvent(new Event('input', { bubbles: true }));

                    setTimeout(() => {
                        // Don't auto-click confirm yet? User asked to "click booked profit".
                        // Usually we just highlight the button
                        actionBtn.style.border = "4px solid #e91e63";
                        // Send success message
                        chrome.runtime.sendMessage({ action: "bet_placed_success", team: targetTeam, amount: amount, odds: expectedOdds });
                    }, 500);
                } else setTimeout(() => attempt(n + 1), 250);
            };
            attempt(0);
        };

        const fillStakeSlip = (amount) => {
            const startTime = Date.now(); // Track execution time
            
            const attempt = (n) => {
                if (n > 20) return;
                // Try multiple selectors for stake input - site may change format
                const input = document.querySelector('input[data-testid="input-bet-amount"]') ||
                              document.querySelector('input[placeholder="Enter Stake"]') ||
                              document.querySelector('input[data-numpad-trigger="true"]');
                // Try multiple selectors for Place Bet button
                const placeBtn = document.querySelector('button[data-testid="betSlip-place-bets-button"]') ||
                                 document.querySelector('button span[data-ds-text="true"]')?.closest('button') ||
                                 Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Place Bet'));
                
                if (input && placeBtn) {
                    // Ensure amount is valid - convert to number and check
                    let betAmount = parseFloat(amount);
                    if (isNaN(betAmount) || betAmount <= 0) {
                        betAmount = 0.1; // Default to 0.1 if invalid
                    }
                    const amountStr = betAmount.toString();
                    
                    // Clear and focus input
                    input.focus();
                    input.select();
                    
                    // Use native setter for React/Svelte compatibility
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                    nativeSetter.call(input, amountStr);
                    
                    // Dispatch multiple events for React/Svelte compatibility
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

                    setTimeout(() => {
                        // Highlight the stake input
                        input.style.border = "3px solid #00e676";
                        input.style.boxShadow = "0 0 10px #00e676";
                        
                        // Click the Place Bet button
                        console.log("[Auto] Clicking Place Bet button...");
                        placeBtn.style.border = "4px solid #e91e63";
                        placeBtn.click();
                        
                        // Wait for confirmation dialog/button and click again if needed
                        setTimeout(() => {
                            // Look for confirmation button (might appear after first click)
                            const confirmBtn = document.querySelector('button[data-testid="betSlip-place-bets-button"]') ||
                                               Array.from(document.querySelectorAll('button')).find(b => 
                                                   b.textContent.includes('Place Bet') || 
                                                   b.textContent.includes('Confirm')
                                               );
                            if (confirmBtn && confirmBtn !== placeBtn) {
                                console.log("[Auto] Clicking confirmation button...");
                                confirmBtn.style.border = "4px solid #e91e63";
                                confirmBtn.click();
                            }
                            
                            // Check for any warnings/errors (insufficient balance, min bet, etc.)
                            checkBetWarnings(targetTeam, amountStr, expectedOdds);
                            
                            // Send PENDING status first
                            chrome.runtime.sendMessage({ 
                                action: "bet_status_update", 
                                team: targetTeam, 
                                amount: amountStr, 
                                odds: expectedOdds,
                                status: "PENDING",
                                timestamp: new Date().toISOString()
                            });
                            
                            // Start checking for bet success
                            verifyBetPlaced(targetTeam, amountStr, expectedOdds, startTime);
                        }, 800);
                    }, 500);
                } else setTimeout(() => attempt(n + 1), 250);
            };
            attempt(0);
        };
        
        // Function to verify bet was placed successfully by detecting GREEN CHECKMARK
        // Wait up to 15 seconds (75 attempts × 200ms) for green checkmark to appear
        // Network can be slow, so we keep polling until we see the SVG check icon
        const verifyBetPlaced = (team, amount, odds, startTime, attempts = 0) => {
            if (attempts > 75) {
                // Max attempts reached (15 seconds) - bet might have failed
                const endTime = Date.now();
                const duration = endTime - startTime;
                console.log(`[Auto] Bet verification timeout after ${duration}ms`);
                chrome.runtime.sendMessage({ 
                    action: "bet_placed_failed", 
                    team: team, 
                    amount: amount, 
                    odds: odds,
                    duration: duration,
                    reason: "Verification timeout - no green checkmark detected"
                });
                return;
            }
            
            // PRIMARY SUCCESS INDICATOR: Green checkmark SVG icon in betslip
            // Look for <svg data-ds-icon="Check"> anywhere in the betslip area
            const betSlip = document.querySelector('[data-testid="betslip-bet"]');
            const betlistScroll = document.querySelector('.betlist-scroll');
            
            // Multiple ways to find the green check SVG
            const greenCheckIcon = document.querySelector('[data-testid="betslip-bet"] svg[data-ds-icon="Check"]') ||
                                   document.querySelector('.betlist-scroll svg[data-ds-icon="Check"]') ||
                                   document.querySelector('svg[data-ds-icon="Check"]');
            
            // Secondary indicators - "Reuse Slip" and "Clear All" buttons appear after bet is placed
            const reuseSlipBtn = Array.from(document.querySelectorAll('button span, span')).find(el => 
                el.textContent.trim() === 'Reuse Slip'
            );
            const clearAllBtn = Array.from(document.querySelectorAll('button span, span')).find(el => 
                el.textContent.trim() === 'Clear All'
            );
            
            // Check if green checkmark SVG is visible (PRIMARY indicator of success)
            const hasGreenCheck = greenCheckIcon !== null;
            
            // Check for bet outcome label (confirms bet details are showing)
            const betOutcomeLabel = document.querySelector('[data-testid="bet-outcome-label"]');
            const betOddsPayoutEl = document.querySelector('[data-testid="betslip-odds-payout"]');
            
            // Success: Green checkmark SVG present in betslip area
            const isSuccess = hasGreenCheck && (betSlip || reuseSlipBtn || clearAllBtn || betlistScroll);
            
            if (isSuccess) {
                const endTime = Date.now();
                const duration = endTime - startTime;
                const durationSec = (duration / 1000).toFixed(2);
                
                // Extract bet details from the slip
                let actualPayout = null;
                let actualOdds = null;
                let outcomeTeam = null;
                
                const payoutEl = document.querySelector('[data-testid="single-bet-estimated-amount"]');
                if (payoutEl) {
                    const payoutMatch = payoutEl.textContent.match(/\$?([\d.]+)/);
                    if (payoutMatch) actualPayout = payoutMatch[1];
                }
                
                if (betOddsPayoutEl) {
                    const oddsMatch = betOddsPayoutEl.textContent.match(/([\d.]+)/);
                    if (oddsMatch) actualOdds = oddsMatch[1];
                }
                
                if (betOutcomeLabel) {
                    outcomeTeam = betOutcomeLabel.textContent.trim();
                }
                
                console.log(`[Auto] ✅ BET PLACED SUCCESSFULLY! (Green checkmark detected)`);
                console.log(`[Auto] Team: ${outcomeTeam || team}, Amount: $${amount}, Odds: ${actualOdds || odds}`);
                console.log(`[Auto] Executed in ${duration}ms (${durationSec}s)`);
                if (actualPayout) console.log(`[Auto] Est. Payout: $${actualPayout}`);
                
                // Send COMPLETED status with full details
                chrome.runtime.sendMessage({ 
                    action: "bet_placed_success", 
                    team: outcomeTeam || team, 
                    amount: amount, 
                    odds: actualOdds || odds,
                    duration: duration,
                    durationSec: durationSec,
                    payout: actualPayout,
                    status: "COMPLETED",
                    timestamp: new Date().toISOString()
                });
                
                // Visual feedback - highlight the successful betslip
                if (betSlip) {
                    betSlip.style.border = "3px solid #00e676";
                    betSlip.style.boxShadow = "0 0 15px #00e676";
                }
                if (greenCheckIcon) {
                    const parent = greenCheckIcon.closest('span');
                    if (parent) {
                        parent.style.transform = "scale(1.5)";
                        parent.style.transition = "transform 0.3s";
                    }
                }
            } else {
                // Keep checking - bet still processing
                setTimeout(() => verifyBetPlaced(team, amount, odds, startTime, attempts + 1), 200);
            }
        };
        
        // Function to check for bet warnings/errors on Stake (no alerts, send to TG)
        const checkBetWarnings = (team, amount, odds) => {
            setTimeout(() => {
                // Look for the warning/error message in system-message area
                const warningEl = document.querySelector('.system-message.info, .system-message, [class*="system-message"]');
                const warningText = warningEl ? warningEl.textContent.trim() : '';
                const pageText = document.body.innerText;
                
                // Check for insufficient balance error
                if (warningText.includes('cannot bet more than your balance') || 
                    pageText.includes('cannot bet more than your balance')) {
                    console.warn('[Auto] ⚠️ Insufficient balance detected!');
                    chrome.runtime.sendMessage({ 
                        action: "bet_error", 
                        error: "Insufficient Balance",
                        details: "You cannot bet more than your balance",
                        team: team,
                        amount: amount,
                        odds: odds
                    });
                    return;
                }
                
                // Check for minimum bet warning
                if (warningText.includes('Minimum bet amount') || pageText.includes('Minimum bet amount')) {
                    const minMatch = pageText.match(/Minimum bet amount is[^\d]*([\d.,]+)/i);
                    const minAmount = minMatch ? minMatch[1] : 'unknown';
                    
                    console.warn(`[Auto] ⚠️ Minimum bet warning: ${minAmount}`);
                    chrome.runtime.sendMessage({ 
                        action: "stake_min_bet_warning", 
                        team: team,
                        enteredAmount: amount,
                        minAmount: minAmount,
                        odds: odds
                    });
                    return;
                }
                
                // Check for any other warning message
                if (warningEl && warningText) {
                    console.warn(`[Auto] ⚠️ Warning detected: ${warningText}`);
                    chrome.runtime.sendMessage({ 
                        action: "bet_error", 
                        error: "Stake Warning",
                        details: warningText,
                        team: team,
                        amount: amount,
                        odds: odds
                    });
                }
            }, 500); // Check quickly for warnings
        };

        checkAndClick(0);
    }
});

let isEnabled = true;
let observer = null;

// Initialize
chrome.storage.local.get(['isEnabled', 'liveScanEnabled'], (result) => {
    isEnabled = result.isEnabled !== false; // Default true
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
