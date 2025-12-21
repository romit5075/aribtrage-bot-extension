
// hoverArb.js - Hover Arbitrage Tooltip //

/* 
 * Displays a tooltip showing the opponent's odds when hovering over a team/outcome.
 * Simplified per user request: "Opponent > X.XX" (showing available odds on other site).
 */

let tooltip = null;
let hoveredElement = null;
let isHoverEnabled = false;
let polyData = [];
let stackData = [];

// Initialize
(function init() {
    createTooltip();
    loadState();
    setupListeners();
})();

function createTooltip() {
    tooltip = document.createElement('div');
    tooltip.id = 'arb-hover-tooltip';

    // Style: Ultra-minimal "system-ui" badge style
    Object.assign(tooltip.style, {
        position: 'fixed',
        background: 'rgba(30, 30, 30, 0.9)', // Deep dark grey, slightly transparent
        color: '#ffffff',
        padding: '3px 6px',
        borderRadius: '4px',
        fontSize: '11px', // Small font like the reference
        fontWeight: '500',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        zIndex: '999999',
        pointerEvents: 'none',
        display: 'none',
        boxShadow: '0 2px 5px rgba(0,0,0,0.2)', // Subtle shadow
        border: '1px solid rgba(255,255,255,0.1)', // Very subtle border
        whiteSpace: 'nowrap',
        marginTop: '-25px' // Position slightly above cursor by default logic (or handled in update pos)
    });

    document.body.appendChild(tooltip);
}

function loadState() {
    chrome.storage.local.get(['hoverArbEnabled', 'polymarketData', 'stackData'], (result) => {
        isHoverEnabled = result.hoverArbEnabled !== false;
        polyData = result.polymarketData?.odds || [];
        stackData = result.stackData?.odds || [];
    });
}

function setupListeners() {
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('mousemove', updateTooltipPosition, true);

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            if (changes.hoverArbEnabled) isHoverEnabled = changes.hoverArbEnabled.newValue !== false;
            if (changes.polymarketData) polyData = changes.polymarketData.newValue?.odds || [];
            if (changes.stackData) stackData = changes.stackData.newValue?.odds || [];
        }
    });

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'toggleHoverArb') {
            isHoverEnabled = msg.isEnabled;
        }
    });
}

function handleMouseOver(e) {
    if (!isHoverEnabled || !tooltip) return;

    // Detect site
    const isPoly = window.location.hostname.includes('polymarket');
    const isStack = window.location.hostname.includes('sx.bet') || window.location.hostname.includes('stake') || window.location.hostname.includes('sportx');

    if (!isPoly && !isStack) return;

    // Traverse upwards to find a valid container (up to 10 levels)
    let container = null;
    let current = e.target;

    for (let i = 0; i < 10; i++) {
        if (!current || !current.getAttribute) break; // Stop at document root or text nodes if unhandled

        // Checks
        const testId = current.getAttribute('data-testid');
        const role = current.getAttribute('role');
        const isButton = current.tagName === 'BUTTON';
        const hasOutcomeClass = current.classList && (current.classList.contains('outcome-content') || current.classList.contains('trading-button'));

        if (isButton || role === 'button' || testId === 'outcome-content' || hasOutcomeClass) {
            container = current;
            break;
        }

        current = current.parentNode;
    }

    if (!container) return;

    // 1. Get Team Name
    const teamName = extractTeamName(container, isPoly);
    if (!teamName) return;

    // 2. Get Context (Siblings)
    const contextSiblings = getContextSiblings(container);

    // 3. Find Opponent Odds
    const otherList = isPoly ? stackData : polyData;
    const opponentFunc = findOpponentOdds(teamName, otherList, contextSiblings);

    if (opponentFunc) {
        showTooltip(container, opponentFunc.odds); // Removed name from arg, logic inside uses it
    }
}

function handleMouseOut(e) {
    if (hoveredElement && (e.target === hoveredElement || hoveredElement.contains(e.target))) {
        hideTooltip();
    }
}

function updateTooltipPosition(e) {
    if (tooltip.style.display === 'block') {
        // Offset to bottom-right of cursor to be non-intrusive but visible
        tooltip.style.top = (e.clientY + 12) + 'px';
        tooltip.style.left = (e.clientX + 12) + 'px';
    }
}

function showTooltip(element, odds, opponentName) {
    if (hoveredElement === element) return;

    if (hoveredElement) {
        hoveredElement.style.border = ''; // Reset previous
    }

    hoveredElement = element;

    // Highlight
    element.dataset.origBorder = element.style.border;
    element.style.border = '2px solid #4CAF50';

    // Text: "Opponent > 2.55"
    tooltip.textContent = `Opponent > ${odds}`;

    tooltip.style.display = 'block';
}

