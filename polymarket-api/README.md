# Polymarket Sports Odds API

Real-time sports betting odds viewer for Polymarket with WebSocket support.

## Features

- 🏀 **Sports Markets Filter** - Automatically filters for NBA, NFL, Soccer, and other sports markets
- 📊 **Live Odds Display** - Shows decimal odds and probability percentages
- 🔄 **Real-time Updates** - WebSocket connection for live price updates
- 📌 **Market Tracking** - Track specific markets for live updates
- 🎨 **Modern UI** - Dark theme dashboard with responsive design

## Quick Start

### 1. Install Dependencies

```bash
cd polymarket-api
pip install -r requirements.txt
```

### 2. Configure Environment (Optional)

Copy the example environment file and add your keys if you want to enable trading:

```bash
cp .env.example .env
# Edit .env with your Polymarket private key for trading features
```

### 3. Run the Server

```bash
python main.py
```

Or with uvicorn directly:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Open the Dashboard

Visit [http://localhost:8000](http://localhost:8000) in your browser.

## API Endpoints

### Markets

- `GET /api/markets/sports` - Get all sports-related markets
- `GET /api/markets/{market_id}` - Get details for a specific market
- `GET /api/markets/{market_id}/prices` - Get live prices for a market

### Tracking

- `POST /api/track/{market_id}` - Start tracking a market for live updates
- `DELETE /api/track/{market_id}` - Stop tracking a market

### WebSocket

- `WS /ws` - WebSocket endpoint for real-time updates

#### WebSocket Messages

**Subscribe to market:**
```json
{
  "type": "subscribe",
  "market_id": "0x..."
}
```

**Unsubscribe from market:**
```json
{
  "type": "unsubscribe",
  "market_id": "0x..."
}
```

**Price update (received):**
```json
{
  "type": "price_update",
  "data": {
    "market_id": "0x...",
    "question": "Will Liverpool win?",
    "prices": {
      "Yes": {
        "probability": 0.65,
        "decimal_odds": 1.54
      },
      "No": {
        "probability": 0.35,
        "decimal_odds": 2.86
      }
    }
  }
}
```

## Project Structure

```
polymarket-api/
├── main.py                 # FastAPI application
├── config.py               # Configuration settings
├── polymarket_client.py    # Polymarket API client
├── websocket_handler.py    # WebSocket & polling handlers
├── requirements.txt        # Python dependencies
├── .env.example           # Example environment variables
├── static/
│   └── index.html         # Dashboard UI
└── README.md              # This file
```

## Sports Markets Supported

The API automatically filters for markets related to:

- **Football/Soccer**: Premier League, La Liga, Serie A, Bundesliga, Champions League
- **NBA Basketball**: All NBA teams and playoffs
- **NFL Football**: All NFL teams and Super Bowl
- **Other**: NHL, MLB, UFC, and more

## Future Enhancements

- [ ] Trading integration (place bets via API)
- [ ] Arbitrage detection across platforms
- [ ] Historical odds tracking
- [ ] Email/Telegram alerts for odds changes
- [ ] Multiple sportsbook comparison

## Integration with Chrome Extension

This API can be used by the Chrome extension to:

1. Fetch live odds instead of scraping the web page
2. Place trades directly via API (more reliable)
3. Track multiple markets simultaneously
4. Get real-time price updates

Example usage in extension:

```javascript
// Fetch sports markets
const response = await fetch('http://localhost:8000/api/markets/sports');
const data = await response.json();

// Get live prices for a market
const prices = await fetch(`http://localhost:8000/api/markets/${marketId}/prices`);
```

## License

MIT
