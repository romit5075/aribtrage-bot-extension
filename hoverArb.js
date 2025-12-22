
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
    // Use true for capture phase to ensure we catch everything
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

    let current = e.target;
    let container = null;
    let detectedOdds = null;

    // Helper to check for odds or cents in text
    // Returns the decimal odds if found, or null
    const parseOddsFromText = (str) => {
        if (!str) return null;

        // 1. Check for Cents (Polymarket special: "90¢" or "12¢")
        if (isPoly && str.includes('¢')) {
            const centMatch = str.match(/(\d+)¢/);
            if (centMatch) {
                const cents = parseInt(centMatch[1]);
                if (cents > 0) return (100 / cents).toFixed(2);
            }
        }

        // 2. Check for Decimal Odds (Standard)
        // Matches integers and decimals: "1.50", "2", "3.45"
        // We scan for all matches and take the first "reasonable" one.
        const matches = str.matchAll(/\b\d+(\.\d{1,2})?\b/g);
        for (const match of matches) {
            const val = parseFloat(match[0]);
            // Valid odds range check (1.01 to 999)
            if (!isNaN(val) && val >= 1.01 && val < 500) {
                // If it contains a decimal, it's very likely odds.
                if (match[0].includes('.')) return val;

                // If Integer, be careful. 
                // However, user asked for "all tags". If the text is SHORT, we assume it's odds.
                if (str.length < 10) return val;
            }
        }

        return null;
    };

    // 1. UNIVERSAL CHECK
    // Check current element
    let t = current.textContent.trim();
    let odds = parseOddsFromText(t);

    if (odds) {
        container = current;
        detectedOdds = odds;
    } else {
        // Fallback: Check traversing UP (parents)
        let temp = current;
        for (let i = 0; i < 6; i++) {
            if (!temp) break;

            // Check direct text of this parent (or its "button-like" content)
            const pText = temp.textContent.trim();
            // We allow slightly longer text (e.g. "KALMY 90¢ 1.11")
            if (pText.length < 50) {
                const pOdds = parseOddsFromText(pText);
                if (pOdds) {
                    container = temp;
                    detectedOdds = pOdds;
                    break;
                }
            }
            // Explicit button check (always check buttons regardless of length, within reason)
            if (temp.tagName === 'BUTTON' || temp.getAttribute('role') === 'button') {
                const buttonText = temp.textContent.trim();
                const buttonOdds = parseOddsFromText(buttonText);
                if (buttonOdds) {
                    container = temp;
                    detectedOdds = buttonOdds;
                    break;
                }
            }
            temp = temp.parentElement;
        }
    }

    if (!container || !detectedOdds) return;

    // 2. Identify Context (Find Team Name)
    const teamName = findTeamNameFromOddsContext(container, isPoly);

    if (!teamName) return;

    // 3. Find Opponent Odds
    const contextSiblings = getContextSiblings(container);
    const otherList = isPoly ? stackData : polyData;
    const opponentFunc = findOpponentOdds(teamName, otherList, contextSiblings);

    if (opponentFunc) {
        showTooltip(container, opponentFunc.odds);
    }
}

