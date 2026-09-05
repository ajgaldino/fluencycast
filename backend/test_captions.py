import requests
import re
import json
import xml.etree.ElementTree as ET
import html

def fetch_youtube_captions(video_id):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    url = f"https://www.youtube.com/watch?v={video_id}"
    res = requests.get(url, headers=headers, timeout=10)
    
    match = re.search(r'"captionTracks":(\[.*?\])', res.text)
    if not match:
        print("No captionTracks found in HTML")
        return []
    
    tracks = json.loads(match.group(1))
    print(f"Found {len(tracks)} caption tracks")
    
    for i, t in enumerate(tracks):
        base_url = t["baseUrl"]
        if "fmt=" not in base_url:
            base_url += "&fmt=json3"
        print(f"Testing track {i}: lang={t.get('languageCode')}, kind={t.get('kind')}")
        caption_res = requests.get(base_url, headers=headers, timeout=10)
        print(f"Status: {caption_res.status_code}, Length: {len(caption_res.text)}, Snippet: {caption_res.text[:200]}")
        if caption_res.status_code == 200 and len(caption_res.text) > 0:
            try:
                root = ET.fromstring(caption_res.text)
                results = []
                for elem in root.findall("text"):
                    start = float(elem.attrib.get("start", 0))
                    dur = float(elem.attrib.get("dur", 0))
                    text = html.unescape(elem.text or "").strip()
                    if text:
                        results.append({"start": start, "duration": dur, "text": text})
                print(f"SUCCESS! Parsed {len(results)} items from track {i}")
                return results
            except Exception as e:
                print("XML parse error:", e)
    return []

if __name__ == "__main__":
    fetch_youtube_captions("dQw4w9WgXcQ")
