
import httpx
import asyncio

async def test_tags():
    url = "https://gamma-api.polymarket.com/tags"
    async with httpx.AsyncClient() as client:
        # Fetch tags to find IDs for NBA, NFL, etc.
        try:
            resp = await client.get(url)
            tags = resp.json()
            # print first 50 or filter
            print("Searching for sports tags...")
            interesting = ["Sports", "NBA", "NFL", "Soccer", "Football", "UFC", "Basketball"]
            for tag in tags:
                if tag.get("label") in interesting or tag.get("slug") in [i.lower() for i in interesting]:
                    print(f"Found Tag: {tag}")
        except Exception as e:
            print(f"Error fetching tags: {e}")

if __name__ == "__main__":
    asyncio.run(test_tags())
