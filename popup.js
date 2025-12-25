// Track sent arb alerts to avoid duplicates
const sentArbAlerts = new Set();

// Helper function to send Telegram alerts for arbitrage opportunities
function sendArbTelegramAlert(opportunity) {
    // Create unique key to avoid duplicate alerts
    const alertKey = `${opportunity.match}-${opportunity.polyTeam}-${opportunity.stakeTeam}-${opportunity.arbPercent}`;
    
    if (sentArbAlerts.has(alertKey)) {
        console.log('[TG] Duplicate alert skipped:', alertKey);
        return;
    }
    
    sentArbAlerts.add(alertKey);
    
    // Clear old alerts after 5 minutes
    setTimeout(() => sentArbAlerts.delete(alertKey), 5 * 60 * 1000);
    
    chrome.storage.local.get(['tgBotToken', 'tgChatId'], (res) => {
        const token = res.tgBotToken;
        const chatId = res.tgChatId;
        
        if (!token || !chatId) {
            console.warn('[TG] Not configured');
            return;
        }
        
        const message = 
`[ARB ALERT] *Arbitrage Opportunity!*

*Match:* ${opportunity.match}

*Poly:* ${opportunity.polyTeam} @ ${opportunity.polyOdds}
*Stake:* ${opportunity.stakeTeam} @ ${opportunity.stakeOdds}

*ROI:* ${opportunity.arbPercent}%
*Stakes:* $${opportunity.stake1} / $${opportunity.stake2}
*Profit:* $${opportunity.profit}

_Time: ${new Date().toLocaleTimeString()}_`;
        
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown'
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.ok) {
                console.log('[TG] Arb alert sent successfully');
            } else {
                console.error('[TG] Failed:', data.description);
            }
        })
        .catch(e => console.error('[TG] Error:', e));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const scanPolyBtn = document.getElementById('scanPolyBtn');
    const scanStakeBtn = document.getElementById('scanStakeBtn');
    const clearBtn = document.getElementById('clearBtn');
    const statusText = document.getElementById('status');
    const resultsArea = document.getElementById('resultsArea');

    // Bet Button Handler
    resultsArea.addEventListener('click', (e) => {
        if (e.target.classList.contains('debug-btn')) {
            const dataStr = e.target.getAttribute('data-debug');
            if (dataStr) {
                const data = JSON.parse(dataStr);
                chrome.storage.local.get(['tgBotToken', 'tgChatId'], (res) => {
                    const token = res.tgBotToken;
                    const chat = res.tgChatId;
                    if (token && chat) {
                        const msg = `[DEBUG] *Debug Report*\n\n` +
                            `Poly: ${data.home.team} (${data.home.odds}) vs ${data.away.team} (${data.away.odds})\n` +
                            `Stake: ${data.stakeHome.team} (${data.stakeHome.odds}) vs ${data.stakeAway.team} (${data.stakeAway.odds})`;
                        const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chat}&text=${encodeURIComponent(msg)}&parse_mode=Markdown`;
                        fetch(url).then(() => alert("Debug sent to TG!")).catch(e => alert("Failed to send: " + e));
                    } else {
                        alert("Configure TG settings first.");
                    }
                });
            }
        }
        else if (e.target.closest('.force-bet-btn')) { // Use closest for SVG clicks
            const btn = e.target.closest('.force-bet-btn');
            const matchData = JSON.parse(btn.getAttribute('data-match'));
            if (matchData) {
                if (confirm("Take manual simulated trade for " + matchData.match + "?")) {
                    chrome.runtime.sendMessage({ action: "force_trade", op: matchData }, (res) => {
                        if (res && res.success) {
                            alert(`Trade Taken! Blocked: $${res.blocked}`);
                        }
                    });
                }
            }
        }
        else if (e.target.classList.contains('bet-btn')) {
            const url = e.target.getAttribute('data-link');
            // Extract team name from button text "P: CHA" -> "CHA"
            const text = e.target.textContent;
            let team = text.split(':')[1];
            if (team) team = team.trim();

            // Extract ID
            const btnId = e.target.getAttribute('data-id');
            let stakeAmt = e.target.getAttribute('data-stake');
            const expectedOdds = e.target.getAttribute('data-odds');

            // Check for test mode - use test amount override
            chrome.storage.local.get(['testModeEnabled', 'testAmount'], (settings) => {
                // If test mode is on, use the test amount
                if (settings.testModeEnabled) {
                    const testAmt = parseFloat(settings.testAmount) || 0.1;
                    stakeAmt = testAmt.toString();
                    console.log('[TestMode] Using test amount:', stakeAmt);
                }
                
                // Also check mainStakeInput value as fallback
                const mainInput = document.getElementById('mainStakeInput');
                if (mainInput && mainInput.value && parseFloat(mainInput.value) > 0) {
                    stakeAmt = mainInput.value;
                    console.log('[TestMode] Using mainStakeInput amount:', stakeAmt);
                }

                if (url && url !== '#' && url !== 'undefined') {
                    chrome.runtime.sendMessage({
                        action: "open_and_click",
                        url: url,
                        team: team,
                        id: btnId,
                        amount: stakeAmt,
                        expectedOdds: expectedOdds
                    });
                } else {
                    alert("Link not available. Please rescan.");
                }
            });
        }
    });

    // 1. Load initial state
    updateUI();

    // 1.5 Auto-Refresh UI on Storage Change (Live Monitoring)
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            if (changes.polymarketData || changes.stackData || changes.tradeCount || changes.blockedFunds) {
                updateUI();
            }
        }
    });

    const toggleConverter = document.getElementById('toggleConverter');
    const converterStatusLabel = document.getElementById('converterStatusLabel');

    // 0. Converter Toggle Handler
    function updateToggleUI(isActive) {
        if (toggleConverter) toggleConverter.checked = isActive;
        if (converterStatusLabel) {
            converterStatusLabel.textContent = isActive ? "Active" : "Inactive";
            converterStatusLabel.style.color = isActive ? "#27ae60" : "#95a5a6";
        }
    }

    // Load initial state for Toggle
    chrome.storage.local.get(['isEnabled'], (result) => {
        const isEnabled = result.isEnabled !== false; // Default true
        updateToggleUI(isEnabled);
    });

    if (toggleConverter) {
        toggleConverter.addEventListener('change', async (e) => {
            const isEnabled = e.target.checked;
            updateToggleUI(isEnabled);

            // Save state
            chrome.storage.local.set({ isEnabled: isEnabled });

            // Notify content script
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: "toggleState",
                        isEnabled: isEnabled
                    });
                } catch (err) {
                    console.log("Could not send message to tab (maybe not loaded yet):", err);
                }
            }
        });
    }

    // --- Hover Toggle Logic ---
    const toggleHover = document.getElementById('toggleHover');
    const hoverStatusLabel = document.getElementById('hoverStatusLabel');

    function updateHoverToggleUI(isActive) {
        if (toggleHover) toggleHover.checked = isActive;
        if (hoverStatusLabel) {
            hoverStatusLabel.textContent = isActive ? "Hover Active" : "Hover Inactive";
            hoverStatusLabel.style.color = isActive ? "#27ae60" : "#95a5a6";
        }
    }

    // Load initial state for Hover Toggle
    chrome.storage.local.get(['hoverArbEnabled'], (result) => {
        const isEnabled = result.hoverArbEnabled !== false; // Default true
        updateHoverToggleUI(isEnabled);
    });

    if (toggleHover) {
        toggleHover.addEventListener('change', async (e) => {
            const isEnabled = e.target.checked;
            updateHoverToggleUI(isEnabled);

            // Save state
            chrome.storage.local.set({ hoverArbEnabled: isEnabled });

            // Notify content script
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: "toggleHoverArb",
                        isEnabled: isEnabled
                    });
                } catch (err) {
                    console.log("Could not send message to tab (maybe not loaded yet):", err);
                }
            }
        });
    }

    // --- Strict Match Toggle ---
    const toggleStrict = document.getElementById('toggleStrict');
    const strictStatusLabel = document.getElementById('strictStatusLabel');

    function updateStrictUI(isActive) {
        if (toggleStrict) toggleStrict.checked = isActive;
        if (strictStatusLabel) {
            strictStatusLabel.style.color = isActive ? "#27ae60" : "#95a5a6";
        }
    }

    chrome.storage.local.get(['strictMatch'], (result) => {
        const isStrict = result.strictMatch === true; // Default to false (relaxed) is better for user experience, but let's stick to user request "match exact name... or same name"
        updateStrictUI(isStrict);
    });

    if (toggleStrict) {
        toggleStrict.addEventListener('change', (e) => {
            const isStrict = e.target.checked;
            updateStrictUI(isStrict);
            chrome.storage.local.set({ strictMatch: isStrict }, () => {
                updateUI(); // Re-render table
            });
        });
    }

    // --- Test Mode Toggle ---
    const toggleTestMode = document.getElementById('toggleTestMode');
    const testModeLabel = document.getElementById('testModeLabel');
    const testAmountInput = document.getElementById('testAmountInput');
    const mainStakeInput = document.getElementById('mainStakeInput');

    function updateTestModeUI(isActive) {
        if (toggleTestMode) toggleTestMode.checked = isActive;
        if (testModeLabel) {
            testModeLabel.style.color = isActive ? "#e74c3c" : "#95a5a6";
            testModeLabel.textContent = isActive ? "TEST ON" : "TEST";
        }
        // Show/hide the test amount input next to the toggle
        if (testAmountInput) {
            testAmountInput.style.display = isActive ? 'inline-block' : 'none';
        }
        // Also enable/show the main stake input when test mode is on
        if (mainStakeInput) {
            mainStakeInput.style.border = isActive ? '2px solid #e74c3c' : '1px solid #ccc';
        }
    }

    chrome.storage.local.get(['testModeEnabled', 'testAmount'], (result) => {
        const isTest = result.testModeEnabled === true;
        updateTestModeUI(isTest);
        if (testAmountInput && result.testAmount) {
            testAmountInput.value = result.testAmount;
        }
        if (mainStakeInput && result.testAmount) {
            mainStakeInput.value = result.testAmount;
        }
    });

    if (toggleTestMode) {
        toggleTestMode.addEventListener('change', (e) => {
            const isTest = e.target.checked;
            updateTestModeUI(isTest);
            chrome.storage.local.set({ testModeEnabled: isTest });
        });
    }

    // Save test amount when changed
    if (testAmountInput) {
        testAmountInput.addEventListener('change', (e) => {
            const amount = parseFloat(e.target.value) || 0.1;
            chrome.storage.local.set({ testAmount: amount });
            if (mainStakeInput) mainStakeInput.value = amount;
        });
    }

    if (mainStakeInput) {
        mainStakeInput.addEventListener('change', (e) => {
            const amount = parseFloat(e.target.value) || 0.1;
            chrome.storage.local.set({ testAmount: amount });
            if (testAmountInput) testAmountInput.value = amount;
        });
    }

    // --- Live Scan Toggle ---
    const toggleLive = document.getElementById('toggleLiveScan');
    const liveStatusLabel = document.getElementById('liveScanStatusLabel');

    function updateLiveUI(isActive) {
        if (toggleLive) toggleLive.checked = isActive;
        if (liveStatusLabel) {
            liveStatusLabel.style.color = isActive ? "#27ae60" : "#95a5a6";
        }
        // If live active, maybe hide start monitor button?
        const startBtn = document.getElementById('startMonitorBtn');
        if (startBtn) {
            startBtn.disabled = isActive;
            startBtn.textContent = isActive ? "Real-Time Active ✓" : "start Monitor (10s)";
            startBtn.style.opacity = isActive ? "0.6" : "1";
        }
    }

    chrome.storage.local.get(['liveScanEnabled'], (result) => {
        const isLive = result.liveScanEnabled === true;
        updateLiveUI(isLive);
    });

    if (toggleLive) {
        toggleLive.addEventListener('change', async (e) => {
            const isLive = e.target.checked;
            updateLiveUI(isLive);
            chrome.storage.local.set({ liveScanEnabled: isLive });

            // Notify ALL relevant tabs (both Stake and Polymarket)
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                if (tab.url && (
                    tab.url.includes('stake.com') || 
                    tab.url.includes('stake.us') ||
                    tab.url.includes('polymarket.com') ||
                    tab.url.includes('sx.bet')
                )) {
                    try {
                        chrome.tabs.sendMessage(tab.id, { action: "toggleLive", enabled: isLive });
                    } catch (err) {
                        // Tab might not have content script loaded
                    }
                }
            }
        });
    }

    // 2. Scan Handlers

    // Helper to find tab by keyword
    async function findTabByKeyword(keyword) {
        // 1. Try to find ACTIVE tab in current window first (Highest Priority)
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.url && activeTab.url.toLowerCase().includes(keyword.toLowerCase())) {
            return activeTab;
        }

        // 2. Fallback to any tab
        const tabs = await chrome.tabs.query({});
        return tabs.find(t => t.url && t.url.toLowerCase().includes(keyword.toLowerCase()));
    }

    const updateStatusTick = (type, success) => {
        const tick = type === 'polymarket' ? document.getElementById('polyTick') : document.getElementById('stakeTick');
        const box = type === 'polymarket' ? document.getElementById('polyStatusBox') : document.getElementById('stakeStatusBox');

        if (tick && box) {
            // Use SVG Icons
            const iconCheck = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="check-icon"><path d="M20 6L9 17l-5-5" stroke="#27ae60" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            const iconCross = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="cross-icon"><path d="M18 6L6 18M6 6l12 12" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

            tick.innerHTML = success ? iconCheck : iconCross;
            box.style.opacity = success ? "1" : "0.5";
            box.style.color = success ? "#27ae60" : "#e74c3c";
        }
    };

    const performScan = async (expectedType) => {
        if (statusText) statusText.textContent = `Scanning ${expectedType}...`;

        try {
            // Find target tab intelligently
            let keyword = expectedType === 'polymarket' ? 'polymarket.com' : 'stake.'; // stake.com, stake.us, etc.
            let tab = await findTabByKeyword(keyword);

            if (!tab) {
                console.log(`No tab found for ${expectedType}`);
                updateStatusTick(expectedType, false);
                return;
            }

            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => {
                    if (window.scrapePageData) return window.scrapePageData();

                    // Fallback Scraper (if content script missing)
                    console.log("Fallback Scraper Running...");
                    const data = { type: 'unknown', odds: [] };

                    // Simple Poly Scraper Logic
                    const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
                    if (polyButtons.length > 0) {
                        data.type = 'polymarket';
                        polyButtons.forEach(btn => {
                            // Extract basic info
                            const teamNode = btn.querySelector('.opacity-70');
                            let team = teamNode ? teamNode.textContent.trim().toUpperCase() : 'UNKNOWN';

                            // Improved Name Extraction
                            if (team === 'UNKNOWN' || team.length <= 4) {
                                // Try to get full text from parent link or container
                                const linkEl = btn.closest('a');
                                if (linkEl) {
                                    const fullText = linkEl.textContent.trim().toUpperCase();
                                    // Remove the button text itself (e.g. "BLG 88C") to isolate name
                                    const btnText = btn.textContent.trim().toUpperCase();
                                    let cleanName = fullText.replace(btnText, '').trim();

                                    // Clean up price junk if multiple buttons
                                    cleanName = cleanName.replace(/\d+\s*¢/g, '').replace(/(\d+\.\d{2})/g, '').trim();

                                    if (cleanName.length > 3) {
                                        team = cleanName;
                                    }
                                }
                            }
                            const matchCents = btn.textContent.match(/(\d+)\s*¢/);
                            const matchDecimal = btn.textContent.match(/(\d+\.\d{2})/);
                            let odds = null;

                            // Check for suspended/unavailable
                            const txt = btn.textContent.toLowerCase();
                            if (txt.includes('suspended') || txt.includes('unavailable') || btn.disabled) {
                                odds = 'Suspended';
                                console.log(`Found suspended/unavailable odds for team ${team}`);
                            } else {
                                if (matchCents) {
                                    const cents = parseInt(matchCents[1], 10);
                                    if (cents > 0) odds = (100 / cents).toFixed(2);
                                } else if (matchDecimal) {
                                    odds = parseFloat(matchDecimal[1]);
                                }
                            }

                            const linkEl = btn.closest('a');
                            const link = linkEl ? linkEl.href : window.location.href;

                            if (team !== 'UNKNOWN' && odds) {
                                data.odds.push({
                                    team,
                                    odds: parseFloat(odds),
                                    source: 'Poly',
                                    link: link,
                                    id: btn.id
                                });
                            }
                        });
                    }

                    // Simple Stake Scraper Logic
                    if (data.odds.length === 0) {
                        const stackItems = document.querySelectorAll('.outcome-content');
                        if (stackItems.length > 0) {
                            data.type = 'stack';
                            // Add stack scraping if needed, but Poly is priority issue right now
                            // We trust content script usually, but basic check helps
                            stackItems.forEach(item => {
                                const nameEl = item.querySelector('[data-testid="outcome-button-name"]');
                                const oddsEl = item.querySelector('[data-testid="fixture-odds"]');
                                if (nameEl && oddsEl) {
                                    data.odds.push({
                                        team: nameEl.textContent.trim().toUpperCase(),
                                        odds: parseFloat(oddsEl.textContent),
                                        source: 'Stake',
                                        link: window.location.href
                                    });
                                }
                            });
                        }
                    }

                    return data;
                }
            });

            let foundData = null;
            if (results && results.length > 0) {
                for (const res of results) {
                    if (res.result && res.result.odds && res.result.odds.length > 0) {
                        // Check if this frame has the data we want
                        if (res.result.type === expectedType) {
                            foundData = res.result;
                            break;
                        }
                        // Fallback check if type matches loosely
                        if ((expectedType === 'polymarket' && res.result.type === 'polymarket') ||
                            (expectedType === 'stack' && res.result.type === 'stack')) {
                            foundData = res.result;
                        }
                    }
                }
            }

            if (!foundData) {
                statusText.textContent = `No ${expectedType} data found.`;
                updateStatusTick(expectedType, false);
            } else {
                statusText.textContent = `Scraped ${foundData.odds.length} ${expectedType} odds from ${tab.url}`;
                updateStatusTick(expectedType, true);

                // Show URL in status box
                const boxId = expectedType === 'polymarket' ? 'polyStatusBox' : 'stakeStatusBox';
                const box = document.getElementById(boxId);

                if (box) {
                    let urlSpan = box.querySelector('.url-display');
                    if (!urlSpan) {
                        urlSpan = document.createElement('span');
                        urlSpan.className = 'url-display';
                        urlSpan.style.display = 'block';
                        urlSpan.style.fontSize = '10px';
                        urlSpan.style.color = '#7f8c8d';
                        urlSpan.style.marginTop = '2px';
                        box.appendChild(urlSpan);
                    }
                    try {
                        const urlObj = new URL(tab.url);
                        // Show domain + first part of path to be concise
                        urlSpan.textContent = urlObj.hostname + (urlObj.pathname.length > 20 ? urlObj.pathname.substring(0, 20) + '...' : urlObj.pathname);
                        urlSpan.title = tab.url;
                    } catch (e) {
                        urlSpan.textContent = "Invalid URL";
                    }
                }

                // Send to background to process/store
                chrome.runtime.sendMessage({
                    action: "data_updated",
                    data: foundData
                });

                // Also update local UI immediately?
                // The background will process and we might need to fetch storage or rely on background to update us?
                // popup usually listens to storage changes OR we can just reload table.
                // Let's reload table after a short delay
                setTimeout(updateUI, 500);
            }

        } catch (err) {
            console.error("Scan error:", err);
            statusText.textContent = `Error scanning ${expectedType}`;
            updateStatusTick(expectedType, false);
        }
    };

    const scanAllBtn = document.getElementById('scanAllBtn');
    if (scanAllBtn) {
        scanAllBtn.addEventListener('click', async () => {
            // Scan both in parallel or sequence
            await performScan('polymarket');
            await performScan('stack');
            statusText.textContent = "Scan complete.";
        });
    }

    // 3. Reset / Clear Button Handler
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            chrome.storage.local.remove(['polymarketData', 'stackData', 'lastPolyUrl', 'lastStackUrl'], () => {
                if (statusText) statusText.textContent = "Data cleared.";
                // Reset UI Ticks to neutral state (e.g., small dash or empty)
                const neutralIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#bdc3c7" stroke-width="2"/></svg>`;

                const pTick = document.getElementById('polyTick');
                const sTick = document.getElementById('stakeTick');

                if (pTick) pTick.innerHTML = neutralIcon;
                if (sTick) sTick.innerHTML = neutralIcon;

                // Reset Status Box Color/Opacity & Clear URL
                const pBox = document.getElementById('polyStatusBox');
                const sBox = document.getElementById('stakeStatusBox');

                [pBox, sBox].forEach(box => {
                    if (box) {
                        box.style.opacity = "0.5";
                        box.style.color = "#bdc3c7";
                        const urlSpan = box.querySelector('.url-display');
                        if (urlSpan) urlSpan.remove();
                    }
                });

                updateUI();
            });
        });
    }

    function handleScrapedData(data) {
        if (data.type === 'polymarket') {
            chrome.storage.local.set({ 'polymarketData': data }, () => {
                if (statusText) statusText.textContent = `Saved ${data.odds.length} Poly offers.`;
                updateUI();
            });
        } else if (data.type === 'stack') {
            chrome.storage.local.set({ 'stackData': data }, () => {
                if (statusText) statusText.textContent = `Saved ${data.odds.length} Stake offers.`;
                updateUI();
            });
        } else {
            if (statusText) statusText.textContent = "Unknown data type.";
        }
    }

    function updateUI() {
        chrome.storage.local.get(['polymarketData', 'stackData', 'strictMatch', 'stakeAmount', 'liveScanEnabled'], (result) => {
            const poly = result.polymarketData;
            const stack = result.stackData;
            const stakeAmt = result.stakeAmount || 100; // Default 100 if not set
            const isLive = result.liveScanEnabled === true;

            let html = '';

            if (!poly && !stack) {
                html = '<p>No data collected.</p>';
            } else {
                const now = new Date().toLocaleTimeString();
                const liveIndicator = isLive ? '<span style="color:#27ae60; font-weight:bold;">● LIVE</span>' : '';
                
                if (poly) {
                    html += `<p style="font-size:10px; color:#aaa;">Poly Data: ${poly.odds.length} teams ${liveIndicator} <span style="margin-left:10px; color:#3498db;">Updated: ${now}</span></p>`;
                }
                if (stack) {
                    html += `<p style="font-size:10px; color:#aaa;">Stake Data: ${stack.odds.length} teams</p>`;
                }

                if (poly && stack) {
                    // Get strict setting
                    const isStrict = result.strictMatch === true;
                    html += generateArbitrageTable(poly.odds, stack.odds, isStrict, stakeAmt);
                }
            }
            if (resultsArea) resultsArea.innerHTML = html;
        });
    }

    function generateArbitrageTable(polyOdds, stackOdds, strictMatch, stakeAmount) {
        // Goal Table Format:
        // Match (e.g. HOU-DEN) | Poly HOU | Poly DEN | Stake HOU | Stake DEN | Arb % (P-HOU/S-DEN) | Arb % (P-DEN/S-HOU)

        let tableHtml = `
            <style>
                table { border-collapse: collapse; width: 100%; }
                /* Zebra Striping */
                tbody tr:nth-child(even) { background-color: #f9f9f9; }
                tbody tr:nth-child(odd) { background-color: #ffffff; }
                /* Hover effect */
                tbody tr:hover { background-color: #f0f0f0; }
                /* Buttons */
                .bet-btn { border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; margin: 2px; color: white; display: inline-block; text-decoration: none; }
                .poly-btn { background-color: #29b6f6; }
                .stake-btn { background-color: #00bfa5; }
                .bet-btn:hover { opacity: 0.8; }
                .stake-display { display: block; font-size: 9px; font-weight: bold; color: #27ae60; margin-top: 2px; }
            </style>
            <table>
                <thead>
                    <tr>
                        <th>Match</th>
                        <th style="color:#29b6f6">Poly H</th>
                        <th style="color:#29b6f6">Poly A</th>
                        <th style="color:#00bfa5">Stake H</th>
                        <th style="color:#00bfa5">Stake A</th>
                        <th>Arb 1 (P_H/S_A)</th>
                        <th>Arb 2 (P_A/S_H)</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Helper to find a team in a list (Enhanced Matching)
        const findOdds = (list, name) => {
            if (strictMatch) {
                return list.find(x => x.team === name);
            } else {
                // 0. Pre-clean
                const clean = (s) => s.replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
                const n1 = clean(name.toUpperCase());
                
                // Handle "33 33" -> "33" deduplication
                const dedupe = (s) => {
                    const parts = s.split(' ');
                    if (parts.length === 2 && parts[0] === parts[1]) return parts[0];
                    return s;
                };
                const n1Clean = dedupe(n1);

                // 1. Strict Match (after cleaning)
                let match = list.find(x => dedupe(clean(x.team.toUpperCase())) === n1Clean);
                if (match) return match;

                // If strictMatch was false, but we found a clean strict match, return it.
                if (strictMatch) return null;

                // 2. Fuzzy Match
                let best = null;
                let bestScore = 0;

                list.forEach(item => {
                    const n2 = dedupe(clean(item.team.toUpperCase()));
                    let score = 0;

                    // A. Exact Substring
                    if (n1Clean.includes(n2) || n2.includes(n1Clean)) score += 60;

                    // B. Prefix Match (lowered from 3 to 2 for short names like "G1", "33")
                    const first1 = n1Clean.split(' ')[0];
                    const first2 = n2.split(' ')[0];
                    if (first1 === first2 && first1.length >= 2) score += 30;
                    
                    // B2. Direct number match ("33" matches "33 TEAM")
                    if (/^\d+$/.test(first1) && first1 === first2) {
                        score += 60; // Strong match for numeric teams
                    }

                    // C. Token Overlap (lowered from > 2 to >= 2 for "G1", "33")
                    const uniqueTokens = (str) => [...new Set(str.split(' ').filter(t => t.length >= 2))];
                    const t1 = uniqueTokens(n1Clean);
                    const t2 = uniqueTokens(n2);
                    let matches = 0;
                    let strongMatches = 0;
                    t1.forEach(token => {
                        if (t2.includes(token)) {
                            matches++;
                            if (token.length > 3) strongMatches++;
                        }
                    });
                    if (matches > 0) {
                        score += (matches * 20);
                        if (strongMatches > 0) score += 20;
                    }
                    
                    // C2. Number-based team matching (e.g., "33" vs "33 TEAM")
                    const num1 = n1Clean.match(/^\d+/)?.[0];
                    const num2 = n2.match(/^\d+/)?.[0];
                    if (num1 && num2 && num1 === num2) {
                        score += 50; // Strong match for number-based teams
                    }
                    
                    // C3. Core name matching (removes prefixes like "G1", "T1" and suffixes like "TEAM")
                    const extractCore = (s) => {
                        let core = s.replace(/^[A-Z]\d\s*/i, ''); // Remove G1, T1 prefix
                        core = core.replace(/\s*(TEAM|ESPORTS|GAMING|CLUB)$/i, ''); // Remove suffix
                        return core.trim();
                    };
                    const core1 = extractCore(n1Clean);
                    const core2 = extractCore(n2);
                    if (core1 && core2 && core1.length >= 3) {
                        if (core1 === core2 || core1.includes(core2) || core2.includes(core1)) {
                            score += 55; // Strong match for core names like "GENONE"
                        }
                    }
                    
                    // C4. Short prefix matching (e.g., "G1" matches "G1 GENONE")
                    // If one name is a short prefix (2-3 chars) that appears at start of other
                    const shortName = n1.length <= 3 ? n1 : (n2.length <= 3 ? n2 : null);
                    const longName = n1.length <= 3 ? n2 : (n2.length <= 3 ? n1 : null);
                    if (shortName && longName) {
                        // Check if long name starts with short name (e.g., "G1 GENONE" starts with "G1")
                        if (longName.startsWith(shortName + ' ') || longName.startsWith(shortName)) {
                            score += 60; // Strong match
                        }
                        // Also check if short name appears anywhere as a token
                        const longTokens = longName.split(' ');
                        if (longTokens.includes(shortName)) {
                            score += 50;
                        }
                    }
                    if (matches > 0) {
                        score += (matches * 20);
                        if (strongMatches > 0) score += 20;
                    }

                    // D. Ticker Handling
                    const removeTicker = (s) => {
                        const parts = s.split(' ');
                        if (parts.length > 1 && parts[0].length <= 5) return parts.slice(1).join(' ');
                        return s;
                    };
                    const n1_noTick = removeTicker(n1);
                    const n2_noTick = removeTicker(n2);
                    if (n1 !== n1_noTick || n2 !== n2_noTick) {
                        if (n1_noTick === n2_noTick || n1_noTick.includes(n2_noTick) || n2_noTick.includes(n1_noTick)) {
                            score += 45;
                        }
                    }
                    
                    // D2. Direct name match after removing prefix (e.g., "GENONE" matches "G1 GENONE")
                    // Extract the last word/main name from each
                    const getMainName = (s) => {
                        const parts = s.split(' ');
                        // If first part is short (like G1, T1), return the rest
                        if (parts.length > 1 && parts[0].length <= 2) {
                            return parts.slice(1).join(' ');
                        }
                        // Return the longest part
                        return parts.reduce((a, b) => a.length >= b.length ? a : b, '');
                    };
                    const main1 = getMainName(n1);
                    const main2 = getMainName(n2);
                    if (main1 && main2 && main1.length >= 3 && main2.length >= 3) {
                        if (main1 === main2) {
                            score += 70; // Very strong match for same main name
                        } else if (main1.includes(main2) || main2.includes(main1)) {
                            score += 55;
                        }
                    }

                    // E. Acronym
                    if (n1.length <= 4 || n2.length <= 4) {
                        const short = n1.length < n2.length ? n1 : n2;
                        const long = n1.length < n2.length ? n2 : n1;
                        if (short.length >= 2) {
                            let sIdx = 0, lIdx = 0;
                            while (sIdx < short.length && lIdx < long.length) {
                                if (short[sIdx] === long[lIdx]) sIdx++;
                                lIdx++;
                            }
                            if (sIdx === short.length) score += 45;
                        }
                    }
                    
                    // F. Special case: G1/T1 style abbrevs matching full names
                    // "G1" matches "GENONE" (G + 1/ONE)
                    // "T1" matches "TEAMONE" etc.
                    const abbrevMatch = (abbr, full) => {
                        if (abbr.length !== 2) return false;
                        const letter = abbr[0].toUpperCase();
                        const num = abbr[1];
                        
                        // Check if full name starts with same letter
                        if (full[0].toUpperCase() !== letter) return false;
                        
                        // Check if number part matches
                        // 1 = ONE, 2 = TWO, 3 = THREE, etc.
                        const numWords = { '1': 'ONE', '2': 'TWO', '3': 'THREE', '4': 'FOUR', '5': 'FIVE' };
                        if (numWords[num] && full.toUpperCase().includes(numWords[num])) {
                            return true;
                        }
                        
                        // Also check if full name contains the number
                        if (full.includes(num)) {
                            return true;
                        }
                        
                        return false;
                    };
                    
                    if (n1Clean.length === 2 && n2.length > 3) {
                        if (abbrevMatch(n1Clean, n2)) score += 70;
                    } else if (n2.length === 2 && n1Clean.length > 3) {
                        if (abbrevMatch(n2, n1Clean)) score += 70;
                    }
                    
                    // G. Known abbreviation mappings
                    const knownAbbrevs = {
                        'G1': ['GENONE', 'GEN1', 'GEN ONE', 'G ONE'],
                        'T1': ['TONE', 'T ONE', 'TEAM1', 'TEAMONE'],
                        '33': ['33 TEAM', '33TEAM', 'TEAM 33', 'TEAM33', 'THIRTYTHREE'],
                    };
                    const checkKnownAbbrev = (short, long) => {
                        const mappings = knownAbbrevs[short];
                        if (mappings) {
                            return mappings.some(m => long.includes(m) || m.includes(long));
                        }
                        return false;
                    };
                    if (checkKnownAbbrev(n1Clean, n2) || checkKnownAbbrev(n2, n1Clean)) {
                        score += 70;
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        best = item;
                    }
                });

                if (bestScore >= 40) return best;
                return null;
            }
        };

        // Helper to find team with its index
        const findOddsWithIndex = (list, name) => {
            const item = findOdds(list, name);
            if (item) {
                return { item, index: list.indexOf(item) };
            }
            return null;
        };

        // NEW APPROACH: Iterate STAKE items in pairs (more reliable order)
        // Then find matching Poly teams for each Stake pair
        for (let i = 0; i < stackOdds.length - 1; i += 2) {
            const stakeHome = stackOdds[i];
            const stakeAway = stackOdds[i + 1];
            
            // Skip if either is missing
            if (!stakeHome || !stakeAway) continue;

            // Find corresponding teams in Polymarket
            const homeResult = findOddsWithIndex(polyOdds, stakeHome.team);
            const awayResult = findOddsWithIndex(polyOdds, stakeAway.team);
            
            // Skip if we can't find both teams in Poly
            if (!homeResult || !awayResult) continue;
            
            const home = homeResult.item;
            const away = awayResult.item;
            
            // CRITICAL: Verify Poly teams are from the SAME match (adjacent indices)
            // If indices are not adjacent, these are from different matches - SKIP
            const indexDiff = Math.abs(homeResult.index - awayResult.index);
            if (indexDiff !== 1) {
                console.log(`[Arb] Skipping mismatch: ${home.team} (idx ${homeResult.index}) vs ${away.team} (idx ${awayResult.index}) - not adjacent`);
                continue;
            }
            
            // Check if this is a DRAW match (3-way market) - skip/gray out
            const isDraw = (name) => {
                const n = name.toUpperCase();
                return n === 'DRAW' || n.includes('DRAW') || n === 'X' || n === 'TIE';
            };
            const isDrawMatch = isDraw(home.team) || isDraw(away.team) || 
                               isDraw(stakeHome.team) || isDraw(stakeAway.team);

            if (stakeHome && stakeAway) {
                // Determine confidence
                let confidence = 100;
                if (!strictMatch) {
                    if (home.team !== stakeHome.team) confidence -= 10;
                }

                // Handle Suspended Checks...
                const isSuspended = (val) => val === 'Suspended';
                
                // DRAW match - show grayed out
                if (isDrawMatch) {
                    const trunc = (str) => str.length > 4 ? str.substring(0, 4) : str;
                    tableHtml += `
                        <tr style="background-color: #2d2d3a; opacity: 0.5;">
                            <td style="color: #888;">
                                <b>${home.team}</b> vs <b>${away.team}</b>
                                <br/><span style="font-size:9px;color:#ff9800;"><svg width="12" height="12" viewBox="0 0 24 24" fill="#ff9800" style="vertical-align:middle;margin-right:2px;"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg> 3-Way (Draw) - Skipped</span>
                            </td>
                            <td style="color:#666">${home.odds || '-'}</td>
                            <td style="color:#666">${away.odds || '-'}</td>
                            <td style="color:#666">${stakeHome?.odds || '-'}</td>
                            <td style="color:#666">${stakeAway?.odds || '-'}</td>
                            <td colspan="2" style="color:#666">-</td>
                            <td style="text-align: left;">
                                <span style="color:#888; font-size:10px;">Skipped (Draw)</span>
                            </td>
                        </tr>`;
                    continue; // Skip to next match
                }

                if (isSuspended(home.odds) || isSuspended(away.odds) ||
                    isSuspended(stakeHome.odds) || isSuspended(stakeAway.odds)) {
                    // Suspended Row
                    const formatOdds = (val) => isSuspended(val) ? '-' : val;
                    const trunc = (str) => str.length > 4 ? str.substring(0, 4) : str;

                    tableHtml += `
                        <tr>
                            <td><b>${home.team}</b><br/><span style="font-size:9px;color:#aaa">${stakeHome.team}</span></td>
                            <td style="color:${isSuspended(home.odds) ? '#95a5a6' : 'inherit'}">${formatOdds(home.odds)}</td>
                            <td style="color:${isSuspended(away.odds) ? '#95a5a6' : 'inherit'}">${formatOdds(away.odds)}</td>
                            <td style="color:${isSuspended(stakeHome.odds) ? '#95a5a6' : 'inherit'}">${formatOdds(stakeHome.odds)}</td>
                            <td style="color:${isSuspended(stakeAway.odds) ? '#95a5a6' : 'inherit'}">${formatOdds(stakeAway.odds)}</td>
                            <td colspan="2" style="font-size:10px; color:#95a5a6">-</td>
                             <td style="text-align: left;">
                                <div style="margin-bottom:2px">
                                    <button class="bet-btn poly-btn" data-link="${home.link}" data-id="${home.id}">P: ${trunc(home.team)}</button>
                                    <button class="bet-btn poly-btn" data-link="${away.link}" data-id="${away.id}">P: ${trunc(away.team)}</button>
                                </div>
                                <div>
                                    <button class="bet-btn stake-btn" data-link="${stakeHome.link}">S: ${trunc(stakeHome.team)}</button>
                                    <button class="bet-btn stake-btn" data-link="${stakeAway.link}">S: ${trunc(stakeAway.team)}</button>
                                </div>
                            </td>
                        </tr>`;
                } else {
                    // Active Match Row
                    const arb1 = ArbitrageCalculator.calculate(home.odds, stakeAway.odds);
                    const arb2 = ArbitrageCalculator.calculate(away.odds, stakeHome.odds);

                    const highlightStyle = "background-color: #ffe0b2; color: #e65100; font-weight: bold;";
                    const trunc = (str) => str.length > 4 ? str.substring(0, 4) : str;

                    // Stake Calculation Logic
                    let s1_home_val = 0, s1_away_val = 0, s2_home_val = 0, s2_away_val = 0;
                    let s1_home_disp = '', s1_away_disp = '', s2_home_disp = '', s2_away_disp = '';

                    if (arb1.isArb) {
                        const split = ArbitrageCalculator.calculateStakes(stakeAmount, home.odds, stakeAway.odds);
                        if (split) {
                            s1_home_val = split.stake1;
                            s1_away_val = split.stake2;
                            s1_home_disp = `<span class="stake-display">$${split.stake1}</span>`;
                            s1_away_disp = `<span class="stake-display">$${split.stake2}</span>`;
                            
                            // Send Telegram alert for Arb 1
                            sendArbTelegramAlert({
                                match: `${home.team} vs ${away.team}`,
                                polyTeam: home.team,
                                polyOdds: home.odds,
                                stakeTeam: stakeAway.team,
                                stakeOdds: stakeAway.odds,
                                arbPercent: arb1.roi,
                                stake1: split.stake1,
                                stake2: split.stake2,
                                profit: split.profit,
                                polyLink: home.link,
                                stakeLink: stakeAway.link
                            });
                        }
                    }

                    if (arb2.isArb) {
                        const split = ArbitrageCalculator.calculateStakes(stakeAmount, away.odds, stakeHome.odds);
                        if (split) {
                            s2_home_val = split.stake1;
                            s2_away_val = split.stake2;
                            s2_home_disp = `<span class="stake-display">$${split.stake1}</span>`;
                            s2_away_disp = `<span class="stake-display">$${split.stake2}</span>`;
                            
                            // Send Telegram alert for Arb 2
                            sendArbTelegramAlert({
                                match: `${home.team} vs ${away.team}`,
                                polyTeam: away.team,
                                polyOdds: away.odds,
                                stakeTeam: stakeHome.team,
                                stakeOdds: stakeHome.odds,
                                arbPercent: arb2.roi,
                                stake1: split.stake1,
                                stake2: split.stake2,
                                profit: split.profit,
                                polyLink: away.link,
                                stakeLink: stakeHome.link
                            });
                        }
                    }

                    // Button Styles
                    // Arb 1 Winner Pair: Poly Home + Stake Away
                    const styleP_Home = arb1.profit > 0 ? 'border: 2px solid #e74c3c !important; font-weight:bold;' : '';
                    const styleS_Away = arb1.profit > 0 ? 'border: 2px solid #e74c3c !important; font-weight:bold;' : '';

                    // Arb 2 Winner Pair: Poly Away + Stake Home
                    const styleP_Away = arb2.profit > 0 ? 'border: 2px solid #e74c3c !important; font-weight:bold;' : '';
                    const styleS_Home = arb2.profit > 0 ? 'border: 2px solid #e74c3c !important; font-weight:bold;' : '';

                    tableHtml += `
                        <tr>
                            <td>
                                <b>${home.team}</b> vs <b>${away.team}</b>
                                ${home.team !== stakeHome.team ? `<br/><span style="font-size:9px;color:#f39c12">Match: ${stakeHome.team}</span>` : ''}
                            </td>
                            
                            <!-- Poly Home (Arb 1 Winner?) -->
                            <td style="${arb1.profit > 0 ? highlightStyle : ''}">
                                ${home.odds}
                                ${s1_home_disp}
                            </td>
                            
                            <!-- Poly Away (Arb 2 Winner?) -->
                            <td style="${arb2.profit > 0 ? highlightStyle : ''}">
                                ${away.odds}
                                ${s2_home_disp}
                            </td>
                            
                            <!-- Stake Home (Arb 2 Winner?) -->
                            <td style="${arb2.profit > 0 ? highlightStyle : ''}">
                                ${stakeHome.odds}
                                ${s2_away_disp}
                            </td>
                            
                            <!-- Stake Away (Arb 1 Winner?) -->
                            <td style="${arb1.profit > 0 ? highlightStyle : ''}">
                                ${stakeAway.odds}
                                ${s1_away_disp}
                            </td>
                            
                            <td class="${arb1.profit > 0 ? 'arb-profit' : 'arb-loss'}">${arb1.profit.toFixed(2)}%</td>
                            <td class="${arb2.profit > 0 ? 'arb-profit' : 'arb-loss'}">${arb2.profit.toFixed(2)}%</td>
                             <td style="text-align: left; min-width: 140px;">
                                <div style="margin-bottom:3px; display:flex; gap:2px;">
                                    <button class="bet-btn poly-btn" style="${styleP_Home}" data-link="${home.link}" data-id="${home.id}" data-stake="${s1_home_val}" data-odds="${home.odds}">P: ${trunc(home.team)}</button>
                                    <button class="bet-btn poly-btn" style="${styleP_Away}" data-link="${away.link}" data-id="${away.id}" data-stake="${s2_home_val}" data-odds="${away.odds}">P: ${trunc(away.team)}</button>
                                </div>
                                <div style="display:flex; gap:2px;">
                                    <button class="bet-btn stake-btn" style="${styleS_Home}" data-link="${stakeHome.link}" data-stake="${s2_away_val}" data-odds="${stakeHome.odds}">S: ${trunc(stakeHome.team)}</button>
                                    <button class="bet-btn stake-btn" style="${styleS_Away}" data-link="${stakeAway.link}" data-stake="${s1_away_val}" data-odds="${stakeAway.odds}">S: ${trunc(stakeAway.team)}</button>
                                </div>
                                <div style="margin-top:4px; text-align:right;">
                                    <button class="debug-btn" data-debug='${JSON.stringify({ home, away, stakeHome, stakeAway })}' style="border:none; background:none; cursor:pointer;" title="Send to TG Debug">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="#333" xmlns="http://www.w3.org/2000/svg"><path d="M19 10C19.5523 10 20 10.4477 20 11V13C20 13.5523 19.5523 14 19 14H17V16C17 18.7614 14.7614 21 12 21C9.23858 21 7 18.7614 7 16V14H5C4.44772 14 4 13.5523 4 13V11C4 10.4477 4.44772 10 5 10H7V9C7 7.15178 8.00693 5.51862 9.5 4.60555C9.5 3.39445 10.5 2 12 2C13.5 2 14.5 3.39445 14.5 4.60555C15.9931 5.51862 17 7.15178 17 9V10H19ZM9 10V16C9 17.6569 10.3431 19 12 19C13.6569 19 15 17.6569 15 16V10H9Z" fill="#7f8c8d"/></svg>
                                    </button>
                                    <button class="force-bet-btn" data-arb='${JSON.stringify(arb1)}' data-match='${JSON.stringify({ match: home.team + " vs " + away.team, betOn: home.team + " (Poly) / " + away.team + " (Stack)", odds: [home.odds, stakeAway.odds] })}' style="border:none; background:none; cursor:pointer; margin-left:5px;" title="Auto Bet (Simulate)">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#e67e22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>
                                    </button>
                                </div>
                            </td>
                        </tr>`;
                }

            } else {
                // PARTIAL or NO MATCH
                // ... (Keep existing partial logic)
                const sH = stakeHome ? stakeHome.team : null;
                const sA = stakeAway ? stakeAway.team : null;
                const trunc = (str) => str && str.length > 4 ? str.substring(0, 4) : (str || '');

                tableHtml += `
                    <tr>
                        <td>
                            <b>${home.team}</b> vs <b>${away.team}</b>
                        </td>
                        <td>${home.odds}</td>
                        <td>${away.odds}</td>
                        <td style="color:#aaa">${stakeHome ? stakeHome.odds : '-'}</td>
                        <td style="color:#aaa">${stakeAway ? stakeAway.odds : '-'}</td>
                        <td style="color:#aaa">-</td>
                        <td style="color:#aaa">-</td>
                         <td style="text-align: left;">
                            <div style="margin-bottom:2px">
                                <button class="bet-btn poly-btn" data-link="${home.link}" data-id="${home.id}">P: ${trunc(home.team)}</button>
                                <button class="bet-btn poly-btn" data-link="${away.link}" data-id="${away.id}">P: ${trunc(away.team)}</button>
                            </div>
                            ${stakeHome ? `
                            <div>
                                <button class="bet-btn stake-btn" data-link="${stakeHome.link}">S: ${trunc(stakeHome.team)}</button>
                                <button class="bet-btn stake-btn" data-link="${stakeAway ? stakeAway.link : ''}">S: ${trunc(stakeAway ? stakeAway.team : '')}</button>
                            </div>` : ''}
                        </td>
                    </tr>
                 `;
            }
        }

        tableHtml += '</tbody></table>';
        return tableHtml;
    }

    function renderRow(name, o1, o2, res) {
        return `
            <tr>
                <td>${name}</td>
                <td>${o1}</td>
                <td>${o2}</td>
                <td class="${res.profit > 0 ? 'arb-profit' : 'arb-loss'}">
                    ${res.profit}%
                </td>
            </tr>
        `;
    }

    // --- Monitoring Logic ---
    const startMonitorBtn = document.getElementById('startMonitorBtn');
    const stopMonitorBtn = document.getElementById('stopMonitorBtn');
    const downloadLogsBtn = document.getElementById('downloadLogsBtn');
    const timerDisplay = document.getElementById('timerDisplay');
    let timerInterval = null;

    // Check status
    function checkMonitorStatus() {
        chrome.runtime.sendMessage({ action: "get_monitoring_status" }, (response) => {
            if (chrome.runtime.lastError || !response || !response.active) {
                updateMonitorUI(false);
            } else {
                updateMonitorUI(true);
            }
        });
    }
    checkMonitorStatus();

    // Check logs
    chrome.storage.local.get(['arbHistory'], (res) => {
        if (res.arbHistory && res.arbHistory.length > 0) {
            downloadLogsBtn.style.display = 'inline-block';
        }
    });

    function updateMonitorUI(active) {
        if (active) {
            startMonitorBtn.style.display = 'none';
            stopMonitorBtn.style.display = 'inline-block';
            if (statusText) statusText.textContent = "Monitoring Active...";
            startTimer();
        } else {
            startMonitorBtn.style.display = 'inline-block';
            stopMonitorBtn.style.display = 'none';
            stopTimer();
            if (timerDisplay) timerDisplay.textContent = "";
        }
    }

    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);

        timerInterval = setInterval(() => {
            chrome.storage.local.get(['lastScanTime'], (result) => {
                if (!result.lastScanTime) return;

                const now = Date.now();
                const diff = Math.floor((now - result.lastScanTime) / 1000);
                const remaining = 10 - diff;

                if (remaining >= 0) {
                    if (timerDisplay) timerDisplay.textContent = `Next scan in: ${remaining}s`;
                } else {
                    if (timerDisplay) timerDisplay.textContent = "Scanning...";
                }
            });
        }, 1000);
    }

    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    if (startMonitorBtn) {
        startMonitorBtn.addEventListener('click', async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) return;

            // Determine type from URL? Or ask user to be on the right page?
            // Let's guess based on URL
            let type = null;
            if (tab.url.includes('polymarket.com')) type = 'polymarket';
            else if (tab.url.includes('stake.com') || tab.url.includes('sx.bet')) type = 'stack'; // assuming stack matches sx/stake

            if (!type) {
                // Fallback: Try to scan once to check content script?
                // For now, explicit warning
                if (!confirm("Is this a Polymarket or Stake/SX page? Click OK for Poly, Cancel for Stake/Other.")) {
                    type = 'stack';
                } else {
                    type = 'polymarket';
                }
            }

            chrome.runtime.sendMessage({
                action: "start_monitoring",
                tabId: tab.id,
                url: tab.url,
                type: type
            }, (res) => {
                updateMonitorUI(true);
            });
        });
    }

    if (stopMonitorBtn) {
        stopMonitorBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: "stop_monitoring" }, () => {
                updateMonitorUI(false);
                if (statusText) statusText.textContent = "Monitoring stopped.";
            });
        });
    }

    if (downloadLogsBtn) {
        downloadLogsBtn.addEventListener('click', () => {
            chrome.storage.local.get(['arbHistory'], (res) => {
                const data = res.arbHistory || [];
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'arbitrage_logs.json';
                a.click();
            });
        });
    }

    // Auto-Update UI when storage changes (Monitoring)
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            if (changes.polymarketData || changes.stackData || changes.strictMatch) {
                updateUI();
            }
        }
    });
    // --- Settings Toggle Logic ---
    const settingsToggleBtn = document.getElementById('settingsToggleBtn');
    const settingsContainer = document.getElementById('settingsContainer');

    if (settingsToggleBtn && settingsContainer) {
        settingsToggleBtn.addEventListener('click', () => {
            const isHidden = settingsContainer.style.display === 'none';
            settingsContainer.style.display = isHidden ? 'block' : 'none';
            settingsToggleBtn.style.backgroundColor = isHidden ? '#7f8c8d' : '#95a5a6'; // feedback
        });
    }

    // --- Settings Logic ---
    const tgBotTokenInput = document.getElementById('tgBotToken');
    const tgChatIdInput = document.getElementById('tgChatId');
    const maxPayrollInput = document.getElementById('maxPayroll');
    const stakeAmountInput = document.getElementById('stakeAmount');
    const maxTradesInput = document.getElementById('maxTrades'); // New
    const retryCountInput = document.getElementById('retryCount'); // New
    const autoTradeToggle = document.getElementById('autoTradeToggle');
    const tgTradeToggle = document.getElementById('tgTradeToggle');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');

    const testTgBtn = document.getElementById('testTgBtn');

    // Load Settings
    chrome.storage.local.get([
        'tgBotToken', 'tgChatId', 'maxPayroll', 'stakeAmount', 'maxTrades', 'retryCount',
        'autoTradeEnabled', 'tgTradeEnabled'
    ], (result) => {
        if (result.tgBotToken) tgBotTokenInput.value = result.tgBotToken;
        if (result.tgChatId) tgChatIdInput.value = result.tgChatId;
        if (result.maxPayroll) maxPayrollInput.value = result.maxPayroll;
        if (result.stakeAmount) stakeAmountInput.value = result.stakeAmount;
        if (result.maxTrades) maxTradesInput.value = result.maxTrades;
        retryCountInput.value = result.retryCount || 1; // Default 1
        if (result.autoTradeEnabled) autoTradeToggle.checked = result.autoTradeEnabled;
        if (result.tgTradeEnabled) tgTradeToggle.checked = result.tgTradeEnabled;
    });

    // Save Settings Handler
    saveSettingsBtn.addEventListener('click', () => {
        const settings = {
            tgBotToken: tgBotTokenInput.value.trim(),
            tgChatId: tgChatIdInput.value.trim(),
            maxPayroll: parseFloat(maxPayrollInput.value) || 0,
            stakeAmount: parseFloat(stakeAmountInput.value) || 0,
            maxTrades: parseInt(maxTradesInput.value) || 0,
            retryCount: parseInt(retryCountInput.value) || 1, // Default 1
            autoTradeEnabled: autoTradeToggle.checked,
            tgTradeEnabled: tgTradeToggle.checked,
            blockedFunds: 0, // Reset blocked funds on save
            tradeCount: 0 // Reset session trade count
        };

        chrome.storage.local.set(settings, () => {
            const originalText = saveSettingsBtn.textContent;
            saveSettingsBtn.textContent = "Saved & Reset!";
            saveSettingsBtn.style.backgroundColor = "#2ecc71";
            setTimeout(() => {
                saveSettingsBtn.textContent = originalText;
                saveSettingsBtn.style.backgroundColor = "#27ae60";
            }, 1500);
        });
    });

    // Test Telegram Button
    if (testTgBtn) {
        testTgBtn.addEventListener('click', () => {
            const token = tgBotTokenInput.value.trim();
            const chat = tgChatIdInput.value.trim();
            if (!token || !chat) {
                alert("Please enter Bot Token and Chat ID first.");
                return;
            }

            const msg = "*Test Message* \nCent Arbitrage Bot is connected!";
            const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chat}&text=${encodeURIComponent(msg)}&parse_mode=Markdown`;

            const originalText = testTgBtn.textContent;
            testTgBtn.textContent = "Sending...";
            testTgBtn.disabled = true;

            fetch(url).then(r => r.json()).then(data => {
                if (data.ok) {
                    testTgBtn.textContent = "Sent!";
                    testTgBtn.style.backgroundColor = "#27ae60";
                } else {
                    testTgBtn.textContent = "Error";
                    testTgBtn.style.backgroundColor = "#e74c3c";
                    alert("Telegram Error: " + (data.description || "Unknown error"));
                }
            }).catch(err => {
                testTgBtn.textContent = "Failed";
                testTgBtn.style.backgroundColor = "#e74c3c";
                console.error(err);
            }).finally(() => {
                setTimeout(() => {
                    testTgBtn.textContent = originalText;
                    testTgBtn.style.backgroundColor = "#3498db";
                    testTgBtn.disabled = false;
                }, 2000);
            });
        });
    }

    // Save Settings
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            const settings = {
                tgBotToken: tgBotTokenInput.value.trim(),
                tgChatId: tgChatIdInput.value.trim(),
                maxPayroll: parseFloat(maxPayrollInput.value) || 0,
                stakeAmount: parseFloat(stakeAmountInput.value) || 0,
                maxTrades: parseInt(maxTradesInput.value) || 0,
                autoTradeEnabled: autoTradeToggle.checked,
                tgTradeEnabled: tgTradeToggle.checked,
                blockedFunds: 0, // Reset blocked funds
                tradeCount: 0    // Reset trade count
            };

            chrome.storage.local.set(settings, () => {
                const originalText = saveSettingsBtn.textContent;
                saveSettingsBtn.textContent = "Saved! Funds & Count Reset.";
                saveSettingsBtn.style.backgroundColor = "#27ae60"; // Green

                setTimeout(() => {
                    saveSettingsBtn.textContent = originalText;
                    saveSettingsBtn.style.backgroundColor = "#3498db"; // Reset to original blue or similar
                }, 1500);

                // Update UI immediately (optional, but good for feedback)
                updateUI();
            });
        });
    }

    // --- Bet History Section ---
    const historyToggleBtn = document.getElementById('historyToggleBtn');
    const historyList = document.getElementById('historyList');
    const historyActions = document.getElementById('historyActions');
    const historyBadge = document.getElementById('historyBadge');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');

    function formatDuration(ms) {
        if (!ms) return '-';
        if (ms >= 1000) {
            return `${(ms / 1000).toFixed(2)}s`;
        }
        return `${ms}ms`;
    }

    function renderBetHistory() {
        chrome.storage.local.get(['betHistory'], (result) => {
            const history = result.betHistory || [];
            
            // Update badge
            if (historyBadge) {
                historyBadge.textContent = history.length;
                historyBadge.style.background = history.length > 0 ? '#27ae60' : '#95a5a6';
            }
            
            if (!historyList) return;
            
            if (history.length === 0) {
                historyList.innerHTML = '<p style="text-align: center; color: #999; font-size: 11px; padding: 10px;">No bets yet</p>';
                return;
            }
            
            // SVG Icons
            const icons = {
                check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align: middle;"><path d="M20 6L9 17l-5-5" stroke="#27ae60" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
                pending: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align: middle;"><circle cx="12" cy="12" r="10" stroke="#f39c12" stroke-width="2"/><path d="M12 6v6l4 2" stroke="#f39c12" stroke-width="2" stroke-linecap="round"/></svg>`,
                failed: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="vertical-align: middle;"><circle cx="12" cy="12" r="10" stroke="#e74c3c" stroke-width="2"/><path d="M15 9l-6 6M9 9l6 6" stroke="#e74c3c" stroke-width="2" stroke-linecap="round"/></svg>`,
                money: `<svg width="12" height="12" viewBox="0 0 24 24" fill="#27ae60" style="vertical-align: middle;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/></svg>`,
                timer: `<svg width="12" height="12" viewBox="0 0 24 24" fill="#3498db" style="vertical-align: middle;"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`,
                payout: `<svg width="12" height="12" viewBox="0 0 24 24" fill="#27ae60" style="vertical-align: middle;"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>`,
                warning: `<svg width="12" height="12" viewBox="0 0 24 24" fill="#e74c3c" style="vertical-align: middle;"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
                refresh: `<svg width="12" height="12" viewBox="0 0 24 24" fill="#f39c12" style="vertical-align: middle;"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`
            };
            
            let html = '';
            history.slice(0, 20).forEach((bet, idx) => {
                let statusIcon, statusColor, statusBg;
                
                switch(bet.status) {
                    case 'COMPLETED':
                    case 'SUCCESS':
                        statusIcon = icons.check;
                        statusColor = '#27ae60';
                        statusBg = '';
                        break;
                    case 'PENDING':
                        statusIcon = icons.pending;
                        statusColor = '#f39c12';
                        statusBg = 'background: linear-gradient(90deg, #fff9e6 0%, #fff 100%);';
                        break;
                    case 'ERROR':
                        statusIcon = icons.warning;
                        statusColor = '#e67e22';
                        statusBg = 'background: linear-gradient(90deg, #fff5e6 0%, #fff 100%);';
                        break;
                    case 'FAILED':
                    default:
                        statusIcon = icons.failed;
                        statusColor = '#e74c3c';
                        statusBg = '';
                }
                
                const time = new Date(bet.timestamp).toLocaleTimeString();
                const date = new Date(bet.timestamp).toLocaleDateString();
                
                html += `
                    <div style="padding: 8px; border-bottom: 1px solid #eee; font-size: 11px; ${statusBg || (idx % 2 === 0 ? 'background: #f9f9f9;' : '')}">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-weight: bold; color: ${statusColor};">${statusIcon} ${bet.team || 'Unknown'}</span>
                            <span style="color: #666; font-size: 10px;">${time}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-top: 4px; color: #555;">
                            <span>${icons.money} $${bet.amount || '0'} @ ${bet.odds || '-'}</span>
                            ${bet.status === 'PENDING' 
                                ? `<span style="color: #f39c12; font-weight: bold;">${icons.pending} Processing...</span>`
                                : `<span style="color: #3498db; font-weight: bold;">${icons.timer} ${formatDuration(bet.duration)}</span>`
                            }
                        </div>
                        ${bet.payout ? `<div style="color: #27ae60; margin-top: 2px;">${icons.payout} Payout: $${bet.payout}</div>` : ''}
                        ${bet.reason ? `<div style="color: #e74c3c; margin-top: 2px; font-size: 10px;">${icons.warning} ${bet.reason}</div>` : ''}
                        ${bet.status === 'PENDING' ? `<div style="color: #f39c12; margin-top: 2px; font-size: 10px;">${icons.refresh} Waiting for green checkmark confirmation...</div>` : ''}
                    </div>
                `;
            });
            
            historyList.innerHTML = html;
        });
    }

    // Toggle history panel
    if (historyToggleBtn) {
        historyToggleBtn.addEventListener('click', () => {
            const isHidden = historyList.style.display === 'none';
            historyList.style.display = isHidden ? 'block' : 'none';
            if (historyActions) historyActions.style.display = isHidden ? 'block' : 'none';
            if (isHidden) renderBetHistory();
        });
    }

    // Clear history button
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (confirm('Clear all bet history?')) {
                chrome.storage.local.set({ betHistory: [] }, () => {
                    renderBetHistory();
                });
            }
        });
    }

    // Listen for bet history updates
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.betHistory) {
            renderBetHistory();
        }
    });

    // Initial render
    renderBetHistory();

});
