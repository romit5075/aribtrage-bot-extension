document.addEventListener('DOMContentLoaded', () => {
    const scanPolyBtn = document.getElementById('scanPolyBtn');
    const scanStakeBtn = document.getElementById('scanStakeBtn');
    const clearBtn = document.getElementById('clearBtn');
    const statusText = document.getElementById('status');
    const resultsArea = document.getElementById('resultsArea');

    // Bet Button Handler
    resultsArea.addEventListener('click', (e) => {
        if (e.target.classList.contains('bet-btn')) {
            const url = e.target.getAttribute('data-link');
            // Extract team name from button text "P: CHA" -> "CHA"
            const text = e.target.textContent;
            let team = text.split(':')[1];
            if (team) team = team.trim();

            // Extract ID
            const btnId = e.target.getAttribute('data-id');

            if (url && url !== '#' && url !== 'undefined') {
                // chrome.tabs.create({ url: url });
                // New Flow: Send to background to open AND click
                chrome.runtime.sendMessage({
                    action: "open_and_click",
                    url: url,
                    team: team,
                    id: btnId
                });
            } else {
                alert("Link not available. Please rescan.");
            }
        }
    });

    // 1. Load initial state
    updateUI();

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
            startBtn.textContent = isActive ? "Live Monitoring Active" : "start Monitor (10s)";
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

            // Notify active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                chrome.tabs.sendMessage(tab.id, { action: "toggleLive", enabled: isLive });
            }
        });
    }

    // 2. Scan Handlers

    // Helper to find tab by keyword
    async function findTabByKeyword(keyword) {
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
                    return null;
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
                const urlDisplayId = expectedType === 'polymarket' ? 'polyUrlDisplay' : 'stakeUrlDisplay';
                const urlDisp = document.getElementById(urlDisplayId);
                if (urlDisp) {
                    urlDisp.textContent = new URL(tab.url).pathname; // Just show path for brevity
                    urlDisp.title = tab.url; // Tooltip full url
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

                // Reset Status Box Color/Opacity
                const pBox = document.getElementById('polyStatusBox');
                const sBox = document.getElementById('stakeStatusBox');
                if (pBox) { pBox.style.opacity = "0.5"; pBox.style.color = "#bdc3c7"; }
                if (sBox) { sBox.style.opacity = "0.5"; sBox.style.color = "#bdc3c7"; }

                // Clear URL display if we add it
                const pUrl = document.getElementById('polyUrlDisplay');
                const sUrl = document.getElementById('stakeUrlDisplay');
                if (pUrl) pUrl.textContent = '';
                if (sUrl) sUrl.textContent = '';

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
        chrome.storage.local.get(['polymarketData', 'stackData'], (result) => {
            const poly = result.polymarketData;
            const stack = result.stackData;

            let html = '';

            if (!poly && !stack) {
                html = '<p>No data collected.</p>';
            } else {
                if (poly) html += `<p style="font-size:10px; color:#aaa;">Poly Data: ${poly.odds.length} teams</p>`;
                if (stack) html += `<p style="font-size:10px; color:#aaa;">Stake Data: ${stack.odds.length} teams</p>`;

                if (poly && stack) {
                    // Get strict setting
                    const isStrict = result.strictMatch === true;
                    html += generateArbitrageTable(poly.odds, stack.odds, isStrict);
                }
            }
            if (resultsArea) resultsArea.innerHTML = html;
        });
    }

    function generateArbitrageTable(polyOdds, stackOdds, strictMatch) {
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
                const n1 = name.toUpperCase();

                // 1. Try Simple Includes
                let match = list.find(x => {
                    const n2 = x.team.toUpperCase();
                    return n1.includes(n2) || n2.includes(n1);
                });
                if (match) return match;

                // 2. Normalized Strict Match (Ignore punctuation/spaces)
                // "Gen.G" -> "GENG" vs "GENG" -> "GENG"
                // "PR1 Paper Rex" -> "PR1PAPERREX" vs "Paper Rex" -> "PAPERREX"
                const normalize = (s) => s.replace(/[^A-Z0-9]/g, '');
                const norm1 = normalize(n1);

                if (norm1.length > 3) {
                    let normMatch = list.find(x => {
                        const norm2 = normalize(x.team.toUpperCase());
                        return norm2.length > 3 && (norm1.includes(norm2) || norm2.includes(norm1));
                    });
                    if (normMatch) return normMatch;
                }

                // 3. Try Abbreviation/Token Matching (e.g. WSH vs Washington)
                // Score all candidates
                let best = null;
                let bestScore = 0;

                list.forEach(item => {
                    const n2 = item.team.toUpperCase();
                    let score = 0;

                    // A. Prefix Match (DET vs DETROIT)
                    if (n2.startsWith(n1) || n1.startsWith(n2)) score += 50;

                    // NEW: Handles "EPG1" vs "EPG"
                    // If one string's first token strictly contains the other's first token
                    const t1_first = n1.split(' ')[0];
                    const t2_first = n2.split(' ')[0];
                    if (t1_first.length >= 3 && t2_first.length >= 3) {
                        if (t1_first !== t2_first && (t1_first.includes(t2_first) || t2_first.includes(t1_first))) {
                            score += 45;
                        }
                    }

                    // B. Subsequence Match for short tickers (e.g. WSH -> WaSHington)
                    // Only if one is short (< 4 chars)
                    if (n1.length <= 4 || n2.length <= 4) {
                        const short = n1.length < n2.length ? n1 : n2;
                        const long = n1.length < n2.length ? n2 : n1;

                        let sIdx = 0;
                        let lIdx = 0;
                        while (sIdx < short.length && lIdx < long.length) {
                            if (short[sIdx] === long[lIdx]) {
                                sIdx++;
                            }
                            lIdx++;
                        }
                        // If we matched all chars of short in long
                        if (sIdx === short.length) score += 40;
                    }

                    // C. Token Overlap (e.g. 'Hawks' in 'Atlanta Hawks')
                    // Split by space
                    const tokens1 = n1.split(/[\s-]+/).filter(t => t.length > 2);
                    const tokens2 = n2.split(/[\s-]+/).filter(t => t.length > 2);

                    let tokenScore = 0;
                    // Check T1 tokens against T2
                    tokens1.forEach(t1 => {
                        if (tokens2.includes(t1)) {
                            tokenScore += 40; // Exact token match (High Conf)
                        } else if (n2.includes(t1)) {
                            tokenScore += 10; // Substring match
                        }
                    });

                    // Check T2 tokens against T1 (to catch reverse cases)
                    if (tokenScore === 0) {
                        tokens2.forEach(t2 => {
                            if (tokens1.includes(t2)) {
                                tokenScore += 40;
                            } else if (n1.includes(t2)) {
                                tokenScore += 10;
                            }
                        });
                    }

                    score += Math.min(tokenScore, 45); // Cap at 45 so it alone doesn't beat 50 (Prefix) purely on one token unless strong

                    if (score > bestScore) {
                        bestScore = score;
                        best = item;
                    }
                });

                // Threshold
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
                // ... (Existing Perfect Match Logic) ...
                // Determine confidence if not strict match
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
                    // Truncate function for buttons
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
                    const arb1 = calculateArb(home.odds, stakeAway.odds);
                    const arb2 = calculateArb(away.odds, stakeHome.odds);

                    // Highlight colors
                    const highlightStyle = "background-color: #ffe0b2; color: #e65100; font-weight: bold;"; // Light orange bg, dark orange text

                    const trunc = (str) => str.length > 4 ? str.substring(0, 4) : str;

                    tableHtml += `
                        <tr>
                            <td>
                                <b>${home.team}</b> vs <b>${away.team}</b>
                                ${home.team !== stakeHome.team ? `<br/><span style="font-size:9px;color:#f39c12">Match: ${stakeHome.team}</span>` : ''}
                            </td>
                            
                            <!-- Poly Home (Arb 1 Winner?) -->
                            <td style="${arb1.profit > 0 ? highlightStyle : ''}">${home.odds}</td>
                            
                            <!-- Poly Away (Arb 2 Winner?) -->
                            <td style="${arb2.profit > 0 ? highlightStyle : ''}">${away.odds}</td>
                            
                            <!-- Stake Home (Arb 2 Winner?) -->
                            <td style="${arb2.profit > 0 ? highlightStyle : ''}">${stakeHome.odds}</td>
                            
                            <!-- Stake Away (Arb 1 Winner?) -->
                            <td style="${arb1.profit > 0 ? highlightStyle : ''}">${stakeAway.odds}</td>
                            
                            <td class="${arb1.profit > 0 ? 'arb-profit' : 'arb-loss'}">${arb1.profit}%</td>
                            <td class="${arb2.profit > 0 ? 'arb-profit' : 'arb-loss'}">${arb2.profit}%</td>
                             <td style="text-align: left; min-width: 120px;">
                                <div style="margin-bottom:3px">
                                    <button class="bet-btn poly-btn" style="${arb1.profit > 0 ? 'border:1px solid red' : ''}" data-link="${home.link}" data-id="${home.id}">P: ${trunc(home.team)}</button>
                                    <button class="bet-btn poly-btn" style="${arb2.profit > 0 ? 'border:1px solid red' : ''}" data-link="${away.link}" data-id="${away.id}">P: ${trunc(away.team)}</button>
                                </div>
                                <div>
                                    <button class="bet-btn stake-btn" style="${arb2.profit > 0 ? 'border:1px solid red' : ''}" data-link="${stakeHome.link}">S: ${trunc(stakeHome.team)}</button>
                                    <button class="bet-btn stake-btn" style="${arb1.profit > 0 ? 'border:1px solid red' : ''}" data-link="${stakeAway.link}">S: ${trunc(stakeAway.team)}</button>
                                </div>
                            </td>
                        </tr>`;
                }

            } else {
                // PARTIAL or NO MATCH
                // Use dashed placeholders if Stake missing
                const sH = stakeHome ? stakeHome.team : null;
                const sA = stakeAway ? stakeAway.team : null;

                const displayTeam = (polyName, stakeName) => {
                    if (stakeName && stakeName !== polyName) return `${polyName}<br/><span style="font-size:9px;color:#aaa">(${stakeName})</span>`;
                    return polyName;
                };

                const trunc = (str) => str && str.length > 4 ? str.substring(0, 4) : (str || '');

                // Even if totally missing, show row to prove Poly scanned
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

    function calculateArb(odds1, odds2) {
        // Safe check for suspended/string
        if (typeof odds1 === 'string' || typeof odds2 === 'string') {
            return { isArb: false, profit: 'Err' };
        }
        const ip1 = 1 / odds1;
        const ip2 = 1 / odds2;
        const totalIp = ip1 + ip2;
        const profit = ((1 / totalIp) - 1) * 100;
        return {
            isArb: profit > 0,
            profit: profit.toFixed(2)
        };
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
});
