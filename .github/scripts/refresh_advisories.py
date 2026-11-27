"""Collect dated public notices. Network access is limited to the enumerated endpoints."""
from datetime import date, datetime, timedelta, timezone
from html import unescape
import json
from pathlib import Path
import re
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET

OUTPUT = Path("response/data/advisories.json")
PUBLIC_DATA = "https://happytoto.github.io/soc/response/data/advisories.json"
KISA_PAGE = "https://www.boho.or.kr/kr/bbs/list.do?bbsId=B0000133&menuNo=205020"
CISA_PAGE = "https://www.cisa.gov/known-exploited-vulnerabilities-catalog"
SOURCES = (
    ("kisa", "KISA 보호나라 보안공지", KISA_PAGE,
     "https://www.boho.or.kr/kr/rss.do?bbsId=B0000133", 512_000),
    ("cisa-kev", "CISA KEV 목록", CISA_PAGE,
     "https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json", 8_000_000),
)
MAX_ITEMS = 10
KST = timezone(timedelta(hours=9))
ISSUES = (ValueError, TypeError, KeyError, ET.ParseError, OSError, URLError)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch(url, limit):
    request = Request(url, headers={
        "User-Agent": "RocketSecurity-Advisories/1.0 (+https://happytoto.github.io/soc/response/)",
        "Accept": "application/json,application/rss+xml,application/xml,text/xml,text/plain,*/*;q=0.5",
        "Cache-Control": "no-cache",
    })
    with build_opener(NoRedirect()).open(request, timeout=15) as response:
        if response.status != 200:
            raise ValueError("unsuccessful response")
        raw = response.read(limit + 1)
    if not raw or len(raw) > limit:
        raise ValueError("unexpected response size")
    return raw


def text(value, limit=250):
    if not isinstance(value, str):
        raise ValueError("missing label")
    value = " ".join(unescape(value).split())
    if not value or len(value) > limit or any(ord(char) < 32 for char in value):
        raise ValueError("invalid label")
    return value


