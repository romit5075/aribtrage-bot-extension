
import httpx
import asyncio

async def test_markets_search():
    base_url = "https://gamma-api.polymarket.com/markets"
    async with httpx.AsyncClient() as client:
        # Try searching by query string or tag_id
        # Let's try known slugs often used
        queries = ["NBA", "NFL"]
        for q in queries:
            print(f"--- Query: {q} ---")
            # Usually Gamma accepts ?tag_id=xxx. 
            # If tags endpoint didn't return (maybe it requires auth or differnt path), 
            # let's try direct filtering on markets.
            
            # Try fetching with tag_slug if that works?
            # Or just 'active=true' and see the structure of tags in response
            params = {"limit": 5, "active": "true", "closed": "false", "limit": 1}
            resp = await client.get(base_url, params=params)
            data = resp.json()
            if data:
                print("Sample Market Tags:", data[0].get("tags"))

if __name__ == "__main__":
    asyncio.run(test_markets_search())
