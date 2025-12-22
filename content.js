// Expose to window
window.scrapePageData = scrapePageData;

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

        // 2. Try Decimal (e.g. 1.28)
        // Look for typical decimal odds format: digit(s) dot digit(s)
        const matchDecimal = str.match(/(\d+\.\d{2})/);
        if (matchDecimal) {
            return parseFloat(matchDecimal[1]);
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
    const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');
    if (polyButtons.length > 0) {
        data.type = 'polymarket';
        polyButtons.forEach(btn => {
            let team = 'UNKNOWN';
            const teamNode = btn.querySelector('.opacity-70');
            if (teamNode) {
                team = teamNode.textContent.trim().toUpperCase();
            } else {
                const txt = btn.textContent.trim();
                const match = txt.match(/^([A-Z]{3})/);
                if (match) team = match[1];

                // Improved Name Extraction (Same as popup fallback)
                // Fix for "33 33" -> "33"
                if (team === 'UNKNOWN' || team.length <= 4) {
                    const linkEl = btn.closest('a');
                    if (linkEl) {
                        const fullText = linkEl.textContent.trim().toUpperCase();
                        let btnText = btn.textContent.trim().toUpperCase();

                        // If btnText is "33 79¢ 1.27", we only want to remove odds
                        // Clean fullText: "33 33" -> we want "33"
                        // Or if page says "33 33", it's the name twice?

                        let cleanName = fullText.replace(btnText, '').trim();
                        // Remove odds if leaked
                        cleanName = cleanName.replace(/\d+\s*¢/g, '').replace(/(\d+\.\d{2})/g, '').trim();

                        // Special case for repeated numeric names "33 33"
                        const tokens = cleanName.split(' ');
                        if (tokens.length === 2 && tokens[0] === tokens[1]) {
                            cleanName = tokens[0];
                        }

                        if (cleanName.length >= 1) { // Allow short names like "33"
                            team = cleanName;
                        }
                    }
                }
            }

            const clone = btn.cloneNode(true);
            const tags = clone.querySelectorAll('.odds-converted-tag');
            tags.forEach(t => t.remove());
            const teamEl = clone.querySelector('.opacity-70');
            if (teamEl) teamEl.remove();

            const rawText = clone.textContent.trim();
            const odds = parsePolyOdds(rawText);

            // Get Link
            const linkEl = btn.closest('a');
            const link = linkEl ? linkEl.href : window.location.href;

            if (team !== 'UNKNOWN' && odds) {
                data.odds.push({
                    team,
                    odds: odds === 'Suspended' ? 'Suspended' : parseFloat(odds),
                    source: 'Poly',
                    link: link,
                    id: btn.id // Capture ID
                });
            }
        });
    }

    // 2. Stake/SX Scraper
    if (data.odds.length === 0) {
        const stackItems = document.querySelectorAll('.outcome-content');
        if (stackItems.length > 0) {
            data.type = 'stack';
            stackItems.forEach(item => {
                const nameEl = item.querySelector('[data-testid="outcome-button-name"]');
                const oddsContainer = item.querySelector('[data-testid="fixture-odds"]');

                const team = nameEl ? nameEl.textContent.trim().toUpperCase() : 'UNKNOWN';
                let odds = null;

                if (oddsContainer) {
                    odds = parseStakeOdds(oddsContainer.textContent);
                } else {
                    const btn = item.closest('button');
                    if (btn && btn.disabled) odds = 'Suspended';
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

// --- Live Monitoring (Ultra Low Latency) ---
let liveObserver = null;
let liveRafId = null;
let isScanPending = false;

function startLiveMonitoring() {
    stopLiveMonitoring(); // reset
    console.log("Starting Real-Time Monitoring (rAF)...");

    const pushUpdate = () => {
        isScanPending = false;
        const data = scrapePageData();
        if (data.odds.length > 0) {
            try {
                chrome.runtime.sendMessage({ action: "live_data_update", data: data }, (response) => {
                    if (chrome.runtime.lastError) { }
                });
            } catch (err) {
                stopLiveMonitoring();
            }
        }
    };

    // Initial Push
    pushUpdate();

    // 1. Mutation Observer triggers a frame request
    liveObserver = new MutationObserver((mutations) => {
        // Log mutation types to debug what we are seeing
        // const types = mutations.map(m => m.type);
        // console.log("Mutations:", types);

        if (!isScanPending) {
            isScanPending = true;
            liveRafId = requestAnimationFrame(pushUpdate);
        }
    });

    // Observe everything, including characterData for text updates
    // IMPORTANT: subtree: true is required to see deep changes
    liveObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
        characterDataOldValue: false
    });
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
    isScanPending = false;
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
                        placeBtn.style.border = "4px solid #e91e63"; // Highlight "Place Bet"
                        // Send success message
                        chrome.runtime.sendMessage({ action: "bet_placed_success", team: targetTeam, amount: amount, odds: expectedOdds });
                    }, 500);
                } else setTimeout(() => attempt(n + 1), 250);
            };
            attempt(0);
        };

        checkAndClick(0);
    }
});

let isEnabled = true;
let observer = null;

// Initialize
chrome.storage.local.get(['isEnabled'], (result) => {
    isEnabled = result.isEnabled !== false; // Default true
    if (isEnabled) {
        runConverter();
        setTimeout(runConverter, 1000);
        startObserver();
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
