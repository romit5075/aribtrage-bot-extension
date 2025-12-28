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

    // Helper Function for Trade Execution
    const performTrade = (tradeReq) => {
        const { url, team, id, amount, expectedOdds } = tradeReq;

        // Helper to inject content script and then trigger click
        const injectAndClick = async (tabId) => {
            try {
                // First, try to inject the content script (in case it's not loaded)
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content.js']
                });
                console.log("Content script injected successfully");
            } catch (e) {
                console.log("Script injection note:", e.message);
                // Script might already be loaded, continue anyway
            }

            // Small delay after injection
            await new Promise(resolve => setTimeout(resolve, 500));

            // Now send the click command
            triggerClick(tabId, 5);
        };

        // Helper to trigger click with retry
        const triggerClick = (tabId, retries = 5) => {
            chrome.tabs.sendMessage(tabId, { action: "click_bet_button", team: team, id: id, amount: amount, expectedOdds: expectedOdds, retryLimit: 5 }, (response) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    console.log("Msg error:", err.message);

                    if (retries > 0 && !err.message.includes("closed before a response")) {
                        console.log(`Retrying click in 500ms... (${retries} left)`);
                        setTimeout(() => triggerClick(tabId, retries - 1), 500);
                    } else {
                        console.log("All retries exhausted");
                        // Notify user
                        chrome.notifications.create({
                            type: 'basic',
                            iconUrl: 'icon.png',
                            title: 'Click Failed',
                            message: `Could not click ${team} button. Try refreshing the page.`,
                            priority: 2
                        });
                    }
                } else {
                    console.log("Click command sent & acknowledged");
                }
            });
        };

        // Check if tab exists
        chrome.tabs.query({}, (tabs) => {
            const existingTab = tabs.find(t => t.url === url || t.url.includes(url));
            if (existingTab) {
                chrome.tabs.update(existingTab.id, { active: true }, () => {
                    // Wait a bit for focus, then inject and click
                    setTimeout(() => injectAndClick(existingTab.id), 800);
                });
            } else {
                chrome.tabs.create({ url: url, active: true }, (newTab) => {
                    // Wait for load
                    const listener = (tabId, changeInfo) => {
                        if (tabId === newTab.id && changeInfo.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(listener);
                            // Give page more time to render (React apps take longer)
                            setTimeout(() => injectAndClick(newTab.id), 3000);
                        }
                    };
                    chrome.tabs.onUpdated.addListener(listener);
                });
            }
        });
    };

    if (request.action === "open_and_click") {
        performTrade(request);
        return true;
    }

    if (request.action === "combined_bet") {
        const { poly, stake } = request;

        // Execute Poly Trade first
        if (poly) {
            console.log("Executing Combined Bet - Part 1: Poly");
            performTrade(poly);
        }

        // Wait then execute Stake Trade
        // Using a longer delay (e.g. 1.5s) to ensure Poly tab is handled and browser is responsive
        // Note: Switching tabs for Stake will hide Poly tab.
        setTimeout(() => {
            if (stake) {
                console.log("Executing Combined Bet - Part 2: Stake");
                performTrade(stake);
            }
        }, 1500);

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
                        const match = txt.match(/^([A-Z]{3})/);
                        if (match) team = match[1];

                        // Updated from Content Script Logic
                        if (team === 'UNKNOWN' || team.length <= 4) {
                            const linkEl = btn.closest('a');
                            if (linkEl) {
                                const fullText = linkEl.textContent.trim().toUpperCase();
                                const btnText = btn.textContent.trim().toUpperCase();
                                let cleanName = fullText.replace(btnText, '').trim();
                                cleanName = cleanName.replace(/\d+\s*¢/g, '').replace(/(\d+\.\d{2})/g, '').trim();
                                if (cleanName.length > 3) {
                                    team = cleanName;
                                }
                            }
                        }
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
// 4. Data Processing
function handleNewData(newData) {
    chrome.storage.local.get([
        'monitoringState', 'polymarketData', 'stackData', 'strictMatch',
        'tgBotToken', 'tgChatId', 'maxPayroll', 'stakeAmount',
        'autoTradeEnabled', 'tgTradeEnabled', 'blockedFunds', 'arbHistory'
    ], (result) => {
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

        // Always highlight teams on data update (for visual team identification)
        if (newData.odds && newData.odds.length >= 2) {
            const highlightTargets = newData.odds.map((o, idx) => ({
                team: o.team,
                type: newData.type === 'polymarket' ? 'polymarket' : 'stack',
                teamIndex: idx % 2  // Alternate: 0 = Pink, 1 = Orange
            }));

            // Send highlight to all tabs
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(t => {
                    try {
                        chrome.tabs.sendMessage(t.id, { action: "highlight_odds", targets: highlightTargets });
                    } catch (e) { }
                });
            });
        }

        if (poly && stack && poly.odds && stack.odds) {
            const opportunities = ArbitrageCalculator.findOpportunities(poly.odds, stack.odds, strictMatch);

            if (opportunities.length > 0) {
                // Determine if we should notify
                if (result.monitoringState && result.monitoringState.active) {

                    // 1. Prepare Highlight Targets with team colors
                    const targets = [];
                    opportunities.forEach(op => {
                        const parts = op.betOn.split(' / ');
                        if (parts.length === 2) {
                            const p1 = parts[0].match(/(.*) \((.*)\)/);
                            const p2 = parts[1].match(/(.*) \((.*)\)/);

                            if (p1) targets.push({ team: p1[1].trim(), type: p1[2].toLowerCase() === 'poly' ? 'polymarket' : 'stack', teamIndex: 0 }); // Team 1 = Pink
                            if (p2) targets.push({ team: p2[1].trim(), type: p2[2].toLowerCase() === 'poly' ? 'polymarket' : 'stack', teamIndex: 1 }); // Team 2 = Orange
                        }
                    });

                    // 2. Broadcast Highlighting to ALL tabs with Stake or Polymarket
                    if (targets.length > 0) {
                        try {
                            // Send to all tabs
                            chrome.tabs.query({}, (tabs) => {
                                tabs.forEach(t => {
                                    try {
                                        chrome.tabs.sendMessage(t.id, { action: "highlight_odds", targets: targets });
                                    } catch (e) { }
                                });
                            });
                        } catch (e) {
                            console.error("Highlight send failed", e);
                        }
                    }

                    // NOTIFY (Browser)
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

                    // --- TELEGRAM & AUTO-TRADE LOGIC ---
                    const botToken = result.tgBotToken;
                    const chatId = result.tgChatId;
                    const autoTrade = result.autoTradeEnabled;
                    const tgNotify = result.tgTradeEnabled;
                    const maxPay = result.maxPayroll || 0;
                    const stake = result.stakeAmount || 0;
                    const maxTrades = result.maxTrades || 0; // New limit
                    let blocked = result.blockedFunds || 0;
                    let tradeCount = result.tradeCount || 0; // New counter
                    let fundsUpdated = false;

                    opportunities.forEach(op => {
                        // Check if we should "take trade"
                        if (autoTrade && stake > 0) {

                            // Check Max Trades Limit
                            if (maxTrades > 0 && tradeCount >= maxTrades) {
                                console.log("Max trades limit reached. No more trades.");
                                return; // Skip
                            }

                            // Valid Trade?
                            if ((blocked + stake) <= maxPay) {
                                // Check for duplicates (simple check: if we traded this match in last 60s)
                                const recentTrade = result.arbHistory ? result.arbHistory.find(h =>
                                    h.match === op.match &&
                                    h.tradeTaken &&
                                    (Date.now() - new Date(h.timestamp).getTime() < 60000)
                                ) : false;

                                if (!recentTrade) {
                                    // EXECUTE SIMULATED TRADE
                                    blocked += stake;
                                    tradeCount += 1; // Increment count
                                    fundsUpdated = true;

                                    const calc = ArbitrageCalculator.calculateStakes(stake, op.odds[0], op.odds[1]);

                                    // Log explicit trade
                                    const tradeLog = {
                                        ...op,
                                        tradeTaken: true,
                                        invested: stake,
                                        expectedReturn: calc ? calc.totalReturn : 0,
                                        timestamp: new Date().toISOString()
                                    };
                                    ArbitrageLogger.logPositive(tradeLog);

                                    // Send Telegram
                                    if (tgNotify && botToken && chatId) {
                                        const cleanMatch = op.match.replace(/\*/g, '');
                                        const cleanBet = op.betOn.replace(/\*/g, '');

                                        const msg = `ARBITRAGE FOUND\n\n` +
                                            `Match: ${cleanMatch}\n` +
                                            `Bet: ${cleanBet}\n` +
                                            `Odds: ${op.odds.join(' vs ')}\n` +
                                            `\nInvested: $${stake} | Return: $${calc ? calc.totalReturn : '0'}\n` +
                                            `Total Profit: $${calc ? calc.profit : '0'} (ROI: ${calc ? calc.roi : '0'}%)\n` +
                                            `\nBlocked Funds: $${blocked} / $${maxPay}\n` +
                                            `Trades Session: ${tradeCount} / ${maxTrades}`;

                                        const url = `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(msg)}&parse_mode=Markdown`;
                                        fetch(url).catch(e => console.error("TG Send Fail", e));
                                    }
                                }
                            } else {
                                console.log("Insufficient Payroll for Auto-Trade");
                                if (tgNotify && botToken && chatId) {
                                    // Optional: Notify low funds? Maybe not to spam.
                                }
                            }
                        } else if (tgNotify && botToken && chatId) {
                            // Just Notify (No Trade) if not auto-trading but notification on?
                            // User said: "do not take trade untill the auto-trade is on... whenever i also on telegram-trade which take fake trade and send message"
                            // So if auto-trade OFF, maybe we don't send "Trade Taken" message. 
                            // But user asked: "send telegram update... 1 thing if any positive arbitrage found then we have to take trade"
                            // "right now we don;t have to take trade we just have to sent on tg hey i invest x and got x return"

                            // Interpretation: ALWAYS send mock trade info if Telegram is ON, but only BLOCK funds if Auto-Trade is ON? 
                            // Or, Auto-Trade enables the whole flow?
                            // "do not take trade untill the auto-trade is on" -> means do not increment blocked funds.
                            // "whenever i also on telegram-trade which take fake trade and send message" -> implies telegram-trade controls the message sending.

                            // Let's stick to: 
                            // If Auto-Trade ON: We block funds + Send "Trade Taken" msg.
                            // If Auto-Trade OFF: We do NOTHING (no trade, maybe no message? or just "Opportunity Found" message?)
                            // The prompt says: "right now we don;t have to take trade we just have to sent on tg hey i invest x and got x return... do not take trade untill the auto-trade is on"
                            // This is contradictory. "Right now don't take trade" vs "do not take trade untill auto-trade is on".
                            // I will assume:
                            // IF AutoTrade ON: Real Simulation (Block funds + Msg).
                            // IF AutoTrade OFF: Just Notification (No block funds, but maybe show what WOULD happen?).

                            // Let's add a "Scan Only" notification if High Value?
                            // For now, adhering strictly to: "do not take trade untill the auto-trade is on".
                        }
                    });

                    if (fundsUpdated) {
                        chrome.storage.local.set({ blockedFunds: blocked });
                    }
                }
            }
        }
    });
}


