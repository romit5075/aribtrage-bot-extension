importScripts('arbitrageLogic.js');

// 1. Listen for Messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "start_monitoring") {
        const newState = {
            active: true,
            tabId: request.tabId,
            targetUrl: request.url,
            scanType: request.type
        };

        // Persist state
        chrome.storage.local.set({ monitoringState: newState, lastScanTime: Date.now() }, () => {
            // Start the alarm loop
            chrome.alarms.create("monitorRefresher", { periodInMinutes: 1 / 6 }); // 10s
            // Immediate check
            checkAndRefresh(newState);
            sendResponse({ status: "started", state: newState });
        });
        return true; // async response
    }

    if (request.action === "stop_monitoring") {
        chrome.storage.local.remove(['monitoringState'], () => {
            chrome.alarms.clear("monitorRefresher");
            sendResponse({ status: "stopped" });
        });
        return true;
    }

    if (request.action === "data_updated") {
        // Data just came in from a scrape
        handleNewData(request.data);
    }

    if (request.action === "get_monitoring_status") {
        chrome.storage.local.get(['monitoringState'], (res) => {
            sendResponse({ active: res.monitoringState && res.monitoringState.active });
        });
        return true;
    }
});

// 2. Alarm Handler
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "monitorRefresher") {
        chrome.storage.local.get(['monitoringState'], (res) => {
            if (res.monitoringState && res.monitoringState.active) {
                checkAndRefresh(res.monitoringState);
            }
        });
    }
});

// 3. Refresh Logic

function checkAndRefresh(state) {
    if (!state.active || !state.tabId) return;

    // Check if tab still exists
    chrome.tabs.get(state.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
            console.log("Tab lost, stopping monitor");
            state.active = false;
            chrome.storage.local.set({ monitoringState: state });
            chrome.alarms.clear("monitorRefresher");
            return;
        }

        // Injected Scraper Function
        // This runs inside the tab's context
        function injectedScraper() {
            const data = { type: 'unknown', odds: [] };

            // --- Helper to parse odds ---
            const parsePolyOdds = (str) => {
                if (!str) return null;
                if (str.toLowerCase().includes('suspended')) return 'Suspended';
                const match = str.match(/(\d+)\s*¢/);
                if (match) {
                    const cents = parseInt(match[1], 10);
                    return cents > 0 ? (100 / cents).toFixed(2) : null;
                }
                return null;
            };

            const parseStakeOdds = (str) => {
                if (!str) return null;
                // Stake sometimes implies suspension by greying out or showing lock, but if text says Suspended:
                if (str.toLowerCase().includes('suspended') || str.toLowerCase().includes('unavailable')) return 'Suspended';
                const match = str.match(/(\d+(\.\d+)?)/);
                return match ? parseFloat(match[1]) : null;
            };

            // 1. Polymarket Scraper
            const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
            if (polyButtons.length > 0) {
                data.type = 'polymarket';
                polyButtons.forEach(btn => {
                    let team = 'UNKNOWN';
                    // Try to find team name container
                    const teamNode = btn.querySelector('.opacity-70'); // Common poly class
                    if (teamNode) {
                        team = teamNode.textContent.trim().toUpperCase();
                    } else {
                        // Fallback text
                        const txt = btn.textContent.trim();
                        // Heuristic: usually starts with team code if not separated
                        const match = txt.match(/^([A-Z]{3})/);
                        if (match) team = match[1];
                    }

                    // For the odds text, we clone to ignore our own injected tags if any
                    const clone = btn.cloneNode(true);
                    const tags = clone.querySelectorAll('.odds-converted-tag');
                    tags.forEach(t => t.remove());
                    const teamEl = clone.querySelector('.opacity-70');
                    if (teamEl) teamEl.remove();

                    const rawText = clone.textContent.trim();
                    const odds = parsePolyOdds(rawText);

                    if (team !== 'UNKNOWN' && odds) {
                        data.odds.push({ team, odds: odds === 'Suspended' ? 'Suspended' : parseFloat(odds), source: 'Poly' });
                    }
                });
            }

            // 2. Stake/SX Scraper
            // Use fallback if Poly not found
            if (data.odds.length === 0) {
                const stackItems = document.querySelectorAll('.outcome-content');
                if (stackItems.length > 0) {
                    data.type = 'stack';
                    stackItems.forEach(item => {
                        const nameEl = item.querySelector('[data-testid="outcome-button-name"]');
                        const oddsContainer = item.querySelector('[data-testid="fixture-odds"]');

                        const team = nameEl ? nameEl.textContent.trim().toUpperCase() : 'UNKNOWN';
                        let odds = null;

                        // Check container text for suspended or value
                        if (oddsContainer) {
                            odds = parseStakeOdds(oddsContainer.textContent);
                        } else {
                            // If no odds container, might be suspended or disabled
                            // Check if parent button is disabled?
                            const btn = item.closest('button');
                            if (btn && btn.disabled) odds = 'Suspended';
                        }

                        if (team !== 'UNKNOWN' && odds) {
                            // Handle pure float vs string 'Suspended'
                            const finalOdds = (odds === 'Suspended') ? 'Suspended' : parseFloat(odds);
                            if (finalOdds === 'Suspended' || !isNaN(finalOdds)) {
                                data.odds.push({ team, odds: finalOdds, source: 'Stack' });
                            }
                        }
                    });
                }
            }
            return data;
        }

        // Execute
        chrome.scripting.executeScript({
            target: { tabId: state.tabId, allFrames: true },
            func: injectedScraper
        }, (results) => {
            if (chrome.runtime.lastError) {
                console.log("Script execution failed:", chrome.runtime.lastError);
                return;
            }

            if (results && results.length > 0) {
                // Find best data
                let bestData = null;
                for (const res of results) {
                    if (res.result && res.result.odds && res.result.odds.length > 0) {
                        if (res.result.type === state.scanType) {
                            bestData = res.result;
                            break;
                        }
                        if (!bestData) bestData = res.result;
                    }
                }

                if (bestData) {
                    chrome.storage.local.set({ lastScanTime: Date.now() });
                    handleNewData(bestData);
                }
            }
        });
    });
}