// Helper: robustly find team name by looking UP and AROUND the odds element
function findTeamNameFromOddsContext(oddsElement, isPoly) {
    // 1. Try legacy inner-extraction first (if it's a known button type)
    let legacy = extractTeamName(oddsElement, isPoly);
    if (legacy && legacy.length > 1 && !/^\d/.test(legacy)) return legacy;

    // 2. Search Upwards for Neighboring Info
    let parent = oddsElement.parentElement;

    // We scan UP to 8 levels to find the "Card" or "Row"
    for (let i = 0; i < 8; i++) {
        if (!parent) return null;

        // A. Check for explicit name elements in this scope (Polymarket / common patterns)
        if (isPoly) {
            const op = parent.querySelector('.opacity-70');
            if (op) {
                const t = cleanName(op.textContent);
                if (t) return t;
            }
        } else {
            // Stake specific testid
            const nameEl = parent.querySelector('[data-testid="outcome-button-name"]');
            if (nameEl) {
                const t = cleanName(nameEl.textContent);
                if (t) return t;
            }
        }

        // B. Check Siblings in this scope (Row/Card scanning)
        // Look for any sibling that has text which is NOT odds
        // This is generic handling for "Grid" layouts where Name is a separate div from Odds div
        if (parent.children) {
            const siblings = Array.from(parent.children);
            for (let sib of siblings) {
                // Don't look at myself (or the branch containing myself)
                if (sib === oddsElement || sib.contains(oddsElement)) continue;

                let t = sib.textContent.trim();
                // skip if empty or looks like odds
                if (!t || /^\d+(\.\d+)?$/.test(t)) continue;
                if (t.includes(':') || t.includes('%')) continue; // skip clocks/percentages

                // Heuristic: Capital letters + length
                if (t.length > 2 && /[A-Z]/.test(t)) {
                    const c = cleanName(t);
                    if (c) return c;
                }
            }
        }

        // C. Previous Sibling of Parent? (Row Label for a set of buttons)
        if (parent.previousElementSibling) {
            let prev = parent.previousElementSibling;
            let t = prev.textContent.trim();
            if (t.length > 2 && /[A-Z]/.test(t) && !/^\d+(\.\d+)?$/.test(t)) {
                const c = cleanName(t);
                if (c) return c;
            }
        }

        parent = parent.parentElement;
    }
    return null;
}

function cleanName(t) {
    if (!t) return null;
    let c = t.replace(/\n/g, ' ').replace(/¢/g, '');
    c = c.replace(/\s+\d+(\.\d+)?\s*$/, '');  // remove trailing odds
    c = c.replace(/\s+\d+\s*$/, '');
    c = c.trim().toUpperCase();
    if (c.length < 2 || /^\d/.test(c)) return null;
    return c;
}

function extractTeamName(element, isPoly) {
    // Original button-centric extraction (fallback)
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
    if (tooltip.style.display === 'block') {
        tooltip.style.top = (e.clientY + 12) + 'px';
        tooltip.style.left = (e.clientX + 12) + 'px';
    }
}

function showTooltip(element, odds) {
    if (hoveredElement === element) return;

    if (hoveredElement) {
        hoveredElement.style.border = hoveredElement.dataset.origBorder || '';
    }

    hoveredElement = element;

    // Highlight
    element.dataset.origBorder = element.style.border || '';
    element.style.border = '2px solid #4CAF50';

    // Text: "Opponent > 2.55"
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

// Helper to get siblings' text for context
function getContextSiblings(element) {
    // Go up to a container row/card
    let parent = element.parentElement;
    const siblings = [];

    // Traverse up max 3 levels to find a group
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

    // Helper: does string match?
    const normalize = (str) => str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    const isMatch = (t1, t2) => {
        if (t1 === t2) return true;

        // 1. Direct "Clean" Match
        const n1 = normalize(t1);
        const n2 = normalize(t2);

        if (n1.includes(n2) || n2.includes(n1)) return true;

        // 2. Token overlap
        const tokens1 = t1.toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length > 2);
        const tokens2 = t2.toUpperCase().split(/[^A-Z0-9]+/).filter(t => t.length > 2);

        const intersection = tokens1.filter(t => tokens2.includes(t));
        const commons = ['TEAM', 'ESPORTS', 'GAMING', 'CLUB', 'PRO', 'CLAN'];
        const meaningful = intersection.filter(t => !commons.includes(t));

        return meaningful.length > 0;
    };

    // 1. Search for a PAIR/Cluster that matches matches MyName AND Context
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

            if (contextSiblings.length > 0) {
                const contextMatch = contextSiblings.some(sib => isMatch(sib, opponentName));
                if (contextMatch) {
                    return { team: opponentName, odds: opponentItem.odds };
                }
            } else {
                return { team: opponentName, odds: opponentItem.odds };
            }
        }
    }

    // Fallback: Simple index search
    let index = list.findIndex(item => isMatch(item.team, myName));
    if (index === -1) return null;

    const isEven = index % 2 === 0;
    const opponentIndex = isEven ? index + 1 : index - 1;
    if (opponentIndex >= 0 && opponentIndex < list.length) {
        return { team: list[opponentIndex].team, odds: list[opponentIndex].odds };
    }

    return null;
}
