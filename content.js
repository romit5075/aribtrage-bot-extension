// Expose to window
window.scrapePageData = scrapePageData;

// Debug function to see what's being scraped
window.debugScrape = function () {
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
        const lower = str.toLowerCase();
        if (lower.includes('suspended')) return 'Suspended';
        if (lower.includes('settled')) return 'Settled';

        // 1. Try Cents with symbol (e.g. 78¢) - STRICT for Settled check
        const matchCents = str.match(/(\d+)\s*¢/);
        if (matchCents) {
            const cents = parseInt(matchCents[1], 10);
            if (cents >= 100) return 'Settled'; // Explicit cents >= 100 is Settled
            return cents > 0 ? (100 / cents).toFixed(2) : null;
        }

        // 2. Try Decimal (e.g. 1.28, 105.0)
        const matchDecimal = str.match(/(\d+\.\d+)/);
        if (matchDecimal) {
            const val = parseFloat(matchDecimal[1]);
            // Allow decimal odds > 100 as requested
            if (val >= 1.01) {
                return val;
            }
        }

        // 3. Try plain integer
        const matchInt = str.match(/^(\d+)$/);
        if (matchInt) {
            const val = parseInt(matchInt[1], 10);
            // If >= 100, assume it is Decimal Odds (e.g. 150), unless it has ¢ symbol (handled above)
            if (val >= 100) return val;

            // If < 100, assume it is Cents (e.g. 52 -> 52¢)
            if (val > 0) return (100 / val).toFixed(2);
        }

        return null;
    };

    const parseStakeOdds = (str) => {
        if (!str) return null;
        if (str.toLowerCase().includes('suspended') || str.toLowerCase().includes('unavailable')) return 'Suspended';
        const match = str.match(/(\d+(\.\d+)?)/);
        return match ? parseFloat(match[1]) : null;
    };

    // Time Parser - Returns normalized timestamp string "YYYY-MM-DD HH:MM"
    const parseEventTime = (dateStr, timeStr) => {
        try {
            if (!dateStr && !timeStr) return null;

            // Normalize date: "Fri, Dec 26" or "Thu, December 25" -> "Dec 26"
            let dBase = (dateStr || '').replace(/^[A-Za-z]+,\s*/, '').trim();
            dBase = dBase.replace('December', 'Dec').replace('January', 'Jan').replace('February', 'Feb');

            // Normalize time: "6:30 AM" -> "06:30"
            let tNorm = (timeStr || '').trim();
            const timeMatch = tNorm.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
            if (timeMatch) {
                let h = parseInt(timeMatch[1]);
                const m = timeMatch[2];
                const ampm = (timeMatch[3] || '').toUpperCase();
                if (ampm === 'PM' && h < 12) h += 12;
                if (ampm === 'AM' && h === 12) h = 0;
                tNorm = `${h.toString().padStart(2, '0')}:${m}`;
            }

            // Assume current year
            const year = new Date().getFullYear();
            return `${year}-${dBase} ${tNorm}`.trim();
        } catch (e) { return null; }
    };

    // NBA City/Team Mappings for fuzzy match
    const NBA_CITY_MAPPINGS = {
        'ROCKETS': ['HOUSTON ROCKETS', 'HOUSTON', 'HOU'],
        'LAKERS': ['LOS ANGELES LAKERS', 'LA LAKERS', 'LAL', 'LOS ANGELES'],
        'KNICKS': ['NEW YORK KNICKS', 'NY KNICKS', 'NYK', 'NEW YORK'],
        'CAVALIERS': ['CLEVELAND CAVALIERS', 'CLEVELAND', 'CLE', 'CAVS'],
        'CELTICS': ['BOSTON CELTICS', 'BOSTON', 'BOS'],
        'WARRIORS': ['GOLDEN STATE WARRIORS', 'GOLDEN STATE', 'GSW', 'GS'],
        'MAVERICKS': ['DALLAS MAVERICKS', 'DALLAS', 'DAL', 'MAVS'],
        'SPURS': ['SAN ANTONIO SPURS', 'SAN ANTONIO', 'SAS'],
        'THUNDER': ['OKLAHOMA CITY THUNDER', 'OKC', 'OKLAHOMA CITY'],
        'SUNS': ['PHOENIX SUNS', 'PHOENIX', 'PHX'],
        'BUCKS': ['MILWAUKEE BUCKS', 'MILWAUKEE', 'MIL'],
        'HEAT': ['MIAMI HEAT', 'MIAMI', 'MIA'],
        'BULLS': ['CHICAGO BULLS', 'CHICAGO', 'CHI'],
        'NETS': ['BROOKLYN NETS', 'BROOKLYN', 'BKN'],
        '76ERS': ['PHILADELPHIA 76ERS', 'PHILLY', 'PHI', 'SIXERS'],
        'RAPTORS': ['TORONTO RAPTORS', 'TORONTO', 'TOR'],
        'HAWKS': ['ATLANTA HAWKS', 'ATLANTA', 'ATL'],
        'HORNETS': ['CHARLOTTE HORNETS', 'CHARLOTTE', 'CHA'],
        'WIZARDS': ['WASHINGTON WIZARDS', 'WASHINGTON', 'WAS'],
        'MAGIC': ['ORLANDO MAGIC', 'ORLANDO', 'ORL'],
        'PACERS': ['INDIANA PACERS', 'INDIANA', 'IND'],
        'PISTONS': ['DETROIT PISTONS', 'DETROIT', 'DET'],
        'CLIPPERS': ['LA CLIPPERS', 'LOS ANGELES CLIPPERS', 'LAC'],
        'KINGS': ['SACRAMENTO KINGS', 'SACRAMENTO', 'SAC'],
        'TRAIL BLAZERS': ['PORTLAND TRAIL BLAZERS', 'PORTLAND', 'POR', 'BLAZERS'],
        'JAZZ': ['UTAH JAZZ', 'UTAH', 'UTA'],
        'NUGGETS': ['DENVER NUGGETS', 'DENVER', 'DEN'],
        'TIMBERWOLVES': ['MINNESOTA TIMBERWOLVES', 'MINNESOTA', 'MIN', 'WOLVES'],
        'PELICANS': ['NEW ORLEANS PELICANS', 'NEW ORLEANS', 'NOP'],
        'GRIZZLIES': ['MEMPHIS GRIZZLIES', 'MEMPHIS', 'MEM']
    };

    // 1. Polymarket Scraper
    // Track current date from date headers (they appear before event containers)
    let polyCurrentDate = null;

    // First pass: Collect all date headers
    document.querySelectorAll('[data-item-index]').forEach(item => {
        const dateP = item.querySelector('p.font-semibold');
        if (dateP) {
            const text = dateP.textContent.trim();
            // Check if this looks like a date (e.g., "Thu, December 25")
            if (/[A-Za-z]+,?\s*[A-Za-z]+\s*\d{1,2}/.test(text)) {
                polyCurrentDate = text;
            }
        }
    });

    // Group by match/event container first
    const polyMarketContainers = document.querySelectorAll('a[href*="/event/"]');
    if (polyMarketContainers.length > 0) {
        data.type = 'polymarket';

        polyMarketContainers.forEach(container => {
            const buttons = container.querySelectorAll('button.trading-button, button[class*="trading-button"]');
            const matchTeams = [];

            // Extract matchId from the container link (unique per event)
            const matchLink = container.href || '';
            const matchIdMatch = matchLink.match(/\/event\/([^/?#]+)/);
            const matchId = matchIdMatch ? matchIdMatch[1] : null;

            // Detect LIVE game
            let isLive = false;
            const liveIndicator = container.querySelector('.text-red-500, [class*="text-red"], [class*="uppercase"]');
            if (liveIndicator && /live/i.test(liveIndicator.textContent)) {
                isLive = true;
            }

            // Extract time from the container (e.g., "10:30 PM")
            let eventTime = null;
            const timeP = container.querySelector('.text-xs.text-text-primary, p[class*="text-text-primary"]');
            if (timeP) {
                const timeText = timeP.textContent.trim();
                if (/\d{1,2}:\d{2}\s*(AM|PM)?/i.test(timeText)) {
                    eventTime = parseEventTime(polyCurrentDate, timeText);
                }
            }

            // If live, set eventTime to "LIVE" for matching purposes
            if (isLive) {
                eventTime = 'LIVE';
            }

            // Try to extract date from nearest parent/sibling if not set
            if (!polyCurrentDate && !isLive) {
                let el = container.previousElementSibling;
                while (el) {
                    const dateP = el.querySelector('p.font-semibold');
                    if (dateP && /[A-Za-z]+,?\s*[A-Za-z]+\s*\d{1,2}/.test(dateP.textContent)) {
                        polyCurrentDate = dateP.textContent.trim();
                        eventTime = parseEventTime(polyCurrentDate, eventTime);
                        break;
                    }
                    el = el.previousElementSibling;
                }
            }

            // Try to get full team names from the row/container (not just button labels)
            const fullTeamNames = [];

            // Look for team name elements in the container (outside buttons)
            const textNodes = container.querySelectorAll('span, div, p');
            textNodes.forEach(node => {
                if (node.closest('button')) return;

                const text = node.textContent.trim();
                if (text.length >= 3 &&
                    !/^(LIVE|Game \d|Best of \d|\$[\d.]+k|Vol\.|Game View|Load More|\d+)$/i.test(text) &&
                    !/^\d+\.\d+$/.test(text) &&
                    !text.includes('¢')) {

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
                if (shortName && fullTeamNames.length > 0) {
                    for (const fullName of fullTeamNames) {
                        if (fullName.startsWith(shortName) ||
                            fullName.includes(shortName + ' ') ||
                            fullName.split(/\s+/)[0] === shortName) {
                            fullTeam = fullName;
                            break;
                        }
                    }
                }

                if (fullTeam) {
                    team = fullTeam;
                }

                // Get odds
                let odds = null;
                const oddsSpan = btn.querySelector('.ml-1, [class*="ml-1"]');
                if (oddsSpan) {
                    const oddsText = oddsSpan.textContent.trim();
                    odds = parsePolyOdds(oddsText);
                }

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
                    // DEDUPLICATION: Check if we already have this team from this link/source
                    const exists = matchTeams.some(x => x.team === team && x.odds === (odds === 'Suspended' ? 'Suspended' : parseFloat(odds)));
                    if (!exists) {
                        matchTeams.push({
                            team,
                            odds: odds === 'Suspended' ? 'Suspended' : parseFloat(odds),
                            source: 'Poly',
                            link: container.href || window.location.href,
                            id: btn.id,
                            eventTime: eventTime,
                            matchId: matchId,
                            isLive: isLive
                        });
                    }
                }
            });

            matchTeams.forEach(t => data.odds.push(t));
        });
    }

    // Fallback: Group by parent container if strict containers match failed
    if (data.odds.length === 0) {
        // Try to find list items or rows that contain trading buttons
        const potentialRows = document.querySelectorAll('li, div.gap-2, div.grid');

        let foundViaRows = false;
        if (potentialRows.length > 0) {
            potentialRows.forEach((row, idx) => {
                const buttons = row.querySelectorAll('button.trading-button, button[class*="trading-button"]');
                if (buttons.length >= 2) {
                    foundViaRows = true;
                    // Treat this row as a group/match
                    // Generate a pseudo-link ID for grouping
                    const pseudoLink = window.location.href + `#group-${idx}`;

                    // Try to find date/time in this row or previous sibling
                    let eventTime = null;
                    let isLive = false;

                    // Simple Live check
                    if (row.textContent.includes('Live')) isLive = true;
                    if (isLive) eventTime = 'LIVE';

                    buttons.forEach(btn => {
                        let team = 'UNKNOWN';
                        const teamNode = btn.querySelector('.opacity-70');
                        if (teamNode) {
                            team = teamNode.textContent.trim().toUpperCase()
                                .replace(/\d+\.\d+/g, '').replace(/\d+¢/g, '').replace(/\s+\d{1,3}$/g, '').trim();
                        }

                        let odds = null;
                        const oddsSpan = btn.querySelector('.ml-1, [class*="ml-1"]');
                        if (oddsSpan) odds = parsePolyOdds(oddsSpan.textContent.trim());

                        if (team && odds) {
                            data.odds.push({
                                team,
                                odds: odds === 'Suspended' ? 'Suspended' : parseFloat(odds),
                                source: 'Poly',
                                link: pseudoLink, // Use pseudo-link for grouping
                                matchId: `group-${idx}`,
                                isLive: isLive,
                                eventTime: eventTime
                            });
                        }
                    });
                }
            });
        }

        if (!foundViaRows) {
            // Last resort: Original button-based scraper (flat list)
            const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
            if (polyButtons.length > 0) {
                // ... original logic ...
                data.type = 'polymarket';
                polyButtons.forEach(btn => {
                    let team = 'UNKNOWN';
                    // ... existing extraction ...


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
                            id: btn.id,
                            matchId: 'fallback-flat', // Flat fallback has no match grouping
                            eventTime: null // No time info in fallback
                        });
                    }
                });
            }
        }
    }     // 2. Stake/SX Scraper
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

                // Time Extraction - Parse date and time from fixture-details
                const fixture = item.closest('[data-testid="fixture-preview"]');
                let eventTime = null;
                let isLive = false;
                let matchId = null;

                if (fixture) {
                    const fixtureDetails = fixture.querySelector('.fixture-details');
                    if (fixtureDetails) {
                        // Detect LIVE game
                        const liveBadge = fixtureDetails.querySelector('[class*="variant-live"], .badge');
                        if (liveBadge && /live/i.test(liveBadge.textContent)) {
                            isLive = true;
                            eventTime = 'LIVE';
                        } else {
                            // Extract separate date and time
                            const spans = fixtureDetails.querySelectorAll('span[data-ds-text]');
                            let dateStr = '';
                            let timeStr = '';
                            spans.forEach(sp => {
                                const txt = sp.textContent.trim();
                                if (/[A-Za-z]+,?\s*[A-Za-z]+\s*\d{1,2}/.test(txt)) {
                                    dateStr = txt;
                                } else if (/\d{1,2}:\d{2}\s*(AM|PM)?/i.test(txt)) {
                                    timeStr = txt;
                                }
                            });
                            eventTime = parseEventTime(dateStr, timeStr);
                        }
                    }

                    // Extract matchId from fixture link
                    const fixtureLink = fixture.querySelector('a[href*="/fixture/"]');
                    if (fixtureLink) {
                        const urlMatch = fixtureLink.href.match(/\/fixture\/([^/?#]+)/);
                        if (urlMatch) matchId = urlMatch[1];
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
                            eventTime: eventTime,
                            link: link,
                            matchId: matchId,
                            isLive: isLive
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
        const targets = request.targets || []; // Array of { team, type, color, index } 
        // type: 'polymarket' or 'stack'

        // Remove old highlights
        document.querySelectorAll('.arb-highlight-box').forEach(el => {
            el.style.border = '';
            el.style.position = '';
            // Remove badge if exists
            const badge = el.querySelector('.arb-badge');
            if (badge) badge.remove();
            el.classList.remove('arb-highlight-box');
        });

        // Highlight new targets
        targets.forEach(tgt => {
            const borderStyle = `5px solid ${tgt.color || '#e65100'}`;
            const badgeHtml = tgt.index ? `<div class="arb-badge" style="position:absolute; top:-8px; left:-8px; background:${tgt.color || '#e65100'}; color:white; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:10px; z-index:1000;">#${tgt.index}</div>` : '';

            // Logic to find and highlight in DOM
            if (tgt.type === 'stack') {
                const stackItems = document.querySelectorAll('.outcome-content');
                stackItems.forEach(item => {
                    let match = false;
                    // 1. Try Link Match (Precise)
                    if (tgt.link) {
                        const linkEl = item.closest('a');
                        if (linkEl && linkEl.href === tgt.link) match = true;
                    }
                    // 2. Fallback to Name Match
                    if (!match) {
                        const nameEl = item.querySelector('[data-testid="outcome-button-name"]');
                        if (nameEl) {
                            const teamName = nameEl.textContent.trim().toUpperCase();
                            if (teamName.includes(tgt.team) || tgt.team.includes(teamName)) match = true;
                        }
                    }

                    if (match) {
                        const container = item.closest('button');
                        if (container) {
                            container.classList.add('arb-highlight-box');
                            container.style.border = borderStyle;
                            container.style.position = 'relative';
                            if (tgt.index) container.insertAdjacentHTML('beforeend', badgeHtml);
                        }
                    }
                });
            } else if (tgt.type === 'polymarket') {
                const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
                polyButtons.forEach(btn => {
                    let match = false;
                    // 1. Try Link Match (Precise)
                    if (tgt.link) {
                        const linkEl = btn.closest('a');
                        if (linkEl && linkEl.href === tgt.link) match = true;
                    }
                    // 2. Fallback to Name Match
                    if (!match) {
                        const txt = btn.textContent.trim().toUpperCase();
                        if (txt.includes(tgt.team)) match = true;
                    }

                    if (match) {
                        // Use box-shadow for persistent visibility on complex buttons
                        btn.classList.add('arb-highlight-box');
                        btn.style.setProperty('border', borderStyle, 'important');
                        btn.style.setProperty('box-shadow', `inset 0 0 0 4px ${tgt.color || '#e65100'}`, 'important');
                        btn.style.position = 'relative';
                        // Force overflow visible so badge can pop out
                        btn.style.overflow = 'visible';
                        btn.style.zIndex = '10';
                        if (tgt.index) btn.insertAdjacentHTML('beforeend', badgeHtml);
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
                // If we found the button but odds were wrong, alert user.
                // If we never found button, maybe just log.
                alert(`Auto-Bet Stopped: Odds mismatch or Element not found after ${retryLimit} retries.`);
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
            const attempt = (n) => {
                if (n > 20) return;
                const input = document.querySelector('input[data-testid="input-bet-amount"]');
                const placeBtn = document.querySelector('button[data-testid="betSlip-place-bets-button"]');
                if (input && placeBtn) {
                    input.focus();
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                    nativeSetter.call(input, amount || "0.01");
                    input.dispatchEvent(new Event('input', { bubbles: true }));

                    setTimeout(() => {
                        // Check for minimum bet warning
                        checkMinBetWarning(targetTeam, amount, expectedOdds);

                        placeBtn.style.border = "4px solid #e91e63"; // Highlight "Place Bet"
                        // Send success message
                        chrome.runtime.sendMessage({ action: "bet_placed_success", team: targetTeam, amount: amount, odds: expectedOdds });
                    }, 500);
                } else setTimeout(() => attempt(n + 1), 250);
            };
            attempt(0);
        };

        // Function to check for minimum bet warning on Stake
        const checkMinBetWarning = (team, amount, odds) => {
            setTimeout(() => {
                // Look for the warning message
                const warningEl = document.querySelector('.system-message.info, [class*="system-message"]');
                const pageText = document.body.innerText;

                if (warningEl || pageText.includes('Minimum bet amount')) {
                    // Extract minimum amount if possible
                    const minMatch = pageText.match(/Minimum bet amount is[^\d]*([\d.,]+)/i);
                    const minAmount = minMatch ? minMatch[1] : 'unknown';

                    const message = `[WARNING] *Stake Minimum Bet Warning*\n\n` +
                        `Team: ${team}\n` +
                        `Entered: ${amount}\n` +
                        `Minimum Required: ₹${minAmount}\n` +
                        `Odds: ${odds}`;

                    // Send to background to forward to TG
                    chrome.runtime.sendMessage({
                        action: "stake_min_bet_warning",
                        team: team,
                        enteredAmount: amount,
                        minAmount: minAmount,
                        odds: odds,
                        message: message
                    });

                    // Show alert popup
                    alert(`[WARNING] Stake Minimum Bet Warning!\n\nMinimum bet is ₹${minAmount}\nYou entered: ${amount}`);
                }
            }, 800); // Wait for warning to appear
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
if (request.action === "click_bet_button") {
    const { id, team, amount, expectedOdds } = request;
    console.log(`[Auto] Received click command for ${team} (ID: ${id})`);

    // Helper to simulate React input change
    const setNativeValue = (element, value) => {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

        if (valueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else {
            valueSetter.call(element, value);
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const attemptFill = (retries = 10) => {
        const input = document.getElementById('market-order-amount-input');
        if (input) {
            console.log("[Auto] Found amount input, filling:", amount);
            input.focus();
            setNativeValue(input, amount.toString());
            input.blur(); // Trigger validation

            // Check for errors after short delay
            setTimeout(() => {
                const errorMsg = document.querySelector('.text-orange-500, .text-red-500');
                if (errorMsg && errorMsg.textContent.includes('greater than $1')) {
                    console.warn("[Auto] Bet too small/error:", errorMsg.textContent);
                    // Optional: Alert or feedback
                }

                // Verify Odds on page match expectation?
                // We can check the buy button text or similar
            }, 500);

        } else if (retries > 0) {
            setTimeout(() => attemptFill(retries - 1), 500);
        } else {
            console.warn("[Auto] Input field not found after retries.");
        }
    };

    // 1. Find and Click Button
    let btn = null;
    if (id) btn = document.getElementById(id); // Best case

    if (!btn) {
        // Fallback to text matching
        const buttons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
        for (const b of buttons) {
            if (b.textContent.toUpperCase().includes(team.toUpperCase())) {
                btn = b;
                break;
            }
        }
    }

    if (btn) {
        console.log("[Auto] Clicking button:", btn);
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.click();
        // Start waiting for input
        attemptFill();
        sendResponse({ status: "clicked" });
    } else {
        console.error("[Auto] Button not found for:", team);
        sendResponse({ status: "error", message: "Button not found" });
    }
}
