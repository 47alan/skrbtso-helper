#!/usr/bin/env python3
"""Skrbtso fetch helper for the Tampermonkey magnet userscripts.

Run:
  python tools/skrbtso_scrapling_helper.py

Optional:
  set SKRBTSO_HELPER_HOST=127.0.0.1
  set SKRBTSO_HELPER_PORT=8787
  set SKRBTSO_HELPER_TOKEN=your-token

The userscript calls:
  http://127.0.0.1:8787/skrbtso/search?q=ABC-123%20UC&max=10
"""

from __future__ import annotations

import hmac
import html
import json
import os
import re
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse


SEARCH_ORIGIN = "https://skrbtso.top"
HOST = os.environ.get("SKRBTSO_HELPER_HOST", "127.0.0.1")
PORT = int(os.environ.get("SKRBTSO_HELPER_PORT", "8787"))
DEFAULT_MAX_RESULTS = 10
REQUEST_TIMEOUT_SECONDS = int(os.environ.get("SKRBTSO_HELPER_TIMEOUT", "60"))
FORM_RESULT_WAIT_SECONDS = int(os.environ.get("SKRBTSO_HELPER_FORM_RESULT_WAIT", "90"))
DETAIL_POPUP_WAIT_SECONDS = int(os.environ.get("SKRBTSO_HELPER_DETAIL_WAIT", "12"))
USE_STEALTH_FIRST = os.environ.get("SKRBTSO_HELPER_STEALTH_FIRST", "").lower() in {"1", "true", "yes"}
USE_FORM_SEARCH_FIRST = os.environ.get("SKRBTSO_HELPER_FORM_FIRST", "1").lower() in {"1", "true", "yes"}
HEADLESS = os.environ.get("SKRBTSO_HELPER_HEADLESS", "1").lower() not in {"0", "false", "no"}
REAL_CHROME = os.environ.get("SKRBTSO_HELPER_REAL_CHROME", "").lower() in {"1", "true", "yes"}
USER_DATA_DIR = os.environ.get("SKRBTSO_HELPER_USER_DATA_DIR", "").strip()
AUTH_TOKEN = os.environ.get("SKRBTSO_HELPER_TOKEN", "").strip()
DEBUG_ENABLED = os.environ.get("SKRBTSO_HELPER_DEBUG", "").lower() in {"1", "true", "yes"}
MAX_CONCURRENT = max(1, int(os.environ.get("SKRBTSO_HELPER_MAX_CONCURRENT", "2")))
MAX_POPUP_DETAILS = max(1, int(os.environ.get("SKRBTSO_HELPER_MAX_POPUP_DETAILS", "16")))
REQUEST_SEMAPHORE = threading.BoundedSemaphore(MAX_CONCURRENT)
MAGNET_RE = re.compile(r"magnet:\?xt=urn:btih:[a-z0-9]{32,40}[^\s\"'<>]*", re.I)
CODE_RE = re.compile(r"\b([A-Z]{2,12})[-_\s]?(\d{2,6})\b", re.I)
ANCHOR_RE = re.compile(r"<a\b[^>]*?href=[\"']?([^\"'\s>]+)[\"']?[^>]*>(.*?)</a>", re.I | re.S)
TAG_RE = re.compile(r"<[^>]+>")


def build_search_urls(query: str) -> list[str]:
    encoded = quote(query)
    return [
        f"{SEARCH_ORIGIN}/search/{encoded}.html",
        f"{SEARCH_ORIGIN}/search/{encoded}",
        f"{SEARCH_ORIGIN}/search?keyword={encoded}",
        f"{SEARCH_ORIGIN}/search?word={encoded}",
        f"{SEARCH_ORIGIN}/search?q={encoded}",
    ]


def normalize_query(query: str) -> str:
    text = re.sub(r"\s+", " ", query or "").strip()
    if not text:
        return ""

    upper = text.upper()
    match = re.fullmatch(r"([A-Z]{2,12})[-_\s]?(\d{2,6})(?:[-_\s]?(?:UC|UNCENSORED))?", upper)
    if match:
        return f"{match.group(1)}-{match.group(2)} UC"

    if not re.search(r"\bUC\b", text, re.I):
        code = re.fullmatch(r"([A-Z]{2,12})[-_\s]?(\d{2,6})", upper)
        if code:
            return f"{code.group(1)}-{code.group(2)} UC"

    return text


