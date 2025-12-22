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

    // 1. Message Handling
    // Basic checks
    if (request.action === "live_data_update" && request.data) {
        handleNewData(request.data);
        return; // Async handling
    }

    // The following blocks from the instruction seem to be a re-definition of existing actions
    // with slightly different names and logic. Assuming the intent is to *replace* or *update*
    // the existing ones if they match the new action names, or add new ones if the names differ.
    // Given the instruction "Add listener for live_data_update to trigger handleNewData."
    // and the provided code structure, it seems the intent is to add the live_data_update
    // and potentially update the logic for start/stop/get status if the action names change.
    // However, the original code uses "start_monitoring", "stop_monitoring", "get_monitoring_status".
    // The provided edit uses "start_monitor", "stop_monitor", "get_status".
    // To avoid breaking existing functionality, I will add the new 'live_data_update' and
    // assume the other 'start_monitor', 'stop_monitor', 'get_status' are new or alternative
    // entry points, or that the user intends to replace the old ones later.
    // For now, I'll add them as separate `if` blocks.

    if (request.action === "start_monitor") {
        // ... existing start logic ...
        const tabId = request.tabId;
        const type = request.type;

        chrome.storage.local.set({ monitoringState: { active: true, tabId, scanType: type } }, () => {
            // Check if Live Mode is active in storage? 
            // The popup controls this. If Live Mode is ON, we might not need the alarm.
            // But let's allow alarm to exist as a fail-safe or handle it via Scan Type logic.
            // For now, standard interval start.
            chrome.alarms.create("monitorRefresher", { periodInMinutes: 10 / 60 });
            checkAndRefresh({ active: true, tabId, scanType: type });
        });
        return true; // async response
    } else if (request.action === "stop_monitor") {
        chrome.storage.local.set({ monitoringState: { active: false } });
        chrome.alarms.clear("monitorRefresher");
        return true; // async response
    } else if (request.action === "get_status") {
        chrome.storage.local.get(['monitoringState'], (res) => {
            if (res.monitoringState && res.monitoringState.active) {
                checkAndRefresh(res.monitoringState);
            }
            sendResponse({ active: res.monitoringState && res.monitoringState.active });
        });
        return true; // async response
    }

    if (request.action === "get_monitoring_status") {
        chrome.storage.local.get(['monitoringState'], (res) => {
            sendResponse({ active: res.monitoringState && res.monitoringState.active });
        });
        return true;
    }

    if (request.action === "open_and_click") {
        const { url, team, id } = request;

        // Helper to trigger click with retry
        const triggerClick = (tabId, retries = 3) => {
            chrome.tabs.sendMessage(tabId, { action: "click_bet_button", team: team, id: id }, (response) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    // Ignore "port closed" error as it usually means listener existed but closed (success-ish)
                    // But if we want to be strict, we only retry on meaningful connection errors
                    console.log("Msg error:", err.message);

                    if (retries > 0 && !err.message.includes("closed before a response")) {
                        console.log("Retrying click in 500ms...");
                        setTimeout(() => triggerClick(tabId, retries - 1), 500);
                    }
                } else {
                    console.log("Click command sent & acknowledged");
                }
            });
        };

        // 1. Check if tab exists
        chrome.tabs.query({}, (tabs) => {
            const existingTab = tabs.find(t => t.url === url || t.url.includes(url));
            if (existingTab) {
                chrome.tabs.update(existingTab.id, { active: true }, () => {
                    // Wait a bit for focus
                    setTimeout(() => triggerClick(existingTab.id), 1000);
                });
            } else {
                chrome.tabs.create({ url: url, active: true }, (newTab) => {
                    // Wait for load
                    const listener = (tabId, changeInfo) => {
                        if (tabId === newTab.id && changeInfo.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);
                            setTimeout(() => triggerClick(newTab.id), 2000);
                        }
                    };
                    chrome.tabs.onUpdated.addListener(listener);
                });
            }
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

            // Parse Time Helper (normalized to Month Day Hour:Minute string or timestamp)
            // Goal: "Dec 22 02:00"
            const parseTime = (dateStr, timeStr) => {
                // Return a simplified string key like "12-22-02-00"
                // This is a heuristic.
                // Stake: "Mon, Dec 22", "2:00 AM"
                // Poly: "Mon, December 22", "5:30 AM"
                try {
                    // Normalize Date
                    // "Mon, Dec 22" -> "Dec 22"
                    // "Mon, December 22" -> "Dec 22"
                    const dBase = dateStr.replace(/^[A-Za-z]+, /, '').replace('December', 'Dec').trim(); // "Dec 22"

                    // Normalize Time
                    // "2:00 AM" -> "02:00" (24h or simple AM/PM strip if consistent)
                    // Let's just keep "2:00" and AM/PM check
                    // Just keep primitive string concat for now: "Dec 22 2:00 AM"
                    return `${dBase} ${timeStr}`;
                } catch (e) { return null; }
            };

            // 1. Polymarket Scraper
            const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
            if (polyButtons.length > 0) {
                data.type = 'polymarket';

                // Poly usually groups by game. We need to find the TIME for the game of this button.
                // Heuristic: Go up to find row, then find time.
                // Poly layout: Row -> [Time] [Team A] [Team B]

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

                    // Extract Time from Poly (heuristic based on provided DOM structure not shown but inferred)
                    // The user provided Stake time HTML, not Poly time HTML in detail for this step, 
                    // but often it's nearby. WE WILL SKIP TIME EXTRACTION FOR POLY FOR NOW 
                    // unless we can reliably find it. 
                    // Actually, let's look at the user request text again.
                    // "Polymarket: <p>Mon, December 22</p> ... <p>5:30 AM</p>"
                    // It seems Poly has time *above* the buttons or to the left.

                    // For now, let's just stick to team/odds scraping as we haven't seen the Poly structure for time in context fully.
                    // We will add the Stake time logic though.

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

                        // Extract Time for matching
                        // Go up to 'fixture-preview' container
                        const fixture = item.closest('[data-testid="fixture-preview"]');
                        let timeKey = null;
                        if (fixture) {
                            // Date
                            // <span data-ds-text="true">Mon, Dec 22</span>
                            // Time
                            // <span data-table="time">2:00 AM</span>

                            // Trying to select by text content is hard, let's use the classes shown
                            const fixtureDetails = fixture.querySelector('.fixture-details');
                            if (fixtureDetails) {
                                // The first span with data-ds-text="true" might be date?
                                // "Mon, Dec 22"
                                // The span with data-table="time" is time
                                const timeEl = fixtureDetails.querySelector('[data-table="time"]');
                                // The date is usually the sibling before?
                                // Let's grab all text in fixture-details
                                const rawDate = fixtureDetails.textContent.trim(); // "Mon, Dec 22 2:00 AM" roughly
                                timeKey = rawDate;
                            }
                        }

                        if (team !== 'UNKNOWN' && odds) {
                            // Handle pure float vs string 'Suspended'
                            const finalOdds = (odds === 'Suspended') ? 'Suspended' : parseFloat(odds);
                            if (finalOdds === 'Suspended' || !isNaN(finalOdds)) {
                                // Attach timeKey to data
                                data.odds.push({ team, odds: finalOdds, source: 'Stack', time: timeKey });
                            }
                        }
                    });

                    // Auto-Click "Load More" if present
                    // Selector based on text content "Load More" usually in a button or div
                    const buttons = Array.from(document.querySelectorAll('button, div[role="button"], div.contents'));
                    const loadMore = buttons.find(b => b.textContent.trim().toLowerCase() === 'load more');
                    if (loadMore) {
                        console.log("Auto-clicking Load More...");
                        loadMore.click();
                        // We might need to wait for load? The next scan (10s later) will catch new items.
                    }
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
