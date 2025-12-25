
import httpx
import asyncio
import json

async def inspect_events():
    async with httpx.AsyncClient() as client:
        print("Fetching recent events...")
        # Fetch active events
        try:
            resp = await client.get("https://gamma-api.polymarket.com/events?limit=20&active=true&closed=false")
            events = resp.json()
            
            print(f"Fetched {len(events)} events")
            
            sports_found = False
            for event in events:
                title = event.get("title", "")
                markets = event.get("markets", [])
                tags = event.get("tags", [])
                
                # Check if this looks like a sport
                print(f"\nEvent: {title}")
                print(f"Tags: {tags}")
                
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(inspect_events())
