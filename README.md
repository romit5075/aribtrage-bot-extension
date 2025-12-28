# Arbitrage Bot Extension

This is a Chrome Extension designed for arbitrage opportunities, specifically integrating with Polymarket and other betting platforms.

## Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/romit5075/aribtrage-bot-extension.git
   cd aribtrage-bot-extension
   ```

2. **Load the Extension in Chrome**
   - Open Google Chrome.
   - Navigate to `chrome://extensions/` in the address bar.
   - Toggle on **Developer mode** in the top right corner.
   - Click the **Load unpacked** button.
   - Select the root directory of this repository (`cent-arbitrage-converter` or whatever folder you cloned into).

3. **Verify Installation**
   - You should see the "Arbitrage Bot" extension icon in your browser toolbar.
   - Allow any permissions requested (access to specific betting sites).

## Usage

1. **Popup Interface**
   - Click the extension icon to open the popup.
   - Use the **Settings** or **Toggle** buttons to enable/disable specific features (e.g., "Arbitrage Bot", "Auto-Trade", "Telegram Notifications").

2. **Features**
   - **Arbitrage Detection**: Automatically scans for price discrepancies between supported bookmakers/markets.
   - **Polymarket Integration**: Fetches markets and prices from Polymarket.
   - **Competitor Analysis**: Compares odds with other platforms.
   - **Telegram Alerts**: Can simulate or send alerts (if configured).

## Development

- **`manifest.json`**: Configuration file for the Chrome Extension.
- **`popup.html` / `popup.js`**: The UI and logic for the extension popup.
- **`background.js`**: Background service worker handling persistent logic.
- **`content.js`**: Script injected into web pages to interact with DOM elements (placing bets, scraping odds).

## Troubleshooting

- **Extension not working?**
  - Go to `chrome://extensions/`.
  - Click the **Errors** button on the extension card to see logs.
  - Click the **Reload** icon to refresh the extension after making code changes.