function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
    if (hoveredElement) {
        element = hoveredElement;
        element.style.border = element.dataset.origBorder || '';
        hoveredElement = null;
    }
}

// Helper to get siblings' text for context
function getContextSiblings(element) {
    // Go up to a container row/card
    let parent = element.parentElement;
    const siblings = [];

    // Traverse up max 3 levels to find a group
    for (let i = 0; i < 3; i++) {
        if (!parent) break;
        // Check for text nodes or other buttons in this parent
        // This is a heuristic: finding other capitalized text or buttons might indicate opponents
        const candidates = parent.querySelectorAll('span, div, button, [role="button"]');
        candidates.forEach(c => {
            if (c === element || c.contains(element) || element.contains(c)) return;
            // Extract text
            const t = c.textContent.trim();
            // Filter out junk
            if (t.length > 2 && !t.includes(':') && !t.includes('%')) {
                siblings.push(t.toUpperCase());
            }
        });
        if (siblings.length > 0) break; // Found a layer with content
        parent = parent.parentElement;
    }
    return siblings;
}

function extractTeamName(element, isPoly) {
    let rawText = "";

    if (isPoly) {
        const op = element.querySelector('.opacity-70');
        if (op) rawText = op.textContent;
        else rawText = element.textContent;
    } else {
        const nameEl = element.querySelector('[data-testid="outcome-button-name"]');
        if (nameEl) {
            rawText = nameEl.textContent;
        } else {
            const clone = element.cloneNode(true);
            const oddsEls = clone.querySelectorAll('[data-testid="outcome-button-odds"], .outcome-odds');
            oddsEls.forEach(el => el.remove());
            rawText = clone.textContent;
        }
    }

    if (!rawText) return null;

    let clean = rawText.replace(/\n/g, ' ');
    clean = clean.replace(/¢/g, '');
    clean = clean.replace(/\s+\d+(\.\d+)?\s*$/, '');
    clean = clean.replace(/\s+\d+\s*$/, '');
    clean = clean.trim().toUpperCase();

    // Allow numbers if 1 or 2 (often used for markets), otherwise > 1 char
    if (clean.length < 1) return null;

    return clean;
}

function findOpponentOdds(myName, list, contextSiblings = []) {
    if (!list || list.length === 0) return null;

    // Helper: does string match?
    const isMatch = (t1, t2) => {
        if (t1 === t2) return true;
        if (t1.includes(t2) || t2.includes(t1)) return true;
        // Word overlap
        const w1 = t1.split(/\s+/).filter(w => w.length > 2);
        const w2 = t2.split(/\s+/).filter(w => w.length > 2);
        return w1.some(w => w2.includes(w));
    };

    // 1. Search for a PAIR/Cluster that matches matches MyName AND Context
    // We assume list is somewhat ordered [A, B, A, B] or [A, Draw, B]
    // We scan windows of 2-3 items

    for (let i = 0; i < list.length - 1; i++) {
        // Window of check: i and i+1 (pair)
        const itemA = list[i];
        const itemB = list[i + 1];

        const nameA = itemA.team;
        const nameB = itemB.team;

        // Check if this pair involves MyName
        let myIndex = -1;
        if (isMatch(nameA, myName)) myIndex = 0;
        else if (isMatch(nameB, myName)) myIndex = 1;

        if (myIndex !== -1) {
            // Found MyName. Does this pair match context?
            const opponentItem = myIndex === 0 ? itemB : itemA;
            const opponentName = opponentItem.team;

            // Does context siblings contain the opponent?
            // If we have context, enforce it.
            if (contextSiblings.length > 0) {
                const contextMatch = contextSiblings.some(sib => isMatch(sib, opponentName));
                if (contextMatch) {
                    return { team: opponentName, odds: opponentItem.odds };
                }
            } else {
                // No context to verify, return first plausible pair?
                // Or continue searching for better match? 
                // Let's return this as fallback match logic
                return { team: opponentName, odds: opponentItem.odds };
            }
        }
    }

    // Fallback: Simple index search if loop failed
    // (Existing logic)
    let index = list.findIndex(item => isMatch(item.team, myName));
    if (index === -1) return null;

    const isEven = index % 2 === 0;
    const opponentIndex = isEven ? index + 1 : index - 1;
    if (opponentIndex >= 0 && opponentIndex < list.length) {
        return { team: list[opponentIndex].team, odds: list[opponentIndex].odds };
    }

    return null;
}

