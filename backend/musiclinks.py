"""
Links from music streaming apps → songs AK Music Player can play.

Spotify, Apple Music, Amazon Music, Deezer, Tidal, Gaana, Wynk and similar apps stream
protected (DRM) audio, so no app can download it from them. Instead we read the song
details (title, artist, length, artwork) from the link and later play the same song from
YouTube, choosing the closest match.

resolve(url) returns:
  {"service": "Spotify", "kind": "track" | "collection", "title": "<album/playlist name>",
   "tracks": [{"id", "title", "artist", "album", "duration", "thumbnail", "youtube"}]}
or {"service": ..., "kind": "youtube_playlist", "url": "...", "title": ...}  (album found on YouTube Music)
"""
from __future__ import annotations

import html
import json
import re
import urllib.parse
import urllib.request
from typing import Optional

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
MAX_TRACKS = 500


class LinkError(Exception):
    pass


# host pattern → service name (links that yt-dlp can't play directly)
SERVICES = [
    (r"(^|\.)open\.spotify\.com$|(^|\.)spotify\.link$|(^|\.)spotify\.app\.link$|(^|\.)play\.spotify\.com$", "Spotify"),
    (r"(^|\.)music\.apple\.com$|(^|\.)itunes\.apple\.com$|(^|\.)geo\.music\.apple\.com$", "Apple Music"),
    (r"(^|\.)music\.amazon\.[a-z.]+$", "Amazon Music"),
    (r"(^|\.)deezer\.com$|(^|\.)deezer\.page\.link$|(^|\.)link\.deezer\.com$|(^|\.)dzr\.page\.link$", "Deezer"),
    (r"(^|\.)tidal\.com$", "Tidal"),
    (r"(^|\.)gaana\.com$", "Gaana"),
    (r"(^|\.)wynk\.in$", "Wynk Music"),
    (r"(^|\.)hungama\.com$", "Hungama"),
    (r"(^|\.)resso\.com$|(^|\.)resso\.app$", "Resso"),
    (r"(^|\.)boomplay\.com$|(^|\.)boomplaymusic\.com$", "Boomplay"),
    (r"(^|\.)anghami\.com$", "Anghami"),
    (r"(^|\.)shazam\.com$", "Shazam"),
    (r"(^|\.)pandora\.com$", "Pandora"),
    (r"(^|\.)napster\.com$", "Napster"),
    (r"(^|\.)qobuz\.com$", "Qobuz"),
    (r"(^|\.)music\.yandex\.[a-z.]+$", "Yandex Music"),
    (r"(^|\.)song\.link$|(^|\.)album\.link$|(^|\.)odesli\.co$|(^|\.)songwhip\.com$|(^|\.)lnk\.to$", "Song link"),
]
SHORT_HOSTS = ("spotify.link", "spotify.app.link", "deezer.page.link", "link.deezer.com", "dzr.page.link",
               "lnk.to", "geo.music.apple.com")
CANONICAL_RE = re.compile(r"https?://(?:open\.spotify\.com|music\.apple\.com|www\.deezer\.com|deezer\.com|"
                          r"music\.amazon\.[a-z.]+|tidal\.com|listen\.tidal\.com)/[^\s\"'<>\\]+")


def service_of(url: str) -> Optional[str]:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if re.search(r"(^|\.)amazon\.[a-z.]+$", host) and "/music" in urllib.parse.urlsplit(url).path:
        return "Amazon Music"
    for pattern, name in SERVICES:
        if re.search(pattern, host):
            return name
    return None


