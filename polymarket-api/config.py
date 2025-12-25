import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Polymarket API
    POLYMARKET_HOST = os.getenv("POLYMARKET_HOST", "https://clob.polymarket.com")
    POLYMARKET_PRIVATE_KEY = os.getenv("POLYMARKET_PRIVATE_KEY", "")
    CHAIN_ID = int(os.getenv("CHAIN_ID", "137"))
    
    # WebSocket
    WS_URL = os.getenv("WS_URL", "wss://ws-subscriptions-clob.polymarket.com/ws/market")
    
    # Gamma API (for market data)
    GAMMA_API_URL = "https://gamma-api.polymarket.com"
    
    # Sports keywords for filtering
    SPORTS_KEYWORDS = [
        # Football/Soccer
        "liverpool", "manchester", "arsenal", "chelsea", "tottenham",
        "real madrid", "barcelona", "atletico", "bayern", "dortmund",
        "psg", "juventus", "inter", "milan", "napoli",
        "premier league", "la liga", "serie a", "bundesliga", "champions league",
        
        # NBA
        "lakers", "celtics", "warriors", "bulls", "heat", "nets",
        "knicks", "76ers", "bucks", "suns", "mavericks", "thunder",
        "cavaliers", "nuggets", "clippers", "spurs", "rockets",
        
        # NFL
        "chiefs", "eagles", "49ers", "cowboys", "bills", "ravens",
        "dolphins", "lions", "packers", "bears", "saints", "patriots",
        
        # General sports terms
        "win", "championship", "finals", "playoff", "match", "game",
        "nba", "nfl", "nhl", "mlb", "mls", "epl", "ucl"
    ]

config = Config()
