// Telegram Helper Module
// Centralized Telegram messaging functionality

const TelegramBot = {
    
    // Get stored credentials
    async getCredentials() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['tgBotToken', 'tgChatId'], (res) => {
                resolve({
                    token: res.tgBotToken || null,
                    chatId: res.tgChatId || null
                });
            });
        });
    },
    
    // Check if Telegram is configured
    async isConfigured() {
        const { token, chatId } = await this.getCredentials();
        return !!(token && chatId);
    },
    
    // Send a message to Telegram
    async send(message, parseMode = 'Markdown') {
        const { token, chatId } = await this.getCredentials();
        
        if (!token || !chatId) {
            console.warn('[TG] Not configured - token or chatId missing');
            return { success: false, error: 'Telegram not configured' };
        }
        
        try {
            const url = `https://api.telegram.org/bot${token}/sendMessage`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: parseMode
                })
            });
            
            const data = await response.json();
            
            if (data.ok) {
                console.log('[TG] Message sent successfully');
                return { success: true, data };
            } else {
                console.error('[TG] Send failed:', data.description);
                return { success: false, error: data.description };
            }
        } catch (e) {
            console.error('[TG] Error sending message:', e);
            return { success: false, error: e.message };
        }
    },
    
    // Format and send arbitrage opportunity alert
    async sendArbitrageAlert(opportunity) {
        const {
            match,
            polyTeam,
            polyOdds,
            stakeTeam,
            stakeOdds,
            arbPercent,
            stake1,
            stake2,
            profit,
            polyLink,
            stakeLink
        } = opportunity;
        
        const message = 
`[ARB ALERT] *Arbitrage Opportunity Detected!*

*Match:* ${match}

*Poly:* ${polyTeam} @ ${polyOdds}
*Stake:* ${stakeTeam} @ ${stakeOdds}

*ROI:* ${arbPercent}%
*Stakes:* $${stake1} / $${stake2}
*Profit:* $${profit}

*Links:*
[Polymarket](${polyLink})
[Stake](${stakeLink})

_Time: ${new Date().toLocaleTimeString()}_`;
        
        return await this.send(message);
    },
    
    // Send minimum bet warning
    async sendMinBetWarning(data) {
        const { team, enteredAmount, minAmount, odds } = data;
        
        const message = 
`[WARNING] *Stake Minimum Bet Warning*

*Team:* ${team}
*Entered:* ${enteredAmount}
*Minimum Required:* ${minAmount}
*Odds:* ${odds}

_Time: ${new Date().toLocaleTimeString()}_`;
        
        return await this.send(message);
    },
    
    // Send bet placed confirmation
    async sendBetPlaced(data) {
        const { team, amount, odds, platform } = data;
        
        const message = 
`[SUCCESS] *Bet Slip Filled*

*Platform:* ${platform}
*Team:* ${team}
*Amount:* $${amount}
*Odds:* ${odds}

_Time: ${new Date().toLocaleTimeString()}_`;
        
        return await this.send(message);
    },
    
    // Send debug report
    async sendDebug(data) {
        const message = 
`[DEBUG] *Debug Report*

*Poly:* ${data.home?.team} (${data.home?.odds}) vs ${data.away?.team} (${data.away?.odds})
*Stake:* ${data.stakeHome?.team} (${data.stakeHome?.odds}) vs ${data.stakeAway?.team} (${data.stakeAway?.odds})

_Time: ${new Date().toLocaleTimeString()}_`;
        
        return await this.send(message);
    },
    
    // Send custom notification
    async sendCustom(title, body) {
        const message = `[${title}]\n\n${body}\n\n_Time: ${new Date().toLocaleTimeString()}_`;
        return await this.send(message);
    }
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TelegramBot;
}
