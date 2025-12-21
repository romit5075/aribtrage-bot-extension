// Expose to window
window.scrapePageData = scrapePageData;

// --- ROBUST SCRAPER (Ported from Background) ---
function scrapePageData() {
    const data = { type: 'unknown', odds: [] };

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
            }

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

                if (team !== 'UNKNOWN' && odds) {
                    const finalOdds = (odds === 'Suspended') ? 'Suspended' : parseFloat(odds);
                    if (finalOdds === 'Suspended' || !isNaN(finalOdds)) {
                        data.odds.push({ team, odds: finalOdds, source: 'Stack', time: timeKey });
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

// --- Live Monitoring ---
let liveObserver = null;
let liveDebounce = null;

function startLiveMonitoring() {
    stopLiveMonitoring(); // reset
    console.log("Starting Live Monitoring...");

    // Initial Sent
    chrome.runtime.sendMessage({ action: "live_data_upate", data: scrapePageData() });

    liveObserver = new MutationObserver((mutations) => {
        // Debounce updates
        if (liveDebounce) clearTimeout(liveDebounce);
        liveDebounce = setTimeout(() => {
            const data = scrapePageData();
            if (data.odds.length > 0) {
                chrome.runtime.sendMessage({ action: "live_data_update", data: data });
            }
        }, 500); // 500ms debounce
    });

    // Observe body for subtree mods
    liveObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function stopLiveMonitoring() {
    if (liveObserver) {
        liveObserver.disconnect();
        liveObserver = null;
    }
    if (liveDebounce) clearTimeout(liveDebounce);
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
    const simpleMatch = /^\s*(\d+)\s*¢\s*$/;
    const simpleResult = text.match(simpleMatch);

    if (simpleResult) {
        const cents = parseInt(simpleResult[1], 10);
        const decimalOdds = (100 / cents).toFixed(2);

        // Check if we already have a tag immediately following
        let next = textNode.nextSibling;
        if (next && next.nodeType === Node.ELEMENT_NODE && next.classList.contains('odds-converted-tag')) {
            if (next.textContent !== decimalOdds) {
                next.textContent = decimalOdds;
            }
        } else {
            const conversionSpan = createConversionTag(decimalOdds);
            if (textNode.parentNode) {
                textNode.parentNode.insertBefore(conversionSpan, textNode.nextSibling);
            }
        }
        return;
    }

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
