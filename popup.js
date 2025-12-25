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
                        const msg = `🐞 *Debug Report*\n\n` +
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
                    amount: stakeAmt,
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

    // --- Highlight Toggle Logic ---
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

            // Notify ALL relevant tabs
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                if (tab.url && (
                    tab.url.includes('stake.com') || 
                    tab.url.includes('stake.us') ||
                    tab.url.includes('polymarket.com') ||
                    tab.url.includes('sx.bet')
                )) {
                    try {
                        chrome.tabs.sendMessage(tab.id, { action: "toggleHighlight", enabled: isEnabled });
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

                // 1. Strict Match (after cleaning)
                let match = list.find(x => clean(x.team.toUpperCase()) === n1);
                if (match) return match;

                // If strictMatch was false, but we found a clean strict match, return it.
                if (strictMatch) return null;

                // 2. Fuzzy Match
                let best = null;
                let bestScore = 0;

                list.forEach(item => {
                    const n2 = clean(item.team.toUpperCase());
                    let score = 0;

                    // A. Exact Substring
                    if (n1.includes(n2) || n2.includes(n1)) score += 60;

                    // B. Prefix Match
                    if (n1.split(' ')[0] === n2.split(' ')[0] && n1.split(' ')[0].length >= 3) score += 30;

                    // C. Token Overlap
                    const uniqueTokens = (str) => [...new Set(str.split(' ').filter(t => t.length > 2))];
                    const t1 = uniqueTokens(n1);
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

                    if (score > bestScore) {
                        bestScore = score;
                        best = item;
                    }
                });

                if (bestScore >= 40) return best;
                return null;
            }
        };

        // Iterate Poly items in pairs.
        for (let i = 0; i < polyOdds.length - 1; i += 2) {
            const home = polyOdds[i];
            const away = polyOdds[i + 1];

            // Find corresponding team in Stake.
            const stakeHome = findOdds(stackOdds, home.team);
            const stakeAway = findOdds(stackOdds, away.team);

            if (stakeHome && stakeAway) {
                // Determine confidence
                let confidence = 100;
                if (!strictMatch) {
                    if (home.team !== stakeHome.team) confidence -= 10;
                }

                // Handle Suspended Checks...
                const isSuspended = (val) => val === 'Suspended';

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
                        }
                    }

                    if (arb2.isArb) {
                        const split = ArbitrageCalculator.calculateStakes(stakeAmount, away.odds, stakeHome.odds);
                        if (split) {
                            s2_home_val = split.stake1;
                            s2_away_val = split.stake2;
                            s2_home_disp = `<span class="stake-display">$${split.stake1}</span>`;
                            s2_away_disp = `<span class="stake-display">$${split.stake2}</span>`;
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
                                <button class="bet-btn team1-poly" data-link="${home.link}" data-id="${home.id}">P: ${trunc(home.team)}</button>
                                <button class="bet-btn team2-poly" data-link="${away.link}" data-id="${away.id}">P: ${trunc(away.team)}</button>
                            </div>
                            ${stakeHome ? `
                            <div>
                                <button class="bet-btn team1-stake" data-link="${stakeHome.link}">S: ${trunc(stakeHome.team)}</button>
                                <button class="bet-btn team2-stake" data-link="${stakeAway ? stakeAway.link : ''}">S: ${trunc(stakeAway ? stakeAway.team : '')}</button>
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

});
