// hoverArb.js - Hover Arbitrage Calculator //

/* 
 * Simple tooltip: When hovering over any odds element, shows 
 * what the opponent odds need to be for arbitrage opportunity.
 * Formula: If odds A, opponent needs > A/(A-1) for profit
 */

let tooltip = null;
let hoveredElement = null;
let isHoverEnabled = true;
let hideTimeout = null; // Debounce timer

// Initialize
(function init() {
    createTooltip();
    loadState();
    setupListeners();
    console.log("[HoverArb] Initialized - Simple mode (Sticky Fix)");
})();

function createTooltip() {
    // Remove existing tooltip if any
    const existing = document.getElementById('arb-hover-tooltip');
    if (existing) existing.remove();

    tooltip = document.createElement('div');
    tooltip.id = 'arb-hover-tooltip';

    Object.assign(tooltip.style, {
        position: 'fixed',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        color: '#ffffff',
        padding: '8px 12px',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: '600',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        zIndex: '2147483647',
        pointerEvents: 'none',
        display: 'none',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        border: '1px solid rgba(76, 175, 80, 0.5)',
        whiteSpace: 'nowrap',
        lineHeight: '1.4'
    });

    document.body.appendChild(tooltip);
}

function loadState() {
    try {
        chrome.storage.local.get(['hoverArbEnabled'], (result) => {
            if (chrome.runtime.lastError) return;
            isHoverEnabled = result.hoverArbEnabled !== false;
        });
    } catch (e) {
        isHoverEnabled = true;
    }
}

function setupListeners() {
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('mousemove', updateTooltipPosition, true);

    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.hoverArbEnabled) {
                isHoverEnabled = changes.hoverArbEnabled.newValue !== false;
                if (!isHoverEnabled) hideTooltip();
            }
        });

        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.action === 'toggleHoverArb') {
                isHoverEnabled = msg.isEnabled;
                if (!isHoverEnabled) hideTooltip();
            }
        });
    } catch (e) {
        // Ignored
    }
}

// Parse odds from text - handles multiple formats
function parseOdds(text) {
    if (!text || typeof text !== 'string') return null;

    const cleanText = text.trim();
    if (cleanText.length > 100) return null;
    if (/suspend|unavail|lock|closed/i.test(cleanText)) return null;

    // 1. Polymarket Cents format: "59¢"
    const centsMatch = cleanText.match(/(\d+)\s*¢/);
    if (centsMatch) {
        const cents = parseInt(centsMatch[1], 10);
        if (cents > 0 && cents <= 99) {
            return parseFloat((100 / cents).toFixed(2));
        }
    }

    // 2. Any decimal odds in text
    const decimalMatches = cleanText.match(/(\d+\.\d{1,2})/g);
    if (decimalMatches) {
        for (const match of decimalMatches) {
            const val = parseFloat(match);
            if (val >= 1.01 && val <= 100) return val;
        }
    }

    // 3. Integer that could be odds
    const intMatch = cleanText.match(/\b(\d{1,2})\b/);
    if (intMatch && cleanText.length < 10) {
        const val = parseInt(intMatch[1], 10);
        if (val >= 2 && val <= 50) return val;
    }

    return null;
}

function calculateRequiredOdds(odds) {
    if (!odds || odds <= 1) return null;
    const required = odds / (odds - 1);
    return parseFloat(required.toFixed(2));
}

