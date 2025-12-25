"""
WebSocket handler for real-time Polymarket updates
"""

import asyncio
import json
from typing import Dict, Set, Callable, Optional
import websockets
from config import config


class PolymarketWebSocket:
    def __init__(self):
        self.ws_url = config.WS_URL
        self.connection = None
        self.subscribed_markets: Set[str] = set()
        self.callbacks: Dict[str, Callable] = {}
        self.running = False
        self.reconnect_delay = 5
    
    async def connect(self):
        """Establish WebSocket connection"""
        try:
            self.connection = await websockets.connect(
                self.ws_url,
                ping_interval=30,
                ping_timeout=10
            )
            self.running = True
            print(f"[WS] Connected to Polymarket WebSocket")
            return True
        except Exception as e:
            print(f"[WS] Connection failed: {e}")
            return False
    
    async def disconnect(self):
        """Close WebSocket connection"""
        self.running = False
        if self.connection:
            await self.connection.close()
            self.connection = None
            print("[WS] Disconnected from Polymarket WebSocket")
    
    async def subscribe_to_market(self, token_id: str):
        """Subscribe to price updates for a market token"""
        if not self.connection:
            await self.connect()
        
        if token_id in self.subscribed_markets:
            return
        
        try:
            subscribe_msg = {
                "type": "subscribe",
                "channel": "market",
                "markets": [token_id]
            }
            await self.connection.send(json.dumps(subscribe_msg))
            self.subscribed_markets.add(token_id)
            print(f"[WS] Subscribed to market: {token_id[:20]}...")
        except Exception as e:
            print(f"[WS] Subscribe error: {e}")
    
    async def unsubscribe_from_market(self, token_id: str):
        """Unsubscribe from a market token"""
        if token_id not in self.subscribed_markets:
            return
        
        try:
            unsubscribe_msg = {
                "type": "unsubscribe",
                "channel": "market",
                "markets": [token_id]
            }
            await self.connection.send(json.dumps(unsubscribe_msg))
            self.subscribed_markets.discard(token_id)
            print(f"[WS] Unsubscribed from market: {token_id[:20]}...")
        except Exception as e:
            print(f"[WS] Unsubscribe error: {e}")
    
    def on_price_update(self, callback: Callable):
        """Register callback for price updates"""
        self.callbacks["price_update"] = callback
    
    async def listen(self):
        """Listen for WebSocket messages"""
        while self.running:
            try:
                if not self.connection:
                    success = await self.connect()
                    if not success:
                        await asyncio.sleep(self.reconnect_delay)
                        continue
                
                message = await self.connection.recv()
                data = json.loads(message)
                
                # Handle different message types
                msg_type = data.get("type", "")
                
                if msg_type == "price_change":
                    if "price_update" in self.callbacks:
                        await self.callbacks["price_update"](data)
                
                elif msg_type == "book_update":
                    if "price_update" in self.callbacks:
                        await self.callbacks["price_update"](data)
                
            except websockets.exceptions.ConnectionClosed:
                print("[WS] Connection closed, reconnecting...")
                self.connection = None
                await asyncio.sleep(self.reconnect_delay)
            
            except Exception as e:
                print(f"[WS] Error: {e}")
                await asyncio.sleep(1)


# Alternative: Simple polling-based live updates (more reliable)
class LiveOddsPoller:
    def __init__(self, client):
        self.client = client
        self.tracked_markets: Dict[str, Dict] = {}
        self.callbacks: Dict[str, Callable] = {}
        self.running = False
        self.poll_interval = 5  # seconds
    
    def track_market(self, market_id: str, market_data: Dict):
        """Add a market to track"""
        self.tracked_markets[market_id] = market_data
    
    def untrack_market(self, market_id: str):
        """Remove a market from tracking"""
        self.tracked_markets.pop(market_id, None)
    
    def on_update(self, callback: Callable):
        """Register callback for updates"""
        self.callbacks["update"] = callback
    
    async def start_polling(self):
        """Start polling for price updates"""
        self.running = True
        print(f"[Poller] Started polling every {self.poll_interval}s")
        
        while self.running:
            try:
                for market_id, market_data in list(self.tracked_markets.items()):
                    prices = await self.client.get_prices_for_market(market_data)
                    
                    if prices and "update" in self.callbacks:
                        update_data = {
                            "market_id": market_id,
                            "question": market_data.get("question", ""),
                            "prices": prices,
                            "timestamp": asyncio.get_event_loop().time()
                        }
                        await self.callbacks["update"](update_data)
                
                await asyncio.sleep(self.poll_interval)
                
            except Exception as e:
                print(f"[Poller] Error: {e}")
                await asyncio.sleep(self.poll_interval)
    
    def stop_polling(self):
        """Stop polling"""
        self.running = False
        print("[Poller] Stopped polling")


# Singleton instances
polymarket_ws = PolymarketWebSocket()
