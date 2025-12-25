"""
Polymarket API Client for fetching markets and placing trades
"""

import httpx
import asyncio
from typing import Optional, List, Dict, Any
from config import config
import json


from py_clob_client.client import ClobClient
from py_clob_client.constants import POLYGON

class PolymarketClient:
    def __init__(self):
        self.gamma_api = config.GAMMA_API_URL
        self.clob_api = config.POLYMARKET_HOST
        self.http_client = None
        self.clob_client = None
        
    def _get_clob_client(self) -> ClobClient:
        if not self.clob_client:
            try:
                self.clob_client = ClobClient(
                    host=self.clob_api,
                    key=config.POLYMARKET_PRIVATE_KEY if config.POLYMARKET_PRIVATE_KEY else None,
                    chain_id=config.CHAIN_ID
                )
            except Exception as e:
                print(f"Failed to init ClobClient: {e}")
        return self.clob_client
    
    async def _get_client(self) -> httpx.AsyncClient:
        if self.http_client is None:
            self.http_client = httpx.AsyncClient(timeout=30.0)
        return self.http_client
    
    async def close(self):
        if self.http_client:
            await self.http_client.aclose()
            self.http_client = None
    
    async def get_all_markets(self, limit: int = 100, offset: int = 0) -> List[Dict]:
        """Fetch all markets from Gamma API"""
        client = await self._get_client()
        try:
            response = await client.get(
                f"{self.gamma_api}/markets",
                params={
                    "limit": limit,
                    "offset": offset,
                    "active": True,
                    "closed": False
                }
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"Error fetching markets: {e}")
            return []
    
    async def get_sports_markets(self) -> List[Dict]:
        """Fetch only sports-related markets"""
        all_markets = []
        offset = 0
        limit = 100
        
        # Fetch multiple pages
        for _ in range(5):  # Max 500 markets
            markets = await self.get_all_markets(limit=limit, offset=offset)
            if not markets:
                break
            all_markets.extend(markets)
            offset += limit
            if len(markets) < limit:
                break
        
        # Filter for sports markets
        sports_markets = []
        for market in all_markets:
            title = market.get("question", "").lower()
            description = market.get("description", "").lower()
            tags = [t.lower() for t in market.get("tags", [])]
            
            # Check if it's a sports market
            is_sports = False
            
            # Check tags first
            sports_tags = ["sports", "nba", "nfl", "soccer", "football", "hockey", "baseball"]
            if any(tag in sports_tags for tag in tags):
                is_sports = True
            
            # Check keywords in title/description
            if not is_sports:
                combined_text = f"{title} {description}"
                for keyword in config.SPORTS_KEYWORDS:
                    if keyword in combined_text:
                        is_sports = True
                        break
            
            if is_sports:
                sports_markets.append(market)
        
        return sports_markets
    
    async def get_market_by_id(self, market_id: str) -> Optional[Dict]:
        """Fetch a specific market by ID"""
        client = await self._get_client()
        try:
            response = await client.get(f"{self.gamma_api}/markets/{market_id}")
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"Error fetching market {market_id}: {e}")
            return None
    
    async def get_market_orderbook(self, token_id: str) -> Dict:
        """Fetch orderbook for a specific token using ClobClient"""
        try:
            client = self._get_clob_client()
            if client:
                # ClobClient relies on sync requests in the current version or we wrap it
                # The library doesn't seem to be async native for requests, so we might block slightly 
                # or we should run it in an executor if high traffic. 
                # For now direct call:
                book = client.get_order_book(token_id)
                # book usually returns an object with bids/asks
                return {
                    "bids": [{"price": b.price, "size": b.size} for b in book.bids],
                    "asks": [{"price": a.price, "size": a.size} for a in book.asks]
                }
        except Exception as e:
            print(f"Error fetching orderbook via CLOB: {e}")
        
        # Fallback to direct HTTP if CLOB library fails
        client = await self._get_client()
        try:
            response = await client.get(
                f"{self.clob_api}/book",
                params={"token_id": token_id}
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"Error fetching orderbook: {e}")
            return {"bids": [], "asks": []}
    
    async def get_market_price(self, token_id: str) -> Optional[Dict]:
        """Get current price for a token"""
        client = await self._get_client()
        try:
            response = await client.get(
                f"{self.clob_api}/price",
                params={"token_id": token_id, "side": "buy"}
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"Error fetching price: {e}")
            return None
    
    async def get_midpoint_price(self, token_id: str) -> Optional[float]:
        """Get midpoint price for a token"""
        client = await self._get_client()
        try:
            response = await client.get(
                f"{self.clob_api}/midpoint",
                params={"token_id": token_id}
            )
            response.raise_for_status()
            data = response.json()
            return float(data.get("mid", 0))
        except Exception as e:
            print(f"Error fetching midpoint: {e}")
            return None
    
    async def get_prices_for_market(self, market: Dict) -> Dict:
        """Get prices for all outcomes in a market"""
        tokens = market.get("tokens", [])
        prices = {}
        
        for token in tokens:
            token_id = token.get("token_id")
            outcome = token.get("outcome", "Unknown")
            
            if token_id:
                price = await self.get_midpoint_price(token_id)
                if price:
                    # Convert probability to decimal odds
                    if price > 0:
                        decimal_odds = 1 / price
                    else:
                        decimal_odds = None
                    
                    prices[outcome] = {
                        "token_id": token_id,
                        "probability": price,
                        "decimal_odds": round(decimal_odds, 2) if decimal_odds else None
                    }
        
        return prices


# Singleton instance
polymarket_client = PolymarketClient()