// 4. Data Processing
function handleNewData(newData) {
    chrome.storage.local.get(['monitoringState', 'polymarketData', 'stackData', 'strictMatch'], (result) => {
        // Verification: Only process if monitoring is active? 
        // Or process anyway if data comes in? 
        // Let's enforce monitoring active to avoid noise?
        // Actually, if we get data, we should check it.

        let poly = result.polymarketData;
        let stack = result.stackData;
        const strictMatch = result.strictMatch === true;

        // Update stored data with fresh data
        if (newData.type === 'polymarket') {
            poly = newData;
            chrome.storage.local.set({ polymarketData: newData });
        } else if (newData.type === 'stack') {
            stack = newData;
            chrome.storage.local.set({ stackData: newData });
        }

        if (poly && stack && poly.odds && stack.odds) {
            const opportunities = ArbitrageCalculator.findOpportunities(poly.odds, stack.odds, strictMatch);

            if (opportunities.length > 0) {
                // Determine if we should notify
                // If monitoring is active, definitely notify.
                if (result.monitoringState && result.monitoringState.active) {

                    // 1. Prepare Highlight Targets
                    // Extract the specific teams that are part of the winning bet
                    const targets = [];
                    opportunities.forEach(op => {
                        // op.betOn is string "TeamA (Poly) / TeamB (Stack)"
                        // We need to parse back or modify FindOpportunities to return structured data.
                        // For now, let's look at the structure returned by ArbitrageCalculator.
                        // actually wait, ArbitrageCalculator returns:
                        // { match, betOn, odds, profit, type, ... }

                        // Let's rely on betOn string parsing for now as valid quick fix
                        // Format: "TeanA (Poly) / TeamB (Stack)"
                        const parts = op.betOn.split(' / ');
                        if (parts.length === 2) {
                            const p1 = parts[0].match(/(.*) \((.*)\)/);
                            const p2 = parts[1].match(/(.*) \((.*)\)/);

                            if (p1) targets.push({ team: p1[1].trim(), type: p1[2].toLowerCase() === 'poly' ? 'polymarket' : 'stack' });
                            if (p2) targets.push({ team: p2[1].trim(), type: p2[2].toLowerCase() === 'poly' ? 'polymarket' : 'stack' });
                        }
                    });

                    // 2. Broadcast Highlighting to likely tabs
                    // We send to the monitored tab
                    if (targets.length > 0) {
                        try {
                            // Send to monitored tab
                            chrome.tabs.sendMessage(result.monitoringState.tabId, { action: "highlight_odds", targets: targets });

                            // Also try sending based on active tab query to be safe if ID changed
                            chrome.tabs.query({ active: true }, (tabs) => {
                                tabs.forEach(t => {
                                    chrome.tabs.sendMessage(t.id, { action: "highlight_odds", targets: targets });
                                });
                            });
                        } catch (e) {
                            console.error("Highlight send failed", e);
                        }
                    }

                    // NOTIFY
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icon.png',
                        title: 'Arbitrage Opportunity Found!',
                        message: `${opportunities.length} opportunities detected. Max Profit: ${opportunities[0].profit.toFixed(2)}%`,
                        priority: 2
                    });

                    // PLAY SOUND
                    chrome.tabs.sendMessage(result.monitoringState.tabId, { action: "play_sound" });

                    // LOG TO FILE
                    opportunities.forEach(op => ArbitrageLogger.logPositive(op));
                }
            }
        }
    });
}
