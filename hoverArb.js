
// hoverArb.js - Hover Arbitrage Tooltip //

/* 
 * Displays a tooltip showing the opponent's odds when hovering over a team/outcome.
 * Updated: Directional search to fix "above works but below doesn't" scoping issues.
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
        background: 'rgba(30, 30, 30, 0.95)', // Slightly more opaque
        color: '#ffffff',
        padding: '3px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: '600',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        zIndex: '999999',
        pointerEvents: 'none',
        display: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        border: '1px solid rgba(255,255,255,0.2)',
        whiteSpace: 'nowrap',
        transition: 'opacity 0.1s ease-in-out'
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

    const isPoly = window.location.hostname.includes('polymarket');
    const isStack = window.location.hostname.includes('sx.bet') || window.location.hostname.includes('stake') || window.location.hostname.includes('sportx');

    if (!isPoly && !isStack) return;

    let current = e.target;
    let container = null;
    let detectedOdds = null;

    // Odds Parser
    const parseOddsFromText = (str) => {
        if (!str) return null;

        // 1. Cents (Polymarket special)
        if (str.includes('¢')) {
            const centMatch = str.match(/(\d+)¢/);
            if (centMatch) {
                const cents = parseInt(centMatch[1]);
                if (cents > 0) return (100 / cents).toFixed(2);
            }
        }

        // 2. Decimal / Int Odds
        const matches = str.matchAll(/\b\d+(\.\d{1,2})?\b/g);
        for (const match of matches) {
            const val = parseFloat(match[0]);
            if (!isNaN(val) && val >= 1.01 && val < 999) {
                if (match[0].includes('.')) return val; // Preferred format 1.50
                if (str.length < 15) return val; // Standalone integer like "2"
            }
        }
        return null;
    };

    // 1. Find Odds element
    let oddsValue = parseOddsFromText(current.textContent.trim());
    if (oddsValue) {
        container = current;
        detectedOdds = oddsValue;
    } else {
        // Walk up to find container with odds
        let temp = current;
        for (let i = 0; i < 5; i++) {
            if (!temp) break;
            const pOdds = parseOddsFromText(temp.textContent.trim());
            if (pOdds) {
                container = temp;
                detectedOdds = pOdds;
                break;
            }
            temp = temp.parentElement;
        }
    }

    if (!container || !detectedOdds) return;

    // 2. Directional Search for Team Name
    const teamName = findTeamNameFromOddsContext(container, isPoly);
    if (!teamName) return;

    // 3. Find Opponent & Show
    const contextSiblings = getContextSiblings(container);
    const otherList = isPoly ? stackData : polyData;
    const opponentFunc = findOpponentOdds(teamName, otherList, contextSiblings);

    if (opponentFunc) {
        showTooltip(container, opponentFunc.odds);
    }
}

function findTeamNameFromOddsContext(oddsElement, isPoly) {
    let current = oddsElement;

    for (let i = 0; i < 6; i++) {
        const parent = current.parentElement;
        if (!parent) break;

        // A. Primary: Internal/Own Text
        let internal = extractTeamName(current, isPoly);
        if (internal && internal.length > 1 && !/^\d/.test(internal)) return internal;

        // B. Secondary: DIRECTIONAL PREVIOUS SIBLINGS (Closest to cursor)
        let prev = current.previousElementSibling;
        while (prev) {
            let t = prev.textContent.trim();
            if (t.length > 2 && /[A-Z]/.test(t) && !/^\d+(\.\d+)?$/.test(t)) {
                let c = cleanName(t);
                if (c) return c;
            }
            prev = prev.previousElementSibling;
        }

        // C. Tertiary: Any sibling in the immediate parent block
        const siblings = Array.from(parent.children);
        for (let sib of siblings) {
            if (sib === current || sib.contains(current)) continue;
            let t = sib.textContent.trim();
            if (t.length > 2 && /[A-Z]/.test(t) && !/^\d+(\.\d{1,2})?$/.test(t)) {
                let c = cleanName(t);
                if (c) return c;
            }
        }

        // D. Context Specific Selectors
        if (isPoly) {
            const op = parent.querySelector('.opacity-70');
            if (op) {
                const t = cleanName(op.textContent);
                if (t) return t;
            }
        }

        current = parent;
    }
    return null;
}

function cleanName(t) {
    if (!t) return null;
    let c = t.replace(/\n/g, ' ').replace(/¢/g, '').trim().toUpperCase();
    c = c.replace(/\s+\d+(\.\d+)?\s*$/, '');
    c = c.replace(/\s+\d+\s*$/, '');
    if (c.length < 2 || /^\d/.test(c)) return null;
    return c;
}

function extractTeamName(element, isPoly) {
    let rawText = "";
    if (isPoly) {
        const op = element.querySelector('.opacity-70');
        if (op) rawText = op.textContent;
        else rawText = element.textContent;
    } else {
        const nameEl = element.querySelector('[data-testid="outcome-button-name"]');
        if (nameEl) rawText = nameEl.textContent;
        else {
            if (element.cloneNode) {
                const clone = element.cloneNode(true);
                const oddsEls = clone.querySelectorAll('[data-testid="outcome-button-odds"], .outcome-odds');
                oddsEls.forEach(el => el.remove());
                rawText = clone.textContent.trim();
            } else {
                rawText = element.textContent;
            }
        }
    }
    return cleanName(rawText);
}

function handleMouseOut(e) {
    if (hoveredElement && (e.target === hoveredElement || hoveredElement.contains(e.target))) {
        hideTooltip();
    }
}

function updateTooltipPosition(e) {
    if (tooltip && tooltip.style.display === 'block') {
        tooltip.style.top = (e.clientY + 15) + 'px'; // Slightly more offset to clear cursor
        tooltip.style.left = (e.clientX + 15) + 'px';
    }
}

function showTooltip(element, odds) {
    if (hoveredElement === element) return;
    if (hoveredElement) hoveredElement.style.border = hoveredElement.dataset.origBorder || '';

    hoveredElement = element;
    element.dataset.origBorder = element.style.border || '';
    element.style.border = '2px solid #4CAF50';

    tooltip.textContent = `Opponent > ${odds}`;
    tooltip.style.display = 'block';
}

function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
    if (hoveredElement) {
        hoveredElement.style.border = hoveredElement.dataset.origBorder || '';
        hoveredElement = null;
    }
}

function getContextSiblings(element) {
    let parent = element.parentElement;
    const siblings = [];
    for (let i = 0; i < 3; i++) {
        if (!parent) break;
        const candidates = parent.querySelectorAll('span, div, button, [role="button"]');
        candidates.forEach(c => {
            if (c === element || c.contains(element) || element.contains(c)) return;
            const t = c.textContent.trim();
            if (t.length > 2 && !t.includes(':') && !t.includes('%')) {
                siblings.push(t.toUpperCase());
            }
        });
        if (siblings.length > 0) break;
        parent = parent.parentElement;
    }
    return siblings;
}

function findOpponentOdds(myName, list, contextSiblings = []) {
    if (!list || list.length === 0) return null;
    const normalize = (str) => str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    const isMatch = (t1, t2) => {
        if (!t1 || !t2) return false;
        if (t1 === t2) return true;
        const n1 = normalize(t1);
        const n2 = normalize(t2);
        if (n1.includes(n2) || n2.includes(n1)) return true;
        const tokens1 = t1.toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length > 2);
        const tokens2 = t2.toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length > 2);
        const intersection = tokens1.filter(t => tokens2.includes(t));
        const commons = ['TEAM', 'ESPORTS', 'GAMING', 'CLUB', 'PRO', 'CLAN'];
        const meaningful = intersection.filter(t => !commons.includes(t));
        return meaningful.length > 0;
    };

    for (let i = 0; i < list.length - 1; i++) {
        const itemA = list[i];
        const itemB = list[i + 1];
        let myIndex = -1;
        if (isMatch(itemA.team, myName)) myIndex = 0;
        else if (isMatch(itemB.team, myName)) myIndex = 1;

        if (myIndex !== -1) {
            const opponentItem = myIndex === 0 ? itemB : itemA;
            if (contextSiblings.length > 0) {
                if (contextSiblings.some(sib => isMatch(sib, opponentItem.team))) return { team: opponentItem.team, odds: opponentItem.odds };
            } else {
                return { team: opponentItem.team, odds: opponentItem.odds };
            }
        }
    }

    let index = list.findIndex(item => isMatch(item.team, myName));
    if (index === -1) return null;
    const isEven = index % 2 === 0;
    const opponentIndex = isEven ? index + 1 : index - 1;
    if (opponentIndex >= 0 && opponentIndex < list.length) {
        return { team: list[opponentIndex].team, odds: list[opponentIndex].odds };
    }
    return null;
}