// Try to find specific site elements
function trySpecificSelectors(target) {
    // === STAKE / SX.BET ===
    if (target.matches && target.matches('[data-testid="fixture-odds"]')) {
        const odds = parseOdds(target.textContent);
        if (odds) return { element: target, odds };
    }
    const fixtureOdds = target.closest('[data-testid="fixture-odds"]');
    if (fixtureOdds) {
        const odds = parseOdds(fixtureOdds.textContent);
        if (odds) return { element: fixtureOdds, odds };
    }
    const outcomeContent = target.closest('.outcome-content');
    if (outcomeContent) {
        const oddsEl = outcomeContent.querySelector('[data-testid="fixture-odds"]');
        if (oddsEl) {
            const odds = parseOdds(oddsEl.textContent);
            if (odds) return { element: outcomeContent, odds };
        }
    }
    const outcomeButton = target.closest('button[class*="outcome"]');
    if (outcomeButton) {
        const oddsEl = outcomeButton.querySelector('[data-testid="fixture-odds"]');
        if (oddsEl) {
            const odds = parseOdds(oddsEl.textContent);
            if (odds) return { element: outcomeButton, odds };
        }
        const odds = parseOdds(outcomeButton.textContent);
        if (odds) return { element: outcomeButton, odds };
    }

    // === POLYMARKET ===
    const polyButton = target.closest('button.trading-button') || target.closest('button[class*="trading-button"]');
    if (polyButton) {
        const odds = parseOdds(polyButton.textContent);
        if (odds) return { element: polyButton, odds };
    }
    const anyButton = target.closest('button');
    if (anyButton && anyButton.textContent.includes('¢')) {
        const odds = parseOdds(anyButton.textContent);
        if (odds) return { element: anyButton, odds };
    }

    // Generic button fallback
    if (anyButton) {
        const odds = parseOdds(anyButton.textContent);
        if (odds) return { element: anyButton, odds };
    }

    // === GENERIC ODDS BOXES ===
    const oddsBox = target.closest('div[class*="variant-secondary"]') ||
        target.closest('div[class*="outcome"]') ||
        target.closest('div[class*="odds"]');
    if (oddsBox) {
        const odds = parseOdds(oddsBox.textContent);
        if (odds) return { element: oddsBox, odds };
    }

    return null;
}

// Generic odds finder - promotes to container if possible
function findOddsGeneric(target) {
    let current = target;
    let validResult = null;

    // Walk up up to 6 levels
    for (let i = 0; i < 6; i++) {
        if (!current || current.tagName === 'BODY' || current.tagName === 'HTML') break;

        // CHECK 1: Is this specific node a valid odds container?
        const directText = getDirectTextContent(current);
        if (directText) {
            const odds = parseOdds(directText);
            if (odds) {
                // Found odds! But don't return immediately. 
                // See if this is part of a larger button/row.
                validResult = { element: current, odds };

                // If this is a button, it's the best container. Return.
                if (current.tagName === 'BUTTON' || current.getAttribute('role') === 'button') {
                    return validResult;
                }
            }
        }

        // CHECK 2: Full text (fallback)
        if (!validResult) {
            const fullText = current.textContent || '';
            if (fullText.length < 50) {
                const odds = parseOdds(fullText);
                if (odds) validResult = { element: current, odds };
            }
        }

        // Promotion Logic: If we found a result earlier, but we just hit a BUTTON while walking up,
        // Upgrade the result to this button so the whole button is the "hoveredElement".
        if (validResult && (current.tagName === 'BUTTON' || current.classList.contains('outcome-content'))) {
            return { element: current, odds: validResult.odds };
        }

        current = current.parentElement;
    }

    return validResult;
}

function getDirectTextContent(element) {
    let text = '';
    for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    }
    return text.trim();
}

function handleMouseOver(e) {
    if (!isHoverEnabled || !tooltip) return;

    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }

    const target = e.target;
    if (tooltip && tooltip.contains(target)) return;

    // Stickiness Check 1: Inside current
    if (hoveredElement && (hoveredElement === target || hoveredElement.contains(target))) {
        return;
    }

    // Stickiness Check 2: Current is inside target (we moved out to parent)
    // We treat this as "still on the same thing" to prevent re-triggering
    if (hoveredElement && target.contains(hoveredElement)) {
        return;
    }

    let result = trySpecificSelectors(target);
    if (!result) result = findOddsGeneric(target);

    if (!result) {
        return; // handleMouseOut will deal with hiding
    }

    const { element, odds } = result;

    // If we resolved to the same element we are already ostensibly hovering (via parent/child), skip
    if (element === hoveredElement) return;
    if (hoveredElement && (hoveredElement.contains(element) || element.contains(hoveredElement))) return;

    // Switch
    if (hoveredElement) hideTooltip();

    const requiredOdds = calculateRequiredOdds(odds);
    if (!requiredOdds || requiredOdds > 100) return;

    showTooltip(element, odds, requiredOdds, e);
}

