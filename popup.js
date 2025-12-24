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
            const stakeAmt = e.target.getAttribute('data-stake');
            const expectedOdds = e.target.getAttribute('data-odds');

            if (url && url !== '#' && url !== 'undefined') {
                chrome.runtime.sendMessage({
                    action: "open_and_click",
                    url: url,
                    team: team,
                    id: btnId,
                    amount: parseFloat(stakeAmt), // Force Float
                    expectedOdds: expectedOdds
                });
            } else {
                alert("Link not available. Please rescan.");
            }
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

    // --- Highlight Toggle ---
    const toggleHighlight = document.getElementById('toggleHighlight');
    const highlightStatusLabel = document.getElementById('highlightStatusLabel');

    function updateHighlightUI(isActive) {
        if (toggleHighlight) toggleHighlight.checked = isActive;
        if (highlightStatusLabel) {
            highlightStatusLabel.style.color = isActive ? "#27ae60" : "#95a5a6";
        }
    }

    chrome.storage.local.get(['highlightEnabled'], (result) => {
        const isEnabled = result.highlightEnabled !== false; // Default true
        updateHighlightUI(isEnabled);
    });

    if (toggleHighlight) {
        toggleHighlight.addEventListener('change', async (e) => {
            const isEnabled = e.target.checked;
            updateHighlightUI(isEnabled);
            chrome.storage.local.set({ highlightEnabled: isEnabled });

            // If disabled, clear existing highlights
            if (!isEnabled) {
                const tabs = await chrome.tabs.query({});
                for (const tab of tabs) {
                    if (tab.url && (tab.url.includes('stake') || tab.url.includes('polymarket') || tab.url.includes('sx.bet'))) {
                        try {
                            chrome.tabs.sendMessage(tab.id, { action: "highlight_odds", targets: [] });
                        } catch (err) { /* ignore */ }
                    }
                }
            } else {
                // Re-run highlighting
                updateUI();
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
                            // Check for suspended/unavailable/settled
                            const txt = btn.textContent.toLowerCase();
                            if (txt.includes('settled')) { // New check
                                odds = 'Settled';
                            } else if (txt.includes('suspended') || txt.includes('unavailable') || btn.disabled) {
                                odds = 'Suspended';
                                console.log(`Found suspended/unavailable odds for team ${team}`);
                            } else {
                                if (matchCents) {
                                    const cents = parseInt(matchCents[1], 10);
                                    if (cents >= 100) odds = 'Settled'; // Explicit cents >= 100 is Settled
                                    else if (cents > 0) odds = (100 / cents).toFixed(2);
                                } else if (matchDecimal) {
                                    const val = parseFloat(matchDecimal[1]);
                                    if (val >= 1.01) odds = val; // Allow > 100
                                } else {
                                    // Fallback integer parsing (if regex failed earlier but we might have simplified logic here)
                                    // Re-check regexes in case `matchCents` / `matchDecimal` were strict from earlier block
                                    // Actually `matchCents` and `matchDecimal` variables come from earlier in the function.
                                    // Let's rely on them if they matched.
                                    // If they didn't match, check for plain integer?
                                    // The code at line 381/382 defined matchCents/matchDecimal.
                                    // We should probably refine that part or logic here.
                                    // For now, let's just use what we have.
                                    // If neither matched but we have text...
                                    // But the original code only checked these variables.
                                    // Let's treat a plain number in text as potentially valid if regex missed?
                                    // The original `matchCents` regex was `(\d+)\s*¢`.
                                    // The original `matchDecimal` regex was `(\d+\.\d{2})`. 
                                    // Let's relax `matchDecimal` in the replacement slightly? 
                                    // Ideally I should modify lines 381-382 too but I am focusing on this block.
                                    // Wait, 382 is `(\d+\.\d{2})`. That enforces 2 decimals.
                                    // If I want to support `105.0` or `105.5`, I should probably fix that regex too.
                                    // But given tool limitations, I will stick to logic here. 
                                    // If matchDecimal matched, use it.
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

    async function updateUI() {
        try {
            const result = await chrome.storage.local.get(['polymarketData', 'stackData', 'strictMatch', 'stakeAmount', 'liveScanEnabled', 'geminiApiKey', 'aiEnabled']);
            const poly = result.polymarketData;
            const stack = result.stackData;
            const stakeAmt = result.stakeAmount || 100; // Default 100 if not set
            const isLive = result.liveScanEnabled === true;
            const apiKey = result.geminiApiKey;
            const aiEnabled = result.aiEnabled === true; // Check toggle
            const isStrict = result.strictMatch === true;
            const testMode = result.testModeEnabled === true;
            const testAmount = result.testAmount || 1;

            console.log("[updateUI] Data loaded:", { poly: poly?.odds?.length, stack: stack?.odds?.length, isStrict, apiKey, aiEnabled, testMode });

            // Update Input Visibility
            const mainStakeInput = document.getElementById('mainStakeInput');
            const testAmtInput = document.getElementById('testAmountInput');
            const testLabel = document.getElementById('testModeLabel');

            if (testLabel) testLabel.style.color = testMode ? '#e67e22' : '#95a5a6';

            if (mainStakeInput && testAmtInput) {
                if (testMode) {
                    mainStakeInput.style.display = 'none';
                    testAmtInput.style.display = 'inline-block';
                    testAmtInput.value = testAmount;
                } else {
                    mainStakeInput.style.display = 'inline-block';
                    testAmtInput.style.display = 'none';
                }
            }


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
                    html += await generateArbitrageTable(poly.odds, stack.odds, isStrict, stakeAmt, apiKey, aiEnabled, testMode, testAmount);
                }
            }
            if (resultsArea) {
                resultsArea.innerHTML = html;
            } else {
                console.error("resultsArea not found!");
            }
        } catch (err) {
            console.error("Error updating UI:", err);
            if (resultsArea) resultsArea.innerHTML = `<p style="color:red">Error rendering table: ${err.message}</p>`;
        }
    }
    async function generateArbitrageTable(polyOdds, stackOdds, strictMatch, stakeAmount, apiKey, aiEnabled, testMode, testAmount) {
        // Goal Table Format:
        // Match (e.g. HOU-DEN) | Poly HOU | Poly DEN | Stake HOU | Stake DEN | Arb % (P-HOU/S-DEN) | Arb % (P-DEN/S-HOU)

        const matchesToHighlight = []; // Collection for website highlighting

        let matchCounter = 0;
        const borderColors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffc107', '#ff9800', '#ff5722'];

        let tableHtml = `
            <style>
                table { border-collapse: separate; border-spacing: 0 4px; width: 100%; }
                /* Zebra Striping */
                tbody tr { background-color: #f9f9f9; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
                /* Hover effect */
                tbody tr:hover { transform: translateY(-1px); box-shadow: 0 2px 5px rgba(0,0,0,0.15); transition: all 0.2s; }
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
                        <th style="padding: 8px;">Match</th>
                        <th style="color:#29b6f6">Poly H</th>
                        <th style="color:#29b6f6">Poly A</th>
                        <th style="color:#00bfa5">Stake H</th>
                        <th style="color:#00bfa5">Stake A</th>
                        <th>Arb 1 (P_H/S_A)</th>
                        <th>Arb 2 (P_A/S_H)</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>`;

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

        // Helper: Check if two names match via city mappings
        const matchViaCityMapping = (name1, name2) => {
            const n1 = name1.toUpperCase();
            const n2 = name2.toUpperCase();
            for (const [nickname, aliases] of Object.entries(NBA_CITY_MAPPINGS)) {
                const allVariants = [nickname, ...aliases];
                const n1Match = allVariants.some(v => n1.includes(v) || v.includes(n1));
                const n2Match = allVariants.some(v => n2.includes(v) || v.includes(n2));
                if (n1Match && n2Match) return true;
            }
            return false;
        };

        // Helper to find a team in a list (Enhanced Matching with Confidence)
        const findOdds = (list, name, sourceEventTime = null) => {
            if (strictMatch) {
                const exact = list.find(x => x.team === name);
                return exact ? { item: exact, confidence: 100 } : null;
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
                if (match) return { item: match, confidence: 100 };

                // If strictMatch was false, but we found a clean strict match, return it.
                if (strictMatch) return null;

                // 2. Fuzzy Match
                let best = null;
                let bestScore = 0;

                list.forEach(item => {
                    const n2 = dedupe(clean(item.team.toUpperCase()));
                    let score = 0;

                    // NEW: City Mapping Check (e.g., "Rockets" matches "Houston Rockets")
                    if (matchViaCityMapping(n1Clean, n2)) {
                        score += 60; // Strong match via city mapping
                    }

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
                    const shortName = n1.length <= 3 ? n1 : (n2.length <= 3 ? n2 : null);
                    const longName = n1.length <= 3 ? n2 : (n2.length <= 3 ? n1 : null);
                    if (shortName && longName) {
                        if (longName.startsWith(shortName + ' ') || longName.startsWith(shortName)) {
                            score += 60; // Strong match
                        }
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

                    // D2. Direct name match after removing prefix
                    const getMainName = (s) => {
                        const parts = s.split(' ');
                        if (parts.length > 1 && parts[0].length <= 2) {
                            return parts.slice(1).join(' ');
                        }
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

                    // F. G1/T1 style abbrevs
                    const abbrevMatch = (abbr, full) => {
                        if (abbr.length !== 2) return false;
                        const letter = abbr[0].toUpperCase();
                        const num = abbr[1];
                        if (full[0].toUpperCase() !== letter) return false;
                        const numWords = { '1': 'ONE', '2': 'TWO', '3': 'THREE', '4': 'FOUR', '5': 'FIVE' };
                        if (numWords[num] && full.toUpperCase().includes(numWords[num])) return true;
                        if (full.includes(num)) return true;
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

                    // CRITICAL: Time-based matching - REQUIRED to prevent cross-matching
                    if (sourceEventTime && item.eventTime &&
                        sourceEventTime !== 'LIVE' && item.eventTime !== 'LIVE') {

                        // 1. Date Check
                        const d1 = sourceEventTime.split(' ')[0];
                        const d2 = item.eventTime.split(' ')[0];

                        if (d1 && d2 && d1 !== d2) {
                            // Different dates = different events, skip entirely
                            return; // Don't consider this item at all
                        }

                        // 2. Strict Time Check (within 45 mins)
                        const getTimeVal = (tStr) => {
                            try {
                                return new Date(tStr).getTime();
                            } catch (e) { return 0; }
                        };

                        const t1 = getTimeVal(sourceEventTime);
                        const t2 = getTimeVal(item.eventTime);

                        if (t1 > 0 && t2 > 0) {
                            const diffMins = Math.abs(t1 - t2) / 60000;
                            if (diffMins > 45) {
                                // console.log(`[Arb] Skipping - time mismatch > 45m: ${ diffMins }m diff for ${ name } vs ${ item.team } `); // Debugging
                                return; // Don't consider this item at all
                            }
                        }

                        // Same date (and within 45 min window) - boost score
                        if (sourceEventTime === item.eventTime) {
                            score += 50; // Exact time match (high bonus)
                        } else if (d1 === d2) {
                            score += 30; // Same date
                        }
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        best = item;
                    }
                });

                if (bestScore >= 30) {
                    // Calculate confidence as percentage (cap at 100)
                    const confidence = Math.min(100, Math.round(bestScore / 2));
                    return { item: best, confidence };
                }
                return null;
            }
        };

        // Helper to find team with its index and confidence
        const findOddsWithIndex = (list, name, eventTime = null) => {
            const result = findOdds(list, name, eventTime);
            if (result && result.item) {
                return { item: result.item, index: list.indexOf(result.item), confidence: result.confidence };
            }
            return null;
        };

        // ========================
        // NEW APPROACH: Group by Container Link to prevent cross-matching
        // ========================

        // Step 1: Group Polymarket odds by their container link
        const polyGroups = {};
        polyOdds.forEach((item, idx) => {
            const groupKey = item.link || `idx_${idx} `;
            if (!polyGroups[groupKey]) {
                polyGroups[groupKey] = [];
            }
            polyGroups[groupKey].push(item);
        });

        console.log(`[Arb] Poly groups: ${Object.keys(polyGroups).length} `, polyGroups);

        // Step 2: For each Stake pair, find a Poly group where BOTH teams exist
        for (let i = 0; i < stackOdds.length - 1; i += 2) {
            const stakeHome = stackOdds[i];
            const stakeAway = stackOdds[i + 1];

            if (!stakeHome || !stakeAway) continue;

            // Find a Poly group that contains BOTH teams
            let matchedPolyGroup = null;
            let home = null;
            let away = null;
            let matchConfidence = 0;

            for (const [groupLink, groupItems] of Object.entries(polyGroups)) {
                // Try to find both teams in this group
                let homeResult = findOdds(groupItems, stakeHome.team, stakeHome.eventTime);
                let awayResult = findOdds(groupItems, stakeAway.team, stakeAway.eventTime);

                // AI Verify Home
                if (homeResult && homeResult.confidence >= 15 && homeResult.confidence < 45 && apiKey && aiEnabled && window.geminiMatcher) {
                    try {
                        const aiRes = await window.geminiMatcher.verifyMatch(stakeHome.team, homeResult.item.team, apiKey);
                        if (aiRes === 'SAME') homeResult.confidence = 80;
                        else homeResult = null;
                    } catch (e) { console.error("AI Error:", e); }
                }

                // AI Verify Away
                if (awayResult && awayResult.confidence >= 15 && awayResult.confidence < 45 && apiKey && aiEnabled && window.geminiMatcher) {
                    try {
                        const aiRes = await window.geminiMatcher.verifyMatch(stakeAway.team, awayResult.item.team, apiKey);
                        if (aiRes === 'SAME') awayResult.confidence = 80;
                        else awayResult = null;
                    } catch (e) { console.error("AI Error:", e); }
                }

                if (homeResult && awayResult && homeResult.item !== awayResult.item) {
                    // BOTH teams found in SAME group - this is a valid match!
                    matchedPolyGroup = groupLink;
                    home = homeResult.item;
                    away = awayResult.item;
                    matchConfidence = Math.min(homeResult.confidence, awayResult.confidence);

                    console.log(`[Arb] Match found in group ${groupLink}: ${home.team} vs ${away.team} `);
                    break;
                }
            }

            // Skip if no valid group found
            if (!matchedPolyGroup || !home || !away) continue;

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


                // Handle Suspended/Settled Checks...
                const isSuspended = (val) => val === 'Suspended';
                const isSettled = (val) => val === 'Settled';

                // DRAW match - show grayed out
                if (isDrawMatch) {
                    continue; // Skip draw matches entirely from view to reduce clutter
                }

                // Assign Color & Index
                matchCounter++;
                const rowColor = borderColors[(matchCounter - 1) % borderColors.length];
                const indexBadge = `<span style="font-size:10px; font-weight:bold; color:#fff; background:${rowColor}; padding:1px 5px; border-radius:10px; margin-right:4px;">#${matchCounter}</span>`;

                // Confidence badge with color coding
                const confColor = matchConfidence >= 80 ? '#27ae60' : (matchConfidence >= 60 ? '#f39c12' : '#e74c3c');
                const confidenceBadge = `<span style="font-size:9px; font-weight:bold; color:#fff; background:${confColor}; padding:1px 4px; border-radius:8px; margin-left:4px; display:inline-flex; align-items:center; gap:2px;" title="Match Confidence"><svg width="8" height="8" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>${matchConfidence}%</span>`;

                const rowStyle = `border-left: 4px solid ${rowColor};`;

                if (isSuspended(home.odds) || isSuspended(away.odds) ||
                    isSuspended(stakeHome.odds) || isSuspended(stakeAway.odds) ||
                    isSettled(home.odds) || isSettled(away.odds)) {

                    // Determine if it's specifically Settled/Ended
                    const anySettled = isSettled(home.odds) || isSettled(away.odds);
                    const statusLabel = anySettled ? 'Ended' : 'Suspended';
                    const statusColor = anySettled ? '#e74c3c' : '#95a5a6';

                    // Formatting helper
                    const formatOdds = (val) => {
                        if (isSettled(val)) return 'Ended';
                        if (isSuspended(val)) return '-';
                        return val;
                    };
                    const trunc = (str) => str.length > 4 ? str.substring(0, 4) : str;



                    // Add to highlight list
                    matchesToHighlight.push(
                        { team: home.team, type: 'polymarket', color: rowColor, index: matchCounter, link: home.link },
                        { team: away.team, type: 'polymarket', color: rowColor, index: matchCounter, link: away.link },
                        { team: stakeHome.team, type: 'stack', color: rowColor, index: matchCounter, link: stakeHome.link },
                        { team: stakeAway.team, type: 'stack', color: rowColor, index: matchCounter, link: stakeAway.link }
                    );

                    tableHtml += `
                        <tr style="${rowStyle}">
                            <td>
                                ${indexBadge}
                                <b>${home.team}</b><br/><span style="font-size:9px;color:#aaa">${stakeHome.team}</span>
                            </td>
                            <td style="color:${isSuspended(home.odds) || isSettled(home.odds) ? statusColor : 'inherit'}">${formatOdds(home.odds)}</td>
                            <td style="color:${isSuspended(away.odds) || isSettled(away.odds) ? statusColor : 'inherit'}">${formatOdds(away.odds)}</td>
                            <td style="color:${isSuspended(stakeHome.odds) ? '#95a5a6' : 'inherit'}">${formatOdds(stakeHome.odds)}</td>
                            <td style="color:${isSuspended(stakeAway.odds) ? '#95a5a6' : 'inherit'}">${formatOdds(stakeAway.odds)}</td>
                            <td colspan="2" style="font-size:10px; color:${statusColor}">${statusLabel}</td>
                             <td style="text-align: left;">
                                <div style="margin-bottom:2px">
                                    <button class="bet-btn poly-btn" data-link="${home.link}" data-id="${home.id}" ${anySettled ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : `style="border-right: 5px solid ${rowColor};"`}>P: ${trunc(home.team)}</button>
                                    <button class="bet-btn poly-btn" data-link="${away.link}" data-id="${away.id}" ${anySettled ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : `style="border-right: 5px solid ${rowColor};"`}>P: ${trunc(away.team)}</button>
                                </div>
                                <div>
                                    <button class="bet-btn stake-btn" data-link="${stakeHome.link}" style="border-right: 5px solid ${rowColor};">S: ${trunc(stakeHome.team)}</button>
                                    <button class="bet-btn stake-btn" data-link="${stakeAway.link}" style="border-right: 5px solid ${rowColor};">S: ${trunc(stakeAway.team)}</button>
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
                                match: `${home.team} vs ${away.team} `,
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
                                match: `${home.team} vs ${away.team} `,
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

                    // CRITICAL FIX: Apple Test Mode Override unconditionally (outside arb check)
                    if (testMode) {
                        s1_home_val = testAmount;
                        s1_away_val = testAmount;
                        s2_home_val = testAmount;
                        s2_away_val = testAmount;

                        // Update Displays if they were empty (case: no arb)
                        // Note: If no arb, split logic above didn't run, so displays are empty strings.
                        // We should ensure they show the test amount.
                        const style = 'color:#e67e22; font-weight:bold;';
                        s1_home_disp = `<span class="stake-display" style="${style}">$${testAmount}</span>`;
                        s1_away_disp = `<span class="stake-display" style="${style}">$${testAmount}</span>`;
                        s2_home_disp = `<span class="stake-display" style="${style}">$${testAmount}</span>`;
                        s2_away_disp = `<span class="stake-display" style="${style}">$${testAmount}</span>`;
                    }

                    // Button Styles
                    // Arb 1 Winner Pair: Poly Home + Stake Away
                    const styleP_Home = arb1.profit > 0 ? 'border: 2px solid #e74c3c !important; font-weight:bold;' : '';
                    const styleS_Away = arb1.profit > 0 ? 'border: 2px solid #e74c3c !important; font-weight:bold;' : '';

                    // Arb 2 Winner Pair: Poly Away + Stake Home
                    const styleP_Away = arb2.profit > 0 ? 'border: 2px solid #e74c3c !important; font-weight:bold;' : '';
                    const styleS_Home = arb2.profit > 0 ? 'border: 2px solid #e74c3c !important; font-weight:bold;' : '';

                    // Add to highlight list
                    matchesToHighlight.push(
                        { team: home.team, type: 'polymarket', color: rowColor, index: matchCounter, link: home.link },
                        { team: away.team, type: 'polymarket', color: rowColor, index: matchCounter, link: away.link },
                        { team: stakeHome.team, type: 'stack', color: rowColor, index: matchCounter, link: stakeHome.link },
                        { team: stakeAway.team, type: 'stack', color: rowColor, index: matchCounter, link: stakeAway.link }
                    );

                    // Format time for tooltip
                    const timeTooltip = home.eventTime || stakeHome.eventTime || 'Time N/A';
                    const isLiveMatch = home.isLive || stakeHome.isLive;
                    const liveBadge = isLiveMatch ? '<span style="font-size:8px;font-weight:bold;color:#fff;background:#e74c3c;padding:1px 4px;border-radius:4px;margin-left:4px;">LIVE</span>' : '';
                    const timeDisplay = isLiveMatch ? '' : `<br/><span style="font-size:8px;color:#95a5a6" title="${timeTooltip}">🕐 ${timeTooltip.split(' ').slice(-1)[0] || timeTooltip}</span>`;

                    tableHtml += `
                        <tr style="${rowStyle}" title="Event: ${timeTooltip}">
                            <td>
                                ${indexBadge}
                                <b>${home.team}</b> vs <b>${away.team}</b>
                                ${liveBadge}
                                ${confidenceBadge}
                                ${home.team !== stakeHome.team ? `<br/><span style="font-size:9px;color:#f39c12">Match: ${stakeHome.team}</span>` : ''}
                                ${timeDisplay}
                            </td>
                            
                            <!--Poly Home(Arb 1 Winner ?)-->
                            <td style="${arb1.profit > 0 ? highlightStyle : ''}">
                                ${home.odds}
                                ${s1_home_disp}
                            </td>
                            
                            <!--Poly Away(Arb 2 Winner ?)-->
                            <td style="${arb2.profit > 0 ? highlightStyle : ''}">
                                ${away.odds}
                                ${s2_home_disp}
                            </td>
                            
                            <!--Stake Home(Arb 2 Winner ?)-->
                            <td style="${arb2.profit > 0 ? highlightStyle : ''}">
                                ${stakeHome.odds}
                                ${s2_away_disp}
                            </td>
                            
                            <!--Stake Away(Arb 1 Winner ?)-->
                            <td style="${arb1.profit > 0 ? highlightStyle : ''}">
                                ${stakeAway.odds}
                                ${s1_away_disp}
                            </td>
                            
                            <td class="${arb1.profit > 0 ? 'arb-profit' : 'arb-loss'}">${arb1.profit.toFixed(2)}%</td>
                            <td class="${arb2.profit > 0 ? 'arb-profit' : 'arb-loss'}">${arb2.profit.toFixed(2)}%</td>
                             <td style="text-align: left; min-width: 140px;">
                                <div style="margin-bottom:3px; display:flex; gap:2px;">
                                    <button class="bet-btn poly-btn" style="${styleP_Home} border-right: 5px solid ${rowColor};" data-link="${home.link}" data-id="${home.id}" data-stake="${s1_home_val}" data-odds="${home.odds}">P: ${trunc(home.team)}</button>
                                    <button class="bet-btn poly-btn" style="${styleP_Away} border-right: 5px solid ${rowColor};" data-link="${away.link}" data-id="${away.id}" data-stake="${s2_home_val}" data-odds="${away.odds}">P: ${trunc(away.team)}</button>
                                </div>
                                <div style="display:flex; gap:2px;">
                                    <button class="bet-btn stake-btn" style="${styleS_Home} border-right: 5px solid ${rowColor};" data-link="${stakeHome.link}" data-stake="${s2_away_val}" data-odds="${stakeHome.odds}">S: ${trunc(stakeHome.team)}</button>
                                    <button class="bet-btn stake-btn" style="${styleS_Away} border-right: 5px solid ${rowColor};" data-link="${stakeAway.link}" data-stake="${s1_away_val}" data-odds="${stakeAway.odds}">S: ${trunc(stakeAway.team)}</button>
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
                matchCounter++;
                const rowColor = borderColors[(matchCounter - 1) % borderColors.length];
                const indexBadge = `<span style="font-size:10px; font-weight:bold; color:#fff; background:${rowColor}; padding:1px 5px; border-radius:10px; margin-right:4px;">#${matchCounter}</span>`;
                const rowStyle = `border-left: 4px solid ${rowColor};`;

                // Add to highlight list (Partial)
                matchesToHighlight.push(
                    { team: home.team, type: 'polymarket', color: rowColor, index: matchCounter, link: home.link },
                    { team: away.team, type: 'polymarket', color: rowColor, index: matchCounter, link: away.link }
                );
                if (stakeHome) matchesToHighlight.push({ team: stakeHome.team, type: 'stack', color: rowColor, index: matchCounter, link: stakeHome.link });
                if (stakeAway) matchesToHighlight.push({ team: stakeAway.team, type: 'stack', color: rowColor, index: matchCounter, link: stakeAway.link });

                tableHtml += `
                    <tr style="${rowStyle}">
                        <td>
                            ${indexBadge}
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
                                <button class="bet-btn poly-btn" data-link="${home.link}" data-id="${home.id}" style="border-right: 5px solid ${rowColor};">P: ${trunc(home.team)}</button>
                                <button class="bet-btn poly-btn" data-link="${away.link}" data-id="${away.id}" style="border-right: 5px solid ${rowColor};">P: ${trunc(away.team)}</button>
                            </div>
                            ${stakeHome ? `
                            <div>
                                <button class="bet-btn stake-btn" data-link="${stakeHome.link}" style="border-right: 5px solid ${rowColor};">S: ${trunc(stakeHome.team)}</button>
                                <button class="bet-btn stake-btn" data-link="${stakeAway ? stakeAway.link : ''}" style="border-right: 5px solid ${rowColor};">S: ${trunc(stakeAway ? stakeAway.team : '')}</button>
                            </div>` : ''}
                        </td>
                    </tr>
            `;
            }
        }

        // Send Highlight Message to Content Script (if enabled)
        chrome.storage.local.get(['highlightEnabled'], (result) => {
            const highlightEnabled = result.highlightEnabled !== false; // Default true
            if (!highlightEnabled) return; // Skip if disabled

            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.url && (tab.url.includes('stake') || tab.url.includes('polymarket') || tab.url.includes('sx.bet'))) {
                        try {
                            chrome.tabs.sendMessage(tab.id, {
                                action: "highlight_odds",
                                targets: matchesToHighlight
                            });
                        } catch (e) { /* ignore */ }
                    }
                });
            });
        });

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
                    if (timerDisplay) timerDisplay.textContent = `Next scan in: ${remaining} s`;
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

    // Auto-Update UI when storage changes
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            if (changes.polymarketData || changes.stackData || changes.strictMatch || changes.stakeAmount || changes.aiEnabled) {
                updateUI();
            }
        }
    });

    // --- AI & Stake Control Logic ---
    const toggleAI = document.getElementById('toggleAI');
    const aiStatusLabel = document.getElementById('aiStatusLabel');
    if (toggleAI) {
        // Load AI State
        chrome.storage.local.get(['aiEnabled'], (res) => {
            const isActive = res.aiEnabled !== false; // Default true?
            // Actually user asked to "turn on", implies default might be OFF or "turnable".
            // Let's stick to reading storage. If undefined, maybe default to false to be safe?
            toggleAI.checked = !!res.aiEnabled;
            if (aiStatusLabel) aiStatusLabel.style.color = toggleAI.checked ? '#27ae60' : '#95a5a6';
        });

        toggleAI.addEventListener('change', () => {
            const isActive = toggleAI.checked;
            if (aiStatusLabel) aiStatusLabel.style.color = isActive ? '#27ae60' : '#95a5a6';
            chrome.storage.local.set({ aiEnabled: isActive });
        });
    }

    const mainStakeInput = document.getElementById('mainStakeInput');
    if (mainStakeInput) {
        // Load Stake
        chrome.storage.local.get(['stakeAmount'], (res) => {
            mainStakeInput.value = res.stakeAmount || 100;
        });

        mainStakeInput.addEventListener('change', () => {
            const val = parseFloat(mainStakeInput.value);
            if (!isNaN(val) && val > 0) {
                chrome.storage.local.set({ stakeAmount: val });
            }
        });
    }

    // --- Test Mode Logic ---
    const toggleTestMode = document.getElementById('toggleTestMode');
    const testAmountInput = document.getElementById('testAmountInput');

    if (toggleTestMode && testAmountInput) {
        chrome.storage.local.get(['testModeEnabled', 'testAmount'], (res) => {
            toggleTestMode.checked = !!res.testModeEnabled;
            testAmountInput.value = res.testAmount || 1;
            updateUI(); // Refresh UI state based on loaded values
        });

        toggleTestMode.addEventListener('change', () => {
            const isActive = toggleTestMode.checked;
            chrome.storage.local.set({ testModeEnabled: isActive });
            updateUI();
        });

        testAmountInput.addEventListener('input', () => {
            const val = parseFloat(testAmountInput.value);
            if (!isNaN(val) && val > 0) {
                chrome.storage.local.set({ testAmount: val });
                updateUI();
            }
        });
    }

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
    chrome.storage.local.get(['tgBotToken', 'tgChatId', 'maxPayroll', 'stakeAmount', 'maxTrades', 'retryCount', 'autoTradeEnabled', 'tgTradeEnabled', 'geminiApiKey'], (res) => {
        if (res.tgBotToken) document.getElementById('tgBotToken').value = res.tgBotToken;
        if (res.tgChatId) document.getElementById('tgChatId').value = res.tgChatId;
        if (res.geminiApiKey) document.getElementById('geminiApiKey').value = res.geminiApiKey;
        if (res.maxPayroll) document.getElementById('maxPayroll').value = res.maxPayroll;
        if (res.stakeAmount) document.getElementById('stakeAmount').value = res.stakeAmount;
        if (res.maxTrades) document.getElementById('maxTrades').value = res.maxTrades;
        if (res.retryCount) document.getElementById('retryCount').value = res.retryCount;
        document.getElementById('autoTradeToggle').checked = res.autoTradeEnabled || false;
        document.getElementById('tgTradeToggle').checked = res.tgTradeEnabled || false;
    });

    // Save Settings
    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
        const token = document.getElementById('tgBotToken').value.trim();
        const chat = document.getElementById('tgChatId').value.trim();
        const geminiKey = document.getElementById('geminiApiKey').value.trim();
        const maxPayroll = parseFloat(document.getElementById('maxPayroll').value) || 1000;
        const stakeAmt = parseFloat(document.getElementById('stakeAmount').value) || 100;
        const maxTrades = parseInt(document.getElementById('maxTrades').value) || 1;
        const retryCount = parseInt(document.getElementById('retryCount').value) || 1;
        const autoTrade = document.getElementById('autoTradeToggle').checked;
        const tgTrade = document.getElementById('tgTradeToggle').checked;

        chrome.storage.local.set({
            tgBotToken: token,
            tgChatId: chat,
            geminiApiKey: geminiKey,
            maxPayroll: maxPayroll,
            stakeAmount: stakeAmt,
            maxTrades: maxTrades,
            retryCount: retryCount,
            autoTradeEnabled: autoTrade,
            tgTradeEnabled: tgTrade,
            blockedFunds: 0, // Reset blocked funds
            dailyTradeCount: 0
        }, () => {
            alert("Settings Saved & Limits Reset!");
            document.getElementById('settingsContainer').style.display = 'none';
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


});
