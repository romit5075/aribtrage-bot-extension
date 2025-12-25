
import httpx
import asyncio

async def test_slug_query():
    async with httpx.AsyncClient() as client:
        # Try generic sports slug
        print("Testing events?slug=nba...")
        try:
            resp = await client.get("https://gamma-api.polymarket.com/events?slug=nba")
            print(f"Status: {resp.status_code}")
            data = resp.json()
            if isinstance(data, list) and len(data) > 0:
                print("SUCCESS: Found events via slug=nba")
                print(data[0].get("title"))
            else:
                print("No events found with slug=nba")
                
            # Try tag_slug 
            print("\nTesting events?tag_slug=nba...")
            resp = await client.get("https://gamma-api.polymarket.com/events?tag_slug=nba")
            print(f"Status: {resp.status_code}")
            data = resp.json()
            if isinstance(data, list) and len(data) > 0:
                print("SUCCESS: Found events via tag_slug=nba")
                print(data[0].get("title"))
        except Exception as e:
            print(e)

if __name__ == "__main__":
    asyncio.run(test_slug_query())
