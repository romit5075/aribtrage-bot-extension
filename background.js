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
            chrome.storage.local.set({ monitoringState: state }); // Update state to inactive
            chrome.alarms.clear("monitorRefresher");
            return;
        }

        // Use executeScript to ensure we hit the correct frame (allFrames: true)
        // This is safer than sendMessage mixed with iframes.
        chrome.scripting.executeScript({
            target: { tabId: state.tabId, allFrames: true },
            func: () => {
                // Must access window.scrapePageData directly
                if (window.scrapePageData) return window.scrapePageData();
                return null;
            }
        }, (results) => {
            if (chrome.runtime.lastError) {
                console.log("Script execution failed:", chrome.runtime.lastError);
                return;
            }

            if (results && results.length > 0) {
                // Find the result that has useful data matching our type
                let bestData = null;
                for (const res of results) {
                    if (res.result && res.result.odds && res.result.odds.length > 0) {
                        // Prefer data matching likely type
                        if (res.result.type === state.scanType) {
                            bestData = res.result;
                            break;
                        }
                        // Fallback
                        if (!bestData) bestData = res.result;
                    }
                }

                if (bestData) {
                    // Update timestamp for the timer
                    chrome.storage.local.set({ lastScanTime: Date.now() });

                    // Process the data
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
