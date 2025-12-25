
import httpx
import asyncio
import json

async def fetch_ids():
    headers = {"User-Agent": "Mozilla/5.0"}
    async with httpx.AsyncClient(headers=headers) as client:
        # 1. Fetch all tags to find sports IDs
        print("Fetching tags...")
        try:
            # Gamma API tags endpoint
            resp = await client.get("https://gamma-api.polymarket.com/tags")
            tags = resp.json()
            
            sports_tags = {}
            keywords = ["Sports", "NBA", "NFL", "NHL", "Soccer", "Football", "UFC", "Basketball", "Cricket", "Tennis"]
            
            print("\n--- FOUND TAGS ---")
            for tag in tags:
                label = tag.get("label", "")
                slug = tag.get("slug", "")
                # strict validation
                if label in keywords or slug.upper() in keywords or any(k.lower() in label.lower() for k in keywords):
                    print(f"ID: {tag.get('id')} | Label: {label} | Slug: {slug}")
        except Exception as e:
            print(f"Error fetching tags: {e}")

        # 2. Try fetching events for a known tag (e.g. if we saw one, or generic 'Sports' if found)
        # We will assume some common IDs if scan fails, but let's see output first.

if __name__ == "__main__":
    asyncio.run(fetch_ids())
