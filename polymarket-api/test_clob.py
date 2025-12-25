
import asyncio
import os
from py_clob_client.client import ClobClient
from py_clob_client.constants import POLYGON

# Mock environment if needed
os.environ["POLYMARKET_HOST"] = "https://clob.polymarket.com"

async def main():
    print("Initializing ClobClient...")
    # Initialize for read-only (no private key needed strictly for public data usually, 
    # but let's see if it enforces it. If so we might need a dummy one or handle it).
    # For many public read functions, ClobClient might still work or we use the underlying helpers.
    
    # documentation says: host, key, chain_id, signature_type, funder_reward_address
    client = ClobClient(
        host="https://clob.polymarket.com", 
        key=None, 
        chain_id=137
    )

    print("Fetching markets...")
    # ClobClient usually has .get_markets() or similar, often forwarding to Gamma
    # But let's check what it has.
    try:
        # distinct from internal Gamma usage, let's see if library provides high level access
        # The library is mostly for ORDER handling. 
        # Market finding is usually done via the Gamma API helper or similar.
        # Let's use the explicit get_markets equivalent if it exists, otherwise fall back to what we know.
        
        # Actually, let's just try to get the specific market by checking recent sports markets
        # We can use the existing gamma endpoint via the client if it exposes it, 
        # or we just assume the user wants us to SWITCH the backend of our existing functions to use the library where possible.
        
        # Let's try to get a market price using the client to prove it works
        pass
    except Exception as e:
        print(f"Error: {e}")

    # Since the user specifically wants to "use clob", let's demonstrate getting the orderbook 
    # for a likely token ID if we can find one.
    
    # First, let's verify we can find the "Cavaliers vs Knicks" market using our current logic
    # because if we can't find it, using CLOB won't help if we don't have the token ID.
    
    import httpx
    async with httpx.AsyncClient() as http:
        gamma_url = "https://gamma-api.polymarket.com/markets"
        params = {
            "limit": 50,
            "active": "true",
            "closed": "false",
            "tag_id": "9" # Sports tag roughly? Or just filter strings.
        }
        resp = await http.get(gamma_url, params=params)
        markets = resp.json()
        
        found = False
        for m in markets:
            q = m.get("question", "").lower()
            if "cavaliers" in q and "knicks" in q:
                print("\nFOUND MARKET:")
                print(f"ID: {m.get('id')}")
                print(f"Question: {m.get('question')}")
                print("Tokens:")
                for t in m.get("tokens", []):
                    print(f"  - {t.get('outcome')} (ID: {t.get('token_id')})")
                found = True
                
                # Try fetching orderbook via ClobClient for this token
                if m.get("tokens"):
                    token_id = m["tokens"][0]["token_id"]
                    print(f"\nFetching orderbook for {token_id} via CLOB...")
                    try:
                        # ClobClient is synchronous for some operations or has async support?
                        # The library seems to be synchronous for requests usually, wrapping requests
                        book = client.get_order_book(token_id)
                        print(f"Bids: {len(book.bids)}, Asks: {len(book.asks)}")
                    except Exception as clob_err:
                        print(f"CLOB Error: {clob_err}")
                break
        
        if not found:
            print("\nMarket 'Cavaliers vs Knicks' not found in first 50 results.")

if __name__ == "__main__":
    asyncio.run(main())
