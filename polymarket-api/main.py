"""
Polymarket Sports Betting API Server
Real-time odds viewer with WebSocket support
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Set
import asyncio
import json
from datetime import datetime

from polymarket_client import polymarket_client
from websocket_handler import LiveOddsPoller

app = FastAPI(
    title="Polymarket Sports Odds API",
    description="Real-time sports betting odds from Polymarket",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connected WebSocket clients
connected_clients: Set[WebSocket] = set()

# Live odds poller
odds_poller: Optional[LiveOddsPoller] = None

# Cache for markets
markets_cache: Dict = {
    "sports_markets": [],
    "last_updated": None
}


# Pydantic models
class MarketResponse(BaseModel):
    id: str
    question: str
    description: Optional[str]
    outcomes: List[Dict]
    volume: Optional[float]
    liquidity: Optional[float]
    end_date: Optional[str]
    tags: List[str]


class PriceUpdate(BaseModel):
    market_id: str
    question: str
    prices: Dict
    timestamp: float


# WebSocket broadcast
async def broadcast_update(data: Dict):
    """Broadcast update to all connected WebSocket clients"""
    if not connected_clients:
        return
    
    message = json.dumps(data)
    disconnected = set()
    
    for client in connected_clients:
        try:
            await client.send_text(message)
        except:
            disconnected.add(client)
    
    # Remove disconnected clients
    for client in disconnected:
        connected_clients.discard(client)


# Polling callback
async def on_price_update(data: Dict):
    """Handle price update from poller"""
    await broadcast_update({
        "type": "price_update",
        "data": data
    })


@app.on_event("startup")
async def startup():
    """Initialize on startup"""
    global odds_poller
    odds_poller = LiveOddsPoller(polymarket_client)
    odds_poller.on_update(on_price_update)
    print("[Server] Polymarket Sports Odds API started")


@app.on_event("shutdown")
async def shutdown():
    """Cleanup on shutdown"""
    global odds_poller
    if odds_poller:
        odds_poller.stop_polling()
    await polymarket_client.close()
    print("[Server] Shutdown complete")


@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve the main UI"""
    return FileResponse("static/index.html")


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "connected_clients": len(connected_clients)
    }


@app.get("/api/markets/sports")
async def get_sports_markets(limit: int = 20, cursor: int = 0):
    """Get sports-related markets with pagination"""
    try:
        # Use cursor as offset
        result = await polymarket_client.get_sports_markets(limit=limit, offset=cursor)
        markets = result["markets"]
        next_cursor = result["next_offset"]
        
        # Format response
        formatted_markets = []
        for market in markets:
            tokens = market.get("tokens", [])
            outcomes = []
            
            for token in tokens:
                outcomes.append({
                    "name": token.get("outcome", "Unknown"),
                    "token_id": token.get("token_id"),
                    "price": token.get("price")
                })
            
            formatted_markets.append({
                "id": market.get("id") or market.get("condition_id"),
                "question": market.get("question", ""),
                "description": market.get("description", ""),
                "outcomes": outcomes,
                "volume": market.get("volume"),
                "liquidity": market.get("liquidity"),
                "end_date": market.get("end_date_iso"),
                "tags": market.get("tags", []),
                "image": market.get("image")
            })
        
        return {
            "count": len(formatted_markets),
            "next_cursor": next_cursor,
            "markets": formatted_markets
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/markets/{market_id}")
async def get_market_details(market_id: str):
    """Get detailed market info with live prices"""
    try:
        market = await polymarket_client.get_market_by_id(market_id)
        
        if not market:
            raise HTTPException(status_code=404, detail="Market not found")
        
        # Get live prices
        prices = await polymarket_client.get_prices_for_market(market)
        
        tokens = market.get("tokens", [])
        outcomes = []
        
        for token in tokens:
            outcome_name = token.get("outcome", "Unknown")
            token_id = token.get("token_id")
            price_data = prices.get(outcome_name, {})
            
            outcomes.append({
                "name": outcome_name,
                "token_id": token_id,
                "probability": price_data.get("probability"),
                "decimal_odds": price_data.get("decimal_odds")
            })
        
        return {
            "id": market_id,
            "question": market.get("question", ""),
            "description": market.get("description", ""),
            "outcomes": outcomes,
            "volume": market.get("volume"),
            "liquidity": market.get("liquidity"),
            "end_date": market.get("end_date_iso"),
            "tags": market.get("tags", [])
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/markets/{market_id}/prices")
async def get_market_prices(market_id: str):
    """Get live prices for a market"""
    try:
        market = await polymarket_client.get_market_by_id(market_id)
        
        if not market:
            raise HTTPException(status_code=404, detail="Market not found")
        
        prices = await polymarket_client.get_prices_for_market(market)
        
        return {
            "market_id": market_id,
            "question": market.get("question", ""),
            "prices": prices,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/orderbook/{token_id}")
async def get_orderbook(token_id: str):
    """Get orderbook (bids/asks) for a token"""
    try:
        orderbook = await polymarket_client.get_market_orderbook(token_id)
        return orderbook
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/track/{market_id}")
async def track_market(market_id: str):
    """Start tracking a market for live updates"""
    global odds_poller
    
    try:
        market = await polymarket_client.get_market_by_id(market_id)
        
        if not market:
            raise HTTPException(status_code=404, detail="Market not found")
        
        odds_poller.track_market(market_id, market)
        
        # Start polling if not already running
        if not odds_poller.running:
            asyncio.create_task(odds_poller.start_polling())
        
        return {"status": "tracking", "market_id": market_id}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/track/{market_id}")
async def untrack_market(market_id: str):
    """Stop tracking a market"""
    global odds_poller
    
    odds_poller.untrack_market(market_id)
    
    return {"status": "untracked", "market_id": market_id}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates"""
    await websocket.accept()
    connected_clients.add(websocket)
    print(f"[WS] Client connected. Total: {len(connected_clients)}")
    
    try:
        # Send initial data
        await websocket.send_json({
            "type": "connected",
            "message": "Connected to Polymarket Sports Odds",
            "timestamp": datetime.utcnow().isoformat()
        })
        
        # Keep connection alive and handle messages
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                message = json.loads(data)
                
                # Handle subscribe/unsubscribe requests
                if message.get("type") == "subscribe":
                    market_id = message.get("market_id")
                    if market_id:
                        market = await polymarket_client.get_market_by_id(market_id)
                        if market:
                            odds_poller.track_market(market_id, market)
                            if not odds_poller.running:
                                asyncio.create_task(odds_poller.start_polling())
                            await websocket.send_json({
                                "type": "subscribed",
                                "market_id": market_id
                            })
                
                elif message.get("type") == "unsubscribe":
                    market_id = message.get("market_id")
                    if market_id:
                        odds_poller.untrack_market(market_id)
                        await websocket.send_json({
                            "type": "unsubscribed",
                            "market_id": market_id
                        })
                
                elif message.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            
            except asyncio.TimeoutError:
                # Send ping to keep alive
                await websocket.send_json({"type": "ping"})
    
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Error: {e}")
    finally:
        connected_clients.discard(websocket)
        print(f"[WS] Client disconnected. Total: {len(connected_clients)}")


# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
