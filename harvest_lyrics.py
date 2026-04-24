#!/usr/bin/env python3
"""
harvest_lyrics.py — Bouw de Vjeze Fur Wordle woordenlijst vanuit Genius lyrics.

Gebruik:
    pip install requests beautifulsoup4
    python3 harvest_lyrics.py

Het script:
  1. Zoekt Jeugd van Tegenwoordig nummers op Genius
  2. Pakt Vjeze Fur's verzen uit de lyrics
  3. Laat je per regel beslissen of 'ie grappig genoeg is (y/n)
  4. Bij 'y' kies je een woord uit de regel → wordt toegevoegd aan words.js
"""

from __future__ import annotations

import re
import sys
import time
import requests
from pathlib import Path
from bs4 import BeautifulSoup

WORDS_JS = Path(__file__).parent / "words.js"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "nl,en;q=0.9",
}

DELAY = 1.0  # seconds between Genius requests


# ── Existing words ────────────────────────────────────────────────────────────

def load_existing_words() -> set[str]:
    text = WORDS_JS.read_text(encoding="utf-8")
    return {m.group(1).upper() for m in re.finditer(r'word:\s*"([^"]+)"', text)}


# ── Genius: find JvT songs ────────────────────────────────────────────────────

def fetch_artist_song_urls(max_pages: int = 8) -> list[dict]:
    """
    First grab the JvT artist ID from their Genius artist page,
    then page through their discography via the internal API.
    Falls back to search if the artist page approach fails.
    """
    songs = []
    seen: set[str] = set()

    # --- approach 1: artist songs API ---
    artist_id = _get_jvt_artist_id()
    if artist_id:
        for page in range(1, max_pages + 1):
            url = f"https://genius.com/api/artists/{artist_id}/songs"
            try:
                resp = requests.get(
                    url,
                    params={"page": page, "per_page": 20, "sort": "popularity"},
                    headers=HEADERS,
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                print(f"  [artist songs page {page} fout: {e}]")
                break

            page_songs = data.get("response", {}).get("songs", [])
            if not page_songs:
                break

            for s in page_songs:
                song_url = s.get("url", "")
                if song_url and song_url not in seen:
                    seen.add(song_url)
                    songs.append({"url": song_url, "title": s.get("full_title", song_url)})

            time.sleep(DELAY)
            if len(page_songs) < 20:
                break

    # --- approach 2: search fallback ---
    if not songs:
        print("  (artist-page aanpak mislukt, zoek via search…)")
        for page in range(1, max_pages + 1):
            try:
                resp = requests.get(
                    "https://genius.com/api/search",
                    params={"q": "jeugd van tegenwoordig", "page": page},
                    headers=HEADERS,
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()
            except Exception as e:
                print(f"  [search page {page} fout: {e}]")
                break

            # The internal API may wrap hits in sections or return them flat
            response = data.get("response", {})
            hits = response.get("hits", [])
            if not hits:
                sections = response.get("sections", [])
                for section in sections:
                    hits.extend(section.get("hits", []))

            if not hits:
                break

            for hit in hits:
                result = hit.get("result", {})
                song_url = result.get("url", "")
                primary = result.get("primary_artist", {}).get("name", "").lower()
                if "jeugd" in primary and song_url and song_url not in seen:
                    seen.add(song_url)
                    songs.append({"url": song_url, "title": result.get("full_title", song_url)})

            time.sleep(DELAY)
            if len(hits) < 5:
                break

    return songs


def _get_jvt_artist_id() -> int | None:
    """Scrape the JvT Genius artist page to find their numeric artist ID."""
    try:
        resp = requests.get(
            "https://genius.com/artists/Jeugd-van-tegenwoordig",
            headers=HEADERS,
            timeout=15,
        )
        resp.raise_for_status()
    except Exception:
        return None

    # The artist ID appears in meta tags or JSON blobs in the page
    m = re.search(r'"artist":\{"id":(\d+)', resp.text)
    if m:
        return int(m.group(1))
    m = re.search(r'artists/(\d+)/songs', resp.text)
    if m:
        return int(m.group(1))
    return None


# ── Genius: fetch & parse lyrics ─────────────────────────────────────────────

def fetch_vjeze_verses(song_url: str) -> tuple[str, list[str]]:
    """
    Fetch a Genius song page and return (song_title, [vjeze_fur_lines]).
    Only lines from sections whose header contains 'vjeze' are returned.
    """
    try:
        resp = requests.get(song_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        return song_url, []

    soup = BeautifulSoup(resp.text, "html.parser")

    # Song title
    title_el = soup.select_one("h1")
    song_title = title_el.get_text(strip=True) if title_el else song_url

    # Lyrics containers (Genius renders these server-side)
    containers = soup.select('[data-lyrics-container="true"]')
    if not containers:
        return song_title, []

    # Build line list: replace <br> tags with newlines, keep section headers
    all_lines: list[str] = []
    for container in containers:
        for br in container.find_all("br"):
            br.replace_with("\n")
        text = container.get_text(separator="")
        all_lines.extend(text.split("\n"))

    # Extract Vjeze Fur sections
    vjeze_lines: list[str] = []
    in_vjeze = False

    for raw in all_lines:
        line = raw.strip()
        if not line:
            continue

        section_match = re.match(r"^\[(.+?)\]$", line)
        if section_match:
            header = section_match.group(1).lower()
            in_vjeze = "vjeze" in header
            continue

        if in_vjeze:
            vjeze_lines.append(line)

    return song_title, vjeze_lines


# ── words.js writer ───────────────────────────────────────────────────────────

def append_word(word: str, lyric: str) -> bool:
    text = WORDS_JS.read_text(encoding="utf-8")
    entry = f'  {{ word: "{word.upper()}", lyric: "{lyric}" }},\n'
    idx = text.rfind("];")
    if idx == -1:
        print("FOUT: kon ]; niet vinden in words.js")
        return False
    new_text = text[:idx] + entry + text[idx:]
    WORDS_JS.write_text(new_text, encoding="utf-8")
    return True


# ── Interactive review ────────────────────────────────────────────────────────

DIVIDER = "─" * 62

def review_line(line: str, song_title: str, existing: set[str]) -> str:
    """
    Show one lyric line to the user.
    Returns: 'added' | 'skip' | 'skip_song' | 'quit'
    """
    print(f"\n{DIVIDER}")
    print(f"Nummer : {song_title}")
    print(f"Regel  : {line}")
    print(DIVIDER)
    print("Grappig genoeg?  y = ja  |  n = nee  |  s = rest van nummer skippen  |  q = stoppen")

    answer = input("> ").strip().lower()

    if answer == "q":
        return "quit"
    if answer == "s":
        return "skip_song"
    if answer != "y":
        return "skip"

    # Pull out candidate words (3+ Dutch letters, uppercase for matching)
    raw_words = re.findall(r"[a-zA-ZÀ-ÿ']+", line)
    candidates = []
    for w in raw_words:
        clean = re.sub(r"[''`]", "", w).upper()
        if len(clean) >= 3 and clean not in existing and clean not in candidates:
            candidates.append(clean)

    if not candidates:
        print("  (geen nieuwe woorden in deze regel — overgeslagen)")
        return "skip"

    print("\nWelk woord wil je toevoegen?")
    for i, w in enumerate(candidates, 1):
        print(f"  {i}. {w}")
    print("  0. Overslaan")
    print("  Of typ zelf een woord")

    choice = input("> ").strip()

    if choice == "0" or choice == "":
        return "skip"

    if choice.isdigit() and 1 <= int(choice) <= len(candidates):
        chosen = candidates[int(choice) - 1]
    else:
        chosen = re.sub(r"[^A-ZÀ-Ÿa-zà-ÿ]", "", choice).upper()

    if len(chosen) < 2:
        print("  Woord te kort, overgeslagen.")
        return "skip"

    if chosen in existing:
        print(f"  '{chosen}' staat al in de lijst.")
        return "skip"

    # Escape for JS string
    clean_lyric = line.replace("\\", "\\\\").replace('"', '\\"')

    print(f'\nToevoegen → {{ word: "{chosen}", lyric: "{clean_lyric}" }}')
    confirm = input("Bevestigen? [y/n] ").strip().lower()

    if confirm == "y":
        if append_word(chosen, clean_lyric):
            existing.add(chosen)
            print(f"  ✓ '{chosen}' toegevoegd aan words.js!")
            return "added"

    return "skip"


# ── Main ──────────────────────────────────────────────────────────────────────

def check_dependencies() -> bool:
    try:
        import requests  # noqa: F401
        from bs4 import BeautifulSoup  # noqa: F401
        return True
    except ImportError as e:
        print(f"Ontbrekende dependency: {e}")
        print("Installeer ze met:  pip install requests beautifulsoup4")
        return False


def main():
    if not check_dependencies():
        sys.exit(1)

    print("╔══════════════════════════════════════════╗")
    print("║  Vjeze Fur Lyric Harvester               ║")
    print("║  Jeugd van Tegenwoordig → words.js       ║")
    print("╚══════════════════════════════════════════╝\n")

    existing = load_existing_words()
    print(f"Huidige woordenlijst: {len(existing)} woorden\n")

    print("Nummers ophalen van Genius.com…")
    songs = fetch_artist_song_urls(max_pages=10)

    if not songs:
        print("\nGeen nummers gevonden. Controleer je internetverbinding.")
        sys.exit(1)

    print(f"Gevonden: {len(songs)} nummers van Jeugd van Tegenwoordig\n")
    print("Toetsen: y = grappig  |  n = overslaan  |  s = nummer skippen  |  q = stoppen\n")

    total_added = 0

    for idx, song in enumerate(songs, 1):
        print(f"\n[{idx}/{len(songs)}] Bezig met: {song['title']}")

        song_title, lines = fetch_vjeze_verses(song["url"])
        time.sleep(DELAY)

        if not lines:
            print("  → Geen Vjeze Fur verzen gevonden, nummer overgeslagen.")
            continue

        print(f"  → {len(lines)} regel(s) gevonden in Vjeze Fur verzen")

        skip_song = False
        for line in lines:
            if skip_song:
                break
            result = review_line(line, song_title, existing)
            if result == "quit":
                print(f"\nGestopt. {total_added} woord(en) toegevoegd aan words.js.")
                sys.exit(0)
            if result == "skip_song":
                skip_song = True
            if result == "added":
                total_added += 1

    print(f"\n\nKlaar! {total_added} woord(en) toegevoegd aan words.js.")


if __name__ == "__main__":
    main()