def dated(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("invalid release date")
    return date.fromisoformat(value)


def instant(value, now):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
        raise ValueError("invalid check time")
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt > now:
        raise ValueError("future check time")
    return dt


def sorted_items(items):
    return sorted(items, key=lambda item: (item["publishedAt"], item["id"]), reverse=True)


def kisa_item(key, title, when):
    if not re.fullmatch(r"\d{1,12}", key):
        raise ValueError("invalid notice number")
    return dict(id="KISA-" + key, sourceId="kisa", title=text(title), publishedAt=when,
                url=f"https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&menuNo=205020&nttId={key}",
                category="보안 권고")


def cisa_item(key, vendor, product, when):
    if not isinstance(key, str) or not re.fullmatch(r"CVE-\d{4}-\d{4,12}", key):
        raise ValueError("invalid catalog identifier")
    vendor, product = text(vendor), text(product)
    return dict(id=key, sourceId="cisa-kev", title=product if vendor == product else f"{vendor} · {product}",
                publishedAt=when, url=CISA_PAGE + "?search_api_fulltext=" + key,
                category="취약점", vendor=vendor, product=product)


def parse_source(source, raw, now):
    candidates = []
    if source == "kisa":
        if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
            raise ValueError("unsupported XML document")
        channel = ET.fromstring(raw).find("channel")
        if channel is None:
            raise ValueError("missing RSS channel")
        for node in channel.findall("item"):
            link = urlsplit((node.findtext("link") or "").strip())
            params = parse_qs(link.query)
            keys = params.get("nttId", [])
            if (link.scheme != "https" or link.netloc != "www.boho.or.kr" or
                    link.path != "/kr/bbs/view.do" or params.get("bbsId") != ["B0000133"] or len(keys) != 1):
                raise ValueError("unexpected notice link")
            when = (node.findtext("pubDate") or "").strip()
            if dated(when) <= now.astimezone(KST).date():
                candidates.append(kisa_item(keys[0], node.findtext("title"), when))
    else:
        payload = json.loads(raw)
        rows = payload["vulnerabilities"]
        if not isinstance(rows, list) or type(payload["count"]) is not int or len(rows) != payload["count"]:
            raise ValueError("incomplete catalog")
        for row in rows:
            when = row["dateAdded"]
            if dated(when) <= now.date():
                candidates.append(cisa_item(row["cveID"], row["vendorProject"], row["product"], when))
    if not candidates:
        raise ValueError("no dated entries")
    unique = {item["id"]: item for item in candidates}
    return sorted_items(unique.values())[:MAX_ITEMS]


def baseline(raw, now):
    """Rebuild trusted URLs and accept only the expected sources, fields and timestamps."""
    payload = json.loads(raw)
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
        raise ValueError("unsupported snapshot")
    checked = instant(payload["checkedAt"], now)
    if not isinstance(payload["sources"], list) or not isinstance(payload["items"], list):
        raise ValueError("invalid snapshot")
    result = {}
    for source, _, _, _, _ in SOURCES:
        matches = [row for row in payload["sources"] if isinstance(row, dict) and row.get("id") == source]
        if len(matches) != 1:
            raise ValueError("missing source")
        stamp = matches[0]["lastSuccessAt"]
        rows = [row for row in payload["items"] if isinstance(row, dict) and row.get("sourceId") == source]
        if not stamp:
            if rows:
                raise ValueError("items without a source check")
            result[source] = (None, [])
            continue
        success = instant(stamp, checked)
        today = success.astimezone(KST).date() if source == "kisa" else success.date()
        if not 1 <= len(rows) <= MAX_ITEMS:
            raise ValueError("invalid saved item count")
        cleaned = []
        for row in rows:
            key, when = row["id"], row["publishedAt"]
            if dated(when) > today:
                raise ValueError("future saved item")
            if source == "kisa":
                if not isinstance(key, str) or not key.startswith("KISA-"):
                    raise ValueError("invalid saved item")
                entry = kisa_item(key[5:], row["title"], when)
            else:
                entry = cisa_item(key, row["vendor"], row["product"], when)
            if entry["url"] != row["url"]:
                raise ValueError("unexpected saved URL")
            cleaned.append(entry)
        result[source] = (stamp, sorted_items(cleaned))
    return result


def refresh(now, prior, fetcher=fetch):
    stamp = now.isoformat(timespec="seconds").replace("+00:00", "Z")
    sources, items = [], []
    for source, name, page, endpoint, limit in SOURCES:
        try:
            entries = parse_source(source, fetcher(endpoint, limit), now)
            success, status = stamp, "ok"
        except ISSUES as exc:
            print(f"::warning::{source} refresh failed ({type(exc).__name__}); preserving last successful entries")
            success, entries = prior.get(source, (None, []))
            status = "unavailable"
        items.extend(entries)
        sources.append(dict(id=source, name=name, url=page, status=status, lastSuccessAt=success))
    return dict(schemaVersion=1, checkedAt=stamp, sources=sources, items=sorted_items(items))


def main():
    now = datetime.now(timezone.utc).replace(microsecond=0)
    prior = baseline(OUTPUT.read_bytes(), now)
    previous_available = False
    try:
        published = baseline(fetch(PUBLIC_DATA, 160_000), now)
        for source, (stamp, entries) in published.items():
            if stamp and stamp >= (prior.get(source, (None, []))[0] or ""):
                prior[source] = (stamp, entries)
        previous_available = True
    except ISSUES as exc:
        print(f"::warning::Published snapshot unavailable ({type(exc).__name__}); initial snapshot available")
    snapshot = refresh(now, prior)
    if not previous_available:
        for row in snapshot["sources"]:
            if row["status"] == "unavailable" and (
                not row["lastSuccessAt"] or now - instant(row["lastSuccessAt"], now) > timedelta(days=1)
            ):
                raise SystemExit("No recent fallback for an unavailable source. Keeping the current deployment.")
    temp = OUTPUT.with_suffix(".tmp")
    temp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)
    print(f"Prepared {len(snapshot['items'])} notices at {snapshot['checkedAt']}")


if __name__ == "__main__":
    main()
