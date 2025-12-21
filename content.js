// Expose to window for popup access (via executeScript)
window.scrapePageData = scrapePageData;

function scrapePageData() {
    const data = {
        type: 'unknown',
        odds: []
    };

    // 1. Try Scraper A (Polymarket / Cents)
    // 1. Try Scraper A (Polymarket / Cents)
    // Supports standard and potential dynamic classes
    const polyButtons = document.querySelectorAll('button.trading-button, button[class*="trading-button"]');

    if (polyButtons.length > 0) {
        data.type = 'polymarket';
        polyButtons.forEach(btn => {
            // Team Name
            // In the provided HTML, the team name is in a span with class "opacity-70"
            // e.g. <span class="opacity-70  ">hou</span>
            let team = 'UNKNOWN';
            const teamNode = btn.querySelector('.opacity-70');
            if (teamNode) {
                team = teamNode.textContent.trim().toUpperCase();
            } else {
                // Fallback: simple text scan if class is missing
                const fullText = btn.textContent.trim();
                const match = fullText.match(/^([A-Z]{3})/);
                if (match) team = match[1];
            }

            // Odds (Cents) or Suspended
            // The HTML structure separates cents and our converted tag.
            // We need to read just the cents part.
            // Clone to avoid manipulating live DOM
            const clone = btn.cloneNode(true);

            // Remove our converted tags from clone to get clean text (if they exist)
            const injectedTags = clone.querySelectorAll('.odds-converted-tag');
            injectedTags.forEach(tag => tag.remove());

            // Remove team strings if attached
            const teamEl = clone.querySelector('.opacity-70');
            if (teamEl) teamEl.remove();

            // Now textContent should be something like "49¢" or " 49¢ " or "Suspended"
            const cleanText = clone.textContent.trim();

            let odds = null;

            if (cleanText.toLowerCase().includes('suspended')) {
                odds = 'Suspended';
            } else {
                // Match pattern "49¢"
                const match = cleanText.match(/(\d+)\s*¢/);
                if (match) {
                    const cents = parseInt(match[1], 10);
                    if (cents > 0) {
                        odds = (100 / cents).toFixed(2);
                    }
                }
            }

            if (team !== 'UNKNOWN' && odds) {
                // Keep 'Suspended' as a valid state to report, but handle it downstream
                if (odds === 'Suspended') {
                    data.odds.push({ team, odds: 'Suspended', source: 'Poly' });
                } else {
                    data.odds.push({ team, odds: parseFloat(odds), source: 'Poly' });
                }
            }
        });
    }

    // 2. Try Scraper B (Stack / Decimal)
    // NOTE: Stack classes might be dynamic.
    // 'outcome-content' is a common class seen in provided HTML. 
    // If that fails, we can try a more generic approach searching for odds-like structures.
    if (data.odds.length === 0) {
        // Primary Selector: based on provided structure 
        // <button data-testid="outcome-content">... <span>Team</span> ... <span>2.00</span> ...</button>
        let stackItems = document.querySelectorAll('.outcome-content, [data-testid="outcome-content"], button[class*="outcome"]');

        // If still 0, try finding any button with decimal numbers? (Risky but fallback)
        if (stackItems.length === 0) {
            // Fallback: look for generic containers with team and odds
            // This is harder without specific classes. Let's stick to known selectors and log if empty.
            console.log("No standard stack items found.");
        }

        if (stackItems.length > 0) {
            data.type = 'stack';
            stackItems.forEach(item => {
                // Name usually in a span or div with name-like class
                // Or just the first significant text node
                let nameEl = item.querySelector('[data-testid="outcome-button-name"]');
                if (!nameEl) {
                    // Try finding a direct child span that is NOT the odds
                    const spans = item.querySelectorAll('span');
                    // Heuristic: Name is usually longer text, Odds is number
                    for (let s of spans) {
                        if (!s.textContent.match(/^[\d\.]+$/)) {
                            nameEl = s;
                            break;
                        }
                    }
                }

                // Odds Container
                let oddsContainer = item.querySelector('[data-testid="fixture-odds"]');
                if (!oddsContainer) {
                    // Try finding last span with number
                    const spans = item.querySelectorAll('span');
                    for (let i = spans.length - 1; i >= 0; i--) {
                        if (spans[i].textContent.match(/^[\d\.]+$/)) {
                            oddsContainer = spans[i];
                            break;
                        }
                    }
                }

                const team = nameEl ? nameEl.textContent.trim().toUpperCase() : 'UNKNOWN';

                let odds = null;
                if (oddsContainer) {
                    // Match decimal (1.88) or integer (2) - or even "12.50"
                    // Also check for "Suspended"
                    const text = oddsContainer.textContent.trim();
                    if (text.toLowerCase().includes('suspended') || item.disabled) {
                        odds = 'Suspended';
                    } else {
                        const oddsText = text.match(/(\d+(\.\d+)?)/);
                        if (oddsText) {
                            odds = parseFloat(oddsText[1]);
                        }
                    }
                }
                // Fallback: Check if the button itself text has the odds
                else {
                    const text = item.textContent.trim();
                    if (text.toLowerCase().includes('suspended')) {
                        odds = 'Suspended';
                    } else {
                        const match = text.match(/(\d+(\.\d+)?)$/); // number at end?
                        if (match) odds = parseFloat(match[1]);
                    }
                }

                if (team && team !== 'UNKNOWN' && odds) {
                    data.odds.push({ team, odds, source: 'Stack' });
                }
            });
        }
    }

    return data;
}

// Handler for the scraping request (Legacy fallback)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrape_odds") {
        const data = scrapePageData();
        sendResponse(data);
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
    if (request.action === "play_sound") {
        playNotificationSound();
    }
    // Forward hover toggle to dedicated handler if needed, or handle here
    if (request.action === "toggleHoverArb") {
        // ... handled in hoverArb.js or similar? 
        // If logic is here, enable/disable.
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