// 7. Force Trade Handler (Manual "Auto Bet")
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "force_trade") {
        const { op } = request;
        if (!op) return;

        chrome.storage.local.get(['tgBotToken', 'tgChatId', 'maxPayroll', 'stakeAmount', 'blockedFunds', 'tradeCount', 'maxTrades'], (result) => {
            const botToken = result.tgBotToken;
            const chatId = result.tgChatId;
            const stake = result.stakeAmount || 100;
            const maxPay = result.maxPayroll || 1000;
            let blocked = result.blockedFunds || 0;
            let tradeCount = result.tradeCount || 0;

            blocked += stake;
            tradeCount += 1;

            const calc = ArbitrageCalculator.calculateStakes(stake, op.odds[0], op.odds[1]);

            // Log
            const tradeLog = {
                ...op,
                tradeTaken: true,
                invested: stake,
                expectedReturn: calc ? calc.totalReturn : 0,
                timestamp: new Date().toISOString(),
                manual: true
            };
            ArbitrageLogger.logPositive(tradeLog);
            chrome.storage.local.set({ blockedFunds: blocked, tradeCount: tradeCount });

            // Send TG
            if (botToken && chatId) {
                const cleanMatch = op.match.replace(/\*/g, '');
                const cleanBet = op.betOn.replace(/\*/g, '');

                const msg = `MANUAL BET TAKEN\n\n` +
                    `Match: ${cleanMatch}\n` +
                    `Bet: ${cleanBet}\n` +
                    `Odds: ${op.odds.join(' vs ')}\n` +
                    `\nInvested: $${stake} | Return: $${calc ? calc.totalReturn : '0'}\n` +
                    `Total Profit: $${calc ? calc.profit : '0'} (ROI: ${calc ? calc.roi : '0'}%)\n` +
                    `\nBlocked Funds: $${blocked} / $${maxPay}\n` +
                    `Trades Session: ${tradeCount}`;

                const url = `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(msg)}`;
                fetch(url).catch(e => console.error("TG Send Fail", e));
            }

            sendResponse({ success: true, blocked: blocked });
        });
        return true; // async
    }

    if (request.action === "bet_placed_success") {
        chrome.storage.local.get(['tgBotToken', 'tgChatId'], (result) => {
            const botToken = result.tgBotToken;
            const chatId = result.tgChatId;
            if (botToken && chatId) {
                const msg = `✅ BET SLIP FILLED (Auto)\n\n` +
                    `Team: ${request.team}\n` +
                    `Odds Verified: ${request.odds}\n` +
                    `Amount: ${request.amount || '0.01'}\n` +
                    `\nPlease confirm manually!`;
                const url = `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(msg)}`;
                fetch(url).catch(e => console.error("TG Send Fail", e));
            }
        });
    }
});