function handleMouseOut(e) {
    if (!hoveredElement) return;

    const relatedTarget = e.relatedTarget;

    // 1. Moving to a descendent (Child) -> Valid stay
    if (relatedTarget && hoveredElement.contains(relatedTarget)) return;

    // 2. Moving to an ancestor (Parent) -> Valid stay
    // This prevents flickering when moving from "Text" to "Button" (if 'Text' was the hoveredElement)
    if (relatedTarget && relatedTarget.contains(hoveredElement)) return;

    // 3. Moving to Tooltip -> Valid stay
    if (relatedTarget && tooltip && tooltip.contains(relatedTarget)) return;

    // Schedule hide
    hideTimeout = setTimeout(() => {
        hideTooltip();
    }, 250); // Increased to 250ms for smoother feel
}

function updateTooltipPosition(e) {
    if (!tooltip || tooltip.style.display !== 'block') return;

    const offsetX = 15;
    const offsetY = 15;
    const padding = 10;

    let x = e.clientX + offsetX;
    let y = e.clientY + offsetY;

    // Get tooltip dimensions
    const tooltipWidth = tooltip.offsetWidth || 180;
    const tooltipHeight = tooltip.offsetHeight || 60;

    // Keep within viewport
    if (x + tooltipWidth + padding > window.innerWidth) {
        x = e.clientX - tooltipWidth - offsetX;
    }
    if (y + tooltipHeight + padding > window.innerHeight) {
        y = e.clientY - tooltipHeight - offsetY;
    }
    if (x < padding) x = padding;
    if (y < padding) y = padding;

    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
}

function showTooltip(element, currentOdds, requiredOdds, event) {
    // Clean up previous highlight
    if (hoveredElement && hoveredElement !== element) {
        hoveredElement.style.outline = hoveredElement.dataset.origOutline || '';
    }

    hoveredElement = element;

    // Save original style and apply highlight
    if (!element.dataset.origOutline) {
        element.dataset.origOutline = element.style.outline || '';
    }
    element.style.outline = '2px solid #4CAF50';

    // Determine profit potential indicator
    // Lower required odds = easier to find arb
    let statusColor, statusText;
    if (requiredOdds <= 1.5) {
        statusColor = '#4CAF50'; // Green - very favorable
        statusText = '🟢 Easy';
    } else if (requiredOdds <= 2.0) {
        statusColor = '#8BC34A'; // Light green - good
        statusText = '🟢 Good';
    } else if (requiredOdds <= 3.0) {
        statusColor = '#FFC107'; // Yellow - moderate
        statusText = '🟡 Moderate';
    } else {
        statusColor = '#FF9800'; // Orange - harder
        statusText = '🟠 Harder';
    }

    // Build tooltip content
    tooltip.innerHTML = `
        <div style="margin-bottom: 4px; color: #aaa; font-size: 11px;">
            Current: <span style="color: #fff; font-weight: bold;">${currentOdds}</span>
        </div>
        <div style="font-size: 14px; margin-bottom: 2px;">
            Opponent needs: <span style="color: ${statusColor}; font-weight: bold;">&gt; ${requiredOdds}</span>
        </div>
        <div style="font-size: 10px; color: ${statusColor};">${statusText}</div>
    `;

    tooltip.style.display = 'block';

    // Position immediately
    if (event) {
        updateTooltipPosition(event);
    }
}

function hideTooltip() {
    if (tooltip) {
        tooltip.style.display = 'none';
    }

    if (hoveredElement) {
        hoveredElement.style.outline = hoveredElement.dataset.origOutline || '';
        hoveredElement = null;
    }
}