def unique_texts(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        text = re.sub(r"\s+", " ", item or "").strip()
        key = text.upper()
        if text and key not in seen:
            seen.add(key)
            out.append(text)
    return out


def build_query_variants(query: str) -> list[str]:
    raw = re.sub(r"\s+", " ", query or "").strip()
    normalized = normalize_query(raw)
    variants = [raw, normalized]

    code_match = re.fullmatch(
        r"([A-Z]{2,12})[-_\s]?(\d{2,6})(?:[-_\s]?(?:UC|UNCENSORED))?",
        raw.upper(),
    )
    if code_match:
        code = f"{code_match.group(1)}-{code_match.group(2)}"
        variants.extend([
            f"{code}UC",
            code,
        ])

    return unique_texts(variants)


def is_search_host(url: str) -> bool:
    host = urlparse(url).hostname or ""
    return host == "skrbtso.top" or host.endswith(".skrbtso.top")


def is_search_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and is_search_host(url)


def is_cloudflare_check(text: str) -> bool:
    return bool(re.search(
        r"Checking your browser before accessing|DDoS protection by Cloudflare|"
        r"cf-browser-verification|challenge-platform|Just a moment|"
        r"Performing security verification|not a bot|Performance and Security by Cloudflare",
        text or "",
        re.I,
    ))


def clean_text(value: str) -> str:
    text = TAG_RE.sub(" ", value or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def extract_code(text: str) -> str:
    match = CODE_RE.search((text or "").upper())
    return f"{match.group(1)}-{match.group(2)}" if match else ""


def annotate_result(item: dict[str, Any], query: str) -> dict[str, Any]:
    out = dict(item)
    query_code = extract_code(query)
    result_code = extract_code(str(out.get("title", "")))
    out["query"] = query
    out["queryCode"] = query_code
    out["resultCode"] = result_code
    out["titleMatched"] = bool(query_code and result_code and query_code == result_code)
    return out


def annotate_results(items: list[dict[str, str]], query: str, max_results: int) -> list[dict[str, Any]]:
    return [annotate_result(item, query) for item in items[:max_results]]


def normalize_magnet(value: str) -> str:
    text = html.unescape(value or "").replace("&amp;", "&").strip()
    match = MAGNET_RE.search(text)
    return match.group(0) if match else ""


def parse_magnets(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for match in MAGNET_RE.findall(html.unescape(text or "")):
        magnet = normalize_magnet(match)
        key = magnet.lower()
        if magnet and key not in seen:
            seen.add(key)
            out.append(magnet)
    return out


def browser_body_text(page: Any, timeout_ms: int = 5_000) -> str:
    try:
        return page.locator("body").inner_text(timeout=timeout_ms) or ""
    except Exception:
        return ""


def browser_html(page: Any) -> str:
    try:
        return page.content() or ""
    except Exception:
        return getattr(page, "html_content", "") or getattr(page, "text", "") or ""


def looks_like_result_link(raw_href: str, text: str, base_url: str) -> bool:
    if not raw_href or raw_href.startswith("#") or raw_href.lower().startswith("javascript:"):
        return False
    if raw_href.lower().startswith("magnet:?"):
        return True

    href = urljoin(base_url, html.unescape(raw_href))
    if not is_search_host(href) or len(text) < 4:
        return False

    path = (urlparse(href).path or "").lower()
    if re.search(r"\.(css|js|png|jpe?g|gif|svg|ico)$", path, re.I):
        return False
    if re.search(r"(login|register|help|about|privacy|dmca|rss|tag|search)", path, re.I):
        return False
    return bool(re.search(r"detail|hash|torrent|magnet|info|view|bt|show|file|[a-f0-9]{24,}", path, re.I) or len(text) >= 10)


def parse_search_candidates(text: str, base_url: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()

    for index, magnet in enumerate(parse_magnets(text), start=1):
        key = magnet.lower()
        seen.add(key)
        out.append({
            "title": f"磁力结果 {index}",
            "detailUrl": "",
            "magnet": magnet,
            "source": base_url,
        })

    for raw_href, body in ANCHOR_RE.findall(text or ""):
        title = clean_text(body)[:160] or "搜索结果"
        raw_href = html.unescape(raw_href)
        if not looks_like_result_link(raw_href, title, base_url):
            continue

        magnet = normalize_magnet(raw_href)
        detail_url = "" if magnet else urljoin(base_url, raw_href)
        key = (magnet or detail_url).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({
            "title": title,
            "detailUrl": detail_url,
            "magnet": magnet,
            "source": base_url,
        })

    return out


def score_result(item: dict[str, str], query: str) -> int:
    haystack = f"{item.get('title', '')} {item.get('magnet', '')}".upper()
    code = extract_code(query)
    compact_code = code.replace("-", "")
    score = 0
    if code and code in haystack:
        score += 100
    if compact_code and compact_code in re.sub(r"[-_\s]", "", haystack):
        score += 80
    if query and query.upper() in haystack:
        score += 20
    if re.search(r"UC|UNCENSORED|无码|破解|流出", haystack, re.I):
        score += 30
    if re.search(r"字幕|SUB|CHS|中文字幕|中文", haystack, re.I):
        score += 15
    if re.search(r"4K|FHD|1080|2160", haystack, re.I):
        score += 8
    return score


def fetch_page(url: str) -> tuple[str, str, str, int | None]:
    if USE_STEALTH_FIRST:
        return fetch_page_stealth(url)

    try:
        from scrapling.fetchers import Fetcher

        page = Fetcher.get(
            url,
            impersonate="chrome",
            timeout=REQUEST_TIMEOUT_SECONDS,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        text = page.text or ""
        final_url = str(page.url or url)
        status = getattr(page, "status", None)
        if not is_cloudflare_check(text):
            return text, final_url, "fetcher", status
    except Exception:
        pass

    return fetch_page_stealth(url)


def build_stealth_kwargs(timeout_seconds: int, solve_cloudflare: bool = True) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "headless": HEADLESS,
        "solve_cloudflare": True,
        "timeout": timeout_seconds * 1000,
        "network_idle": True,
    }
    kwargs["solve_cloudflare"] = solve_cloudflare
    if REAL_CHROME:
        kwargs["real_chrome"] = True
    if USER_DATA_DIR:
        kwargs["user_data_dir"] = USER_DATA_DIR
    return kwargs


def stealth_fetch(url: str, timeout_seconds: int, page_action: Any | None = None) -> Any:
    from scrapling.fetchers import StealthyFetcher

    kwargs = build_stealth_kwargs(timeout_seconds, True)
    if page_action:
        kwargs["page_action"] = page_action

    try:
        return StealthyFetcher.fetch(url, **kwargs)
    except Exception as error:
        if "No Cloudflare challenge found" not in str(error):
            raise
        kwargs["solve_cloudflare"] = False
        return StealthyFetcher.fetch(url, **kwargs)


def fetch_page_stealth(url: str) -> tuple[str, str, str, int | None]:
    page = stealth_fetch(url, REQUEST_TIMEOUT_SECONDS)
    return page.text or "", str(page.url or url), "stealth", getattr(page, "status", None)


def fetch_search_by_form(query: str) -> tuple[str, str, str, int | None]:
    def submit_search(page: Any) -> None:
        input_selector = 'input[name="keyword"], input[placeholder*="磁力"], input[type="text"], input'
        search_box = page.locator(input_selector).first
        search_box.wait_for(state="visible", timeout=15_000)
        search_box.fill(query)

        clicked = False
        try:
            with page.expect_navigation(wait_until="domcontentloaded", timeout=REQUEST_TIMEOUT_SECONDS * 1000):
                page.locator('button[type="submit"], button').first.click()
            clicked = True
        except Exception:
            clicked = False

        if not clicked:
            try:
                with page.expect_navigation(wait_until="domcontentloaded", timeout=REQUEST_TIMEOUT_SECONDS * 1000):
                    search_box.press("Enter")
            except Exception:
                search_box.press("Enter")

        try:
            page.wait_for_load_state("networkidle", timeout=20_000)
        except Exception:
            pass
        page.wait_for_timeout(1_000)

    page = stealth_fetch(SEARCH_ORIGIN, REQUEST_TIMEOUT_SECONDS, submit_search)
    return page.text or "", str(page.url or SEARCH_ORIGIN), "stealth-form", getattr(page, "status", None)


def wait_for_search_results(page: Any) -> bool:
    waited = 0
    while waited <= FORM_RESULT_WAIT_SECONDS:
        try:
            page.wait_for_load_state("networkidle", timeout=3_000)
        except Exception:
            pass

        text = browser_body_text(page)
        try:
            detail_count = page.locator('a[href^="/detail/"]').count()
        except Exception:
            detail_count = 0

        if detail_count > 0 or "找到约" in text:
            return True

        page.wait_for_timeout(5_000)
        waited += 5

    return False


def wait_for_detail_magnet(page: Any) -> tuple[str, str]:
    waited = 0
    last_text = ""
    while waited <= DETAIL_POPUP_WAIT_SECONDS:
        try:
            page.wait_for_load_state("networkidle", timeout=3_000)
        except Exception:
            pass

        text = browser_body_text(page)
        html_text = browser_html(page)
        magnets = parse_magnets(f"{html_text}\n{text}")
        if magnets:
            return magnets[0], text

        last_text = text
        page.wait_for_timeout(2_000)
        waited += 2

    return "", last_text


def click_detail_popup(page: Any, candidate: dict[str, str], debug: dict[str, Any]) -> dict[str, str] | None:
    detail_url = candidate.get("detailUrl", "")
    if not detail_url:
        return None

    path = urlparse(detail_url).path
    selectors = [f'a[href="{path}"]', f'a[href="{detail_url}"]']
    last_error = ""

    for selector in selectors:
        try:
            link = page.locator(selector).first
            if link.count() <= 0:
                continue

            detail_page = None
            try:
                with page.expect_popup(timeout=15_000) as popup_info:
                    link.click(timeout=10_000)
                detail_page = popup_info.value
            except Exception as error:
                last_error = str(error)
                continue

            try:
                detail_page.wait_for_load_state("domcontentloaded", timeout=30_000)
            except Exception:
                pass

            magnet, detail_text = wait_for_detail_magnet(detail_page)
            final_url = str(getattr(detail_page, "url", "") or detail_url)
            debug["attempted"].append({
                "url": detail_url,
                "finalUrl": final_url,
                "fetcher": "stealth-popup",
                "magnetFound": bool(magnet),
            })

            try:
                detail_page.close()
            except Exception:
                pass

            if not magnet:
                last_error = "popup detail page loaded without magnet"
                continue

            item = dict(candidate)
            item["magnet"] = magnet
            item["source"] = final_url
            if not item.get("title"):
                title = clean_text(detail_text).split("资源详情", 1)[0].strip()
                item["title"] = title[:160] or "搜索结果"
            return item
        except Exception as error:
            last_error = str(error)

    if last_error:
        debug["attempted"].append({
            "url": detail_url,
            "fetcher": "stealth-popup",
            "error": last_error[:300],
        })
    return None


def collect_results_by_form(query: str, max_results: int, debug: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    from scrapling.fetchers import StealthySession

    results: list[dict[str, str]] = []
    seen: set[str] = set()
    final_url = SEARCH_ORIGIN
    last_error = ""
    session_holder: dict[str, Any] = {}

    def solve_cloudflare_after_submit(page: Any) -> None:
        session = session_holder.get("session")
        if not session:
            return

        page_text = f"{browser_html(page)}\n{browser_body_text(page)}"
        if not is_cloudflare_check(page_text):
            return

        try:
            session._cloudflare_solver(page)
            try:
                page.wait_for_load_state("networkidle", timeout=20_000)
            except Exception:
                pass
            page.wait_for_timeout(3_000)
            debug["attempted"].append({
                "url": str(getattr(page, "url", "") or SEARCH_ORIGIN),
                "fetcher": "stealth-form-post-cloudflare",
                "solved": not is_cloudflare_check(f"{browser_html(page)}\n{browser_body_text(page)}"),
            })
        except Exception as error:
            debug["attempted"].append({
                "url": str(getattr(page, "url", "") or SEARCH_ORIGIN),
                "fetcher": "stealth-form-post-cloudflare",
                "error": str(error)[:300],
            })

    def submit_search(page: Any) -> None:
        nonlocal final_url, last_error

        input_selector = 'input[name="keyword"], input[placeholder*="磁力"], input[type="text"], input'
        search_box = page.locator(input_selector).first
        search_box.wait_for(state="visible", timeout=15_000)
        search_box.fill(query)

        clicked = False
        try:
            with page.expect_navigation(wait_until="domcontentloaded", timeout=REQUEST_TIMEOUT_SECONDS * 1000):
                page.locator('button[type="submit"], button').first.click()
            clicked = True
        except Exception:
            clicked = False

        if not clicked:
            try:
                with page.expect_navigation(wait_until="domcontentloaded", timeout=REQUEST_TIMEOUT_SECONDS * 1000):
                    search_box.press("Enter")
            except Exception:
                search_box.press("Enter")

        solve_cloudflare_after_submit(page)

        if not wait_for_search_results(page):
            final_url = str(getattr(page, "url", "") or SEARCH_ORIGIN)
            last_error = "form search did not reach a result page"
            debug["attempted"].append({
                "url": SEARCH_ORIGIN,
                "finalUrl": final_url,
                "fetcher": "stealth-form",
                "error": last_error,
                "textPreview": clean_text(browser_body_text(page))[:300],
            })
            return

        final_url = str(getattr(page, "url", "") or SEARCH_ORIGIN)
        search_html = browser_html(page)
        candidates = parse_search_candidates(search_html, final_url)
        max_candidates = min(len(candidates), MAX_POPUP_DETAILS, max(max_results, 6))
        if not max_candidates:
            last_error = "form search reached a page without detail links"
            debug["attempted"].append({
                "url": SEARCH_ORIGIN,
                "finalUrl": final_url,
                "fetcher": "stealth-form",
                "error": last_error,
                "textPreview": clean_text(browser_body_text(page))[:300],
            })
            return

        debug["attempted"].append({
            "url": SEARCH_ORIGIN,
            "finalUrl": final_url,
            "fetcher": "stealth-form",
            "status": 200,
            "candidates": max_candidates,
        })

        for candidate in candidates[:max_candidates]:
            item = dict(candidate)
            if not item.get("magnet") and item.get("detailUrl"):
                resolved = click_detail_popup(page, item, debug)
                if not resolved:
                    continue
                item = resolved

            magnet = item.get("magnet", "")
            key = magnet.lower()
            if not magnet or key in seen:
                continue
            seen.add(key)
            results.append(item)

    timeout_seconds = max(
        REQUEST_TIMEOUT_SECONDS,
        FORM_RESULT_WAIT_SECONDS + min(MAX_POPUP_DETAILS, max(max_results, 6)) * DETAIL_POPUP_WAIT_SECONDS + 30,
    )
    with StealthySession(**build_stealth_kwargs(timeout_seconds, False)) as session:
        session_holder["session"] = session
        page = session.fetch(
            SEARCH_ORIGIN,
            page_action=submit_search,
            solve_cloudflare=False,
            timeout=timeout_seconds * 1000,
            network_idle=True,
        )

    if not final_url:
        final_url = str(getattr(page, "url", "") or SEARCH_ORIGIN)

    results.sort(key=lambda item: score_result(item, query), reverse=True)
    if results:
        return {
            "ok": True,
            "query": query,
            "queryCode": extract_code(query),
            "url": final_url,
            "source": "scrapling-helper",
            "results": annotate_results(results, query, max_results),
            "debug": debug,
        }, ""

    return None, last_error or "form search reached results but no popup magnet was parsed"


def collect_from_html(
    query: str,
    max_results: int,
    html_text: str,
    final_url: str,
    debug: dict[str, Any],
) -> tuple[dict[str, Any] | None, str]:
    if is_cloudflare_check(html_text):
        return None, "仍然遇到 Cloudflare 校验。"

    candidates = parse_search_candidates(html_text, final_url)[:16]
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    last_error = ""

    for candidate in candidates:
        item = dict(candidate)
        if not item.get("magnet") and item.get("detailUrl"):
            try:
                detail_html, detail_url, detail_fetcher, detail_status = fetch_page(item["detailUrl"])
                debug["attempted"].append({
                    "url": item["detailUrl"],
                    "finalUrl": detail_url,
                    "fetcher": detail_fetcher,
                    "status": detail_status,
                })
                detail_magnets = parse_magnets(detail_html)
                item["magnet"] = detail_magnets[0] if detail_magnets else ""
                item["source"] = detail_url
            except Exception as error:
                last_error = str(error)
                continue

        magnet = item.get("magnet", "")
        key = magnet.lower()
        if not magnet or key in seen:
            continue
        seen.add(key)
        results.append(item)

    results.sort(key=lambda item: score_result(item, query), reverse=True)
    if results:
        return {
            "ok": True,
            "query": query,
            "queryCode": extract_code(query),
            "url": final_url,
            "source": "scrapling-helper",
            "results": annotate_results(results, query, max_results),
            "debug": debug,
        }, ""

    return None, last_error or "页面可访问，但没有解析到磁力。"


def collect_results(query: str, max_results: int, first_url: str = "") -> dict[str, Any]:
    query_variants = build_query_variants(query)
    primary_query = query_variants[0] if query_variants else normalize_query(query)
    search_targets: list[tuple[str, str]] = []
    if first_url:
        search_targets.append((primary_query, first_url))
    else:
        for variant in query_variants:
            for url in build_search_urls(variant):
                if not any(existing_url == url for _existing_query, existing_url in search_targets):
                    search_targets.append((variant, url))
    last_error = ""
    debug: dict[str, Any] = {"attempted": [], "queryVariants": query_variants}

    if USE_FORM_SEARCH_FIRST:
        try:
            payload, last_error = collect_results_by_form(primary_query, max_results, debug)
            if payload:
                return payload
        except ModuleNotFoundError as error:
            raise RuntimeError('缺少 Scrapling：请先运行 pip install "scrapling[fetchers]" && scrapling install') from error
        except Exception as error:
            last_error = str(error)
            debug["attempted"].append({"url": SEARCH_ORIGIN, "fetcher": "stealth-form", "error": last_error})

    for search_query, search_url in search_targets:
        try:
            html_text, final_url, fetcher, status = fetch_page(search_url)
            debug["attempted"].append({"url": search_url, "finalUrl": final_url, "fetcher": fetcher, "status": status})
            payload, last_error = collect_from_html(search_query, max_results, html_text, final_url, debug)
            if payload:
                return payload
        except ModuleNotFoundError as error:
            raise RuntimeError('缺少 Scrapling：请先运行 pip install "scrapling[fetchers]" && scrapling install') from error
        except Exception as error:
            last_error = str(error)
            debug["attempted"].append({"url": search_url, "error": last_error})

    if not USE_FORM_SEARCH_FIRST and not first_url:
        try:
            payload, last_error = collect_results_by_form(primary_query, max_results, debug)
            if payload:
                return payload
        except Exception as error:
            last_error = str(error)
            debug["attempted"].append({"url": SEARCH_ORIGIN, "fetcher": "stealth-form", "error": last_error})

    return {
        "ok": False,
        "query": primary_query,
        "queryCode": extract_code(primary_query),
        "error": last_error or "没有解析到可用磁力结果。",
        "debug": debug,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "SkrbtsoScraplingHelper/0.2"

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _is_authorized(self) -> bool:
        if not AUTH_TOKEN:
            return True
        expected = f"Bearer {AUTH_TOKEN}"
        supplied = self.headers.get("Authorization", "")
        return hmac.compare_digest(supplied, expected)

    def do_OPTIONS(self) -> None:
        self._send_json(200, {"ok": True})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json(200, {"ok": True})
            return

        if parsed.path not in {"/skrbtso/search", "/search"}:
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        if not self._is_authorized():
            self._send_json(401, {"ok": False, "error": "Unauthorized"})
            return

        params = parse_qs(parsed.query)
        query = (params.get("q") or params.get("query") or [""])[0].strip()
        first_url = unquote((params.get("url") or [""])[0].strip())
        try:
            max_results = max(1, min(20, int((params.get("max") or [DEFAULT_MAX_RESULTS])[0])))
        except ValueError:
            max_results = DEFAULT_MAX_RESULTS

        if not query:
            self._send_json(400, {"ok": False, "error": "Missing q/query"})
            return

        if first_url and not is_search_url(first_url):
            self._send_json(400, {"ok": False, "error": "url must point to skrbtso.top"})
            return

        if not REQUEST_SEMAPHORE.acquire(blocking=False):
            self._send_json(429, {"ok": False, "error": "Helper is busy; retry later"})
            return

        try:
            payload = collect_results(query, max_results, first_url)
            self._send_json(200 if payload.get("ok") else 502, payload)
        except Exception as error:
            payload: dict[str, Any] = {
                "ok": False,
                "error": str(error),
            }
            if DEBUG_ENABLED:
                payload["trace"] = traceback.format_exc(limit=3)
            self._send_json(500, payload)
        finally:
            REQUEST_SEMAPHORE.release()

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"skrbtso helper listening on http://{HOST}:{PORT}/skrbtso/search", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