# ---------------------------------------------------------------- HTTP helpers (replaced in tests)
def _get(url: str, timeout: int = 15, accept: str = "text/html,application/json") -> tuple[str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(6_000_000)
        charset = r.headers.get_content_charset() or "utf-8"
        return r.geturl(), data.decode(charset, "replace")


def _get_json(url: str, timeout: int = 15):
    return json.loads(_get(url, timeout, "application/json")[1])


def _dig(obj, *path, default=None):
    for p in path:
        try:
            obj = obj[p]
        except (KeyError, IndexError, TypeError):
            return default
    return obj


def _track(title, artist="", album="", duration=None, thumbnail=None, sid=None, youtube=None) -> Optional[dict]:
    title = html.unescape(str(title or "")).strip()
    if not title:
        return None
    return {"id": str(sid) if sid else None, "title": title, "artist": html.unescape(str(artist or "")).strip(),
            "album": html.unescape(str(album or "")).strip(), "duration": float(duration) if duration else None,
            "thumbnail": thumbnail or None, "youtube": youtube}


def _iso_duration(s: Optional[str]) -> Optional[float]:
    m = re.match(r"P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", s or "")
    if not m or not any(m.groups()):
        return None
    h, mi, se = (float(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + se


def _meta(page: str) -> dict:
    out = {}
    for m in re.finditer(r"<meta\s+[^>]*?(?:property|name)=[\"']([^\"']+)[\"'][^>]*?content=[\"']([^\"']*)[\"']", page, re.I):
        out.setdefault(m.group(1).lower(), html.unescape(m.group(2)))
    for m in re.finditer(r"<meta\s+[^>]*?content=[\"']([^\"']*)[\"'][^>]*?(?:property|name)=[\"']([^\"']+)[\"']", page, re.I):
        out.setdefault(m.group(2).lower(), html.unescape(m.group(1)))
    t = re.search(r"<title[^>]*>(.*?)</title>", page, re.I | re.S)
    if t:
        out.setdefault("title", html.unescape(t.group(1)).strip())
    return out


def _json_ld(page: str) -> list:
    found = []
    for m in re.finditer(r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", page, re.I | re.S):
        try:
            data = json.loads(m.group(1).strip())
        except ValueError:
            continue
        found.extend(data if isinstance(data, list) else [data])
    return found


# ---------------------------------------------------------------- services
def _spotify(url: str) -> Optional[dict]:
    m = re.search(r"open\.spotify\.com/(?:intl-[a-zA-Z-]+/)?(?:embed/)?(track|album|playlist|artist)/([A-Za-z0-9]+)", url)
    if not m:
        return None
    kind, sid = m.groups()
    _, page = _get(f"https://open.spotify.com/embed/{kind}/{sid}")
    nd = re.search(r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>', page, re.S)
    entity = _dig(json.loads(nd.group(1)), "props", "pageProps", "state", "data", "entity") if nd else None
    if not entity:
        return None

    def cover(e):
        imgs = _dig(e, "visualIdentity", "image") or _dig(e, "coverArt", "sources") or []
        imgs = [i for i in imgs if isinstance(i, dict) and i.get("url")]
        return max(imgs, key=lambda i: i.get("maxWidth") or i.get("width") or 0)["url"] if imgs else None

    if kind == "track":
        artists = ", ".join(a.get("name", "") for a in entity.get("artists") or [] if isinstance(a, dict)) \
            or entity.get("subtitle", "")
        dur = entity.get("duration")
        t = _track(entity.get("name") or entity.get("title"), artists, "", dur / 1000 if dur else None, cover(entity), sid)
        return {"service": "Spotify", "kind": "track", "title": t["title"] if t else "", "tracks": [t] if t else []}
    tracks = []
    for it in (entity.get("trackList") or [])[:MAX_TRACKS]:
        tid = (it.get("uri") or "").rsplit(":", 1)[-1] or None
        dur = it.get("duration")
        t = _track(it.get("title"), it.get("subtitle"), entity.get("name") if kind == "album" else "",
                   dur / 1000 if dur else None, cover(entity) if kind == "album" else None, tid)
        if t:
            tracks.append(t)
    return {"service": "Spotify", "kind": "collection", "title": entity.get("name") or entity.get("title") or "Spotify playlist",
            "tracks": tracks}


def _apple(url: str) -> Optional[dict]:
    parts = urllib.parse.urlsplit(url)
    cc = (re.match(r"/([a-z]{2})/", parts.path) or [None, "us"])[1]
    q = urllib.parse.parse_qs(parts.query)
    art = lambda u: (u or "").replace("100x100bb", "600x600bb") or None   # noqa: E731
    song_id = (q.get("i") or [None])[0] or (re.search(r"/song/[^/]*/?(\d+)", parts.path) or [None, None])[1]
    album_id = (re.search(r"/album/(?:[^/]*/)?(\d+)", parts.path) or [None, None])[1]
    if song_id:
        res = _get_json(f"https://itunes.apple.com/lookup?id={song_id}&country={cc}").get("results") or []
        r = next((x for x in res if x.get("wrapperType") == "track"), None)
        if r:
            t = _track(r.get("trackName"), r.get("artistName"), r.get("collectionName"),
                       (r.get("trackTimeMillis") or 0) / 1000 or None, art(r.get("artworkUrl100")), r.get("trackId"))
            return {"service": "Apple Music", "kind": "track", "title": t["title"], "tracks": [t]}
    if album_id:
        res = _get_json(f"https://itunes.apple.com/lookup?id={album_id}&entity=song&country={cc}&limit=200").get("results") or []
        coll = next((x for x in res if x.get("wrapperType") == "collection"), {})
        tracks = [t for t in (_track(r.get("trackName"), r.get("artistName"), r.get("collectionName"),
                                     (r.get("trackTimeMillis") or 0) / 1000 or None, art(r.get("artworkUrl100")), r.get("trackId"))
                              for r in res if r.get("wrapperType") == "track") if t]
        if tracks:
            return {"service": "Apple Music", "kind": "collection", "title": coll.get("collectionName") or "Apple Music album",
                    "tracks": tracks[:MAX_TRACKS]}
    if "/playlist/" in parts.path:
        _, page = _get(url)
        for d in _json_ld(page):
            if d.get("@type") in ("MusicPlaylist", "MusicAlbum") and d.get("track"):
                tracks = []
                for r in d["track"][:MAX_TRACKS]:
                    by = r.get("byArtist")
                    artist = ", ".join(a.get("name", "") for a in by) if isinstance(by, list) else _dig(by, "name", default="")
                    t = _track(r.get("name"), artist, "", _iso_duration(r.get("duration")), None)
                    if t:
                        tracks.append(t)
                if tracks:
                    return {"service": "Apple Music", "kind": "collection", "title": d.get("name") or "Apple Music playlist",
                            "tracks": tracks}
    return None


def _deezer(url: str) -> Optional[dict]:
    m = re.search(r"deezer\.com/(?:[a-z]{2}/)?(track|album|playlist)/(\d+)", url)
    if not m:
        return None
    kind, did = m.groups()
    d = _get_json(f"https://api.deezer.com/{kind}/{did}")
    if d.get("error"):
        return None
    if kind == "track":
        t = _track(d.get("title"), _dig(d, "artist", "name"), _dig(d, "album", "title"), d.get("duration"),
                   _dig(d, "album", "cover_xl"), did)
        return {"service": "Deezer", "kind": "track", "title": t["title"], "tracks": [t]}
    cover = d.get("cover_xl") if kind == "album" else None
    tracks = [t for t in (_track(r.get("title"), _dig(r, "artist", "name"), _dig(r, "album", "title") or d.get("title", ""),
                                 r.get("duration"), cover or _dig(r, "album", "cover_xl"), r.get("id"))
                          for r in (_dig(d, "tracks", "data") or [])[:MAX_TRACKS]) if t]
    return {"service": "Deezer", "kind": "collection", "title": d.get("title") or "Deezer playlist", "tracks": tracks}


def _odesli(url: str) -> Optional[dict]:
    """song.link / Odesli: finds the same song or album on other services, including YouTube."""
    j = _get_json("https://api.song.link/v1-alpha.1/links?userCountry=IN&url=" + urllib.parse.quote(url, safe=""))
    e = _dig(j, "entitiesByUniqueId", j.get("entityUniqueId") or "")
    if not e:
        return None
    links = j.get("linksByPlatform") or {}
    yt = _dig(links, "youtubeMusic", "url") or _dig(links, "youtube", "url")
    if e.get("type") == "album":
        if yt:
            return {"service": None, "kind": "youtube_playlist", "url": yt, "title": e.get("title")}
        return None
    t = _track(e.get("title"), e.get("artistName"), "", None, e.get("thumbnailUrl"), e.get("id"), yt)
    return {"service": None, "kind": "track", "title": t["title"], "tracks": [t]} if t else None


_TITLE_PATTERNS = [
    r"^(?P<t>.+?)\s+-\s+[Ss]ong(?: and lyrics)? by (?P<a>.+?)\s*(?:\||–|-|$)",
    r"^(?P<t>.+?) - (?:Single|EP) by (?P<a>.+?) on Apple Music",
    r"^(?P<t>.+?) by (?P<a>.+?) on (?:Amazon Music|Apple Music|TIDAL|Tidal|Deezer|Anghami|Boomplay|Pandora|Napster|Qobuz)",
    r"^(?P<t>.+?)(?:\s+Song)?\s*\|\s*(?P<a>[^|]+?)\s*\|.*(?:Gaana|Wynk|Hungama|Resso)",
    r"^(?P<t>.+?) - (?P<a>.+?) \| (?:Shazam|Resso|Boomplay)",
    r"^(?P<a>.+?) - (?P<t>.+?) \| (?:TIDAL|Tidal|Qobuz)",
    r"^(?P<t>.+?)\s+Song(?: Download)?(?: by (?P<a>.+?))?\s*[:|–-]",
]


def _from_page(url: str, service: str) -> Optional[dict]:
    """Last resort: read the song name and artist from the page's title and preview tags."""
    final, page = _get(url)
    meta = _meta(page)
    candidates = [meta.get("og:title"), meta.get("twitter:title"), meta.get("title")]
    title = artist = ""
    for c in filter(None, candidates):
        for pat in _TITLE_PATTERNS:
            m = re.match(pat, c.strip())
            if m:
                title, artist = m.group("t"), (m.groupdict().get("a") or "").split(":")[0]
                break
        if title:
            break
    if not title:
        title = next((c for c in candidates if c), "")
        title = re.split(r"\s+[|–]\s+|\s+-\s+(?:song|Single|EP)\b", title)[0]
        title = re.sub(r"\s+on\s+(?:Amazon Music|Apple Music|Spotify|Deezer|Tidal|Gaana|Wynk Music).*$", "", title)
        desc = meta.get("og:description") or meta.get("description") or ""
        a = re.match(r"^(?:Listen to [^,]+(?:,| by) )?(.+?)\s*·", desc)
        artist = a.group(1) if a else ""
    for d in _json_ld(page):
        if d.get("@type") == "MusicRecording":
            title = d.get("name") or title
            by = d.get("byArtist")
            artist = (", ".join(x.get("name", "") for x in by) if isinstance(by, list) else _dig(by, "name", default="")) or artist
    t = _track(title, artist, "", None, meta.get("og:image"))
    if not t or t["title"].lower() in (service.lower(), "spotify", "amazon music", "apple music", "web player"):
        return None
    return {"service": service, "kind": "track", "title": t["title"], "tracks": [t]}


def _expand(url: str) -> str:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if not any(host == h or host.endswith("." + h) for h in SHORT_HOSTS):
        return url
    try:
        final, page = _get(url)
    except Exception:
        return url
    if service_of(final) and not any((urllib.parse.urlsplit(final).hostname or "").endswith(h) for h in SHORT_HOSTS):
        return final
    m = CANONICAL_RE.search(page)
    return html.unescape(m.group(0)) if m else final


def _clean(url: str) -> str:
    """Remove sharing/tracking codes (?si=…, utm_…) but keep ones that matter (like Apple's ?i=)."""
    p = urllib.parse.urlsplit(url)
    q = [(k, v) for k, v in urllib.parse.parse_qsl(p.query, keep_blank_values=True)
         if not (k in ("si", "nd", "context", "feature", "ref", "referral", "igsh", "_branch_match_id", "dlsi", "pt", "ct", "app")
                 or k.startswith("utm_"))]
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path, urllib.parse.urlencode(q), ""))


def resolve(url: str) -> dict:
    url = _clean(_expand(url.strip()))
    service = service_of(url) or "Music link"
    result, errors = None, []
    handlers = {"Spotify": _spotify, "Apple Music": _apple, "Deezer": _deezer}
    for step in ([handlers[service]] if service in handlers else []) + [_odesli, lambda u: _from_page(u, service)]:
        try:
            result = step(url)
        except Exception as e:      # one source failing just moves on to the next
            errors.append(str(e))
            result = None
        if result and (result.get("tracks") or result.get("kind") == "youtube_playlist"):
            break
    if not result or not (result.get("tracks") or result.get("kind") == "youtube_playlist"):
        raise LinkError(f"Couldn't read that {service} link. Open the song in the app, tap Share → Copy link, "
                        "and paste that. Private playlists can't be read.")
    result["service"] = service
    # one song without an exact YouTube match yet: ask song.link for it (best match available)
    if result["kind"] == "track" and not result["tracks"][0].get("youtube") and service != "Song link":
        try:
            o = _odesli(url)
            if o and o.get("tracks") and o["tracks"][0].get("youtube"):
                result["tracks"][0]["youtube"] = o["tracks"][0]["youtube"]
        except Exception:
            pass
    return result


def search_query(t: dict) -> str:
    title = re.sub(r"\s*[(\[](?:from|feat\.?|ft\.?|with|featuring)\b[^)\]]*[)\]]", "", t.get("title", ""), flags=re.I).strip()
    artist = re.split(r",|&| x | feat\.? ", t.get("artist", ""), flags=re.I)[0].strip()
    return " ".join(x for x in (artist, title or t.get("title", "")) if x) + " audio"
