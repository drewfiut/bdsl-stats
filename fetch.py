"""Minimal HTTP layer: a polite, retrying GET.

There is deliberately no raw-HTML cache here anymore -- persistence lives in the structured
data store (see store.py), which keeps the *extracted* data instead of throwaway HTML. A
single collect run fetches each page at most once, so an in-run cache buys nothing.
"""
import time
import warnings

import requests

try:
    # Silence LibreSSL's NotOpenSSLWarning on system Python, and only that warning -- a blanket
    # filterwarnings("ignore") would also mute unrelated warnings we'd want to see.
    from urllib3.exceptions import NotOpenSSLWarning
    warnings.filterwarnings("ignore", category=NotOpenSSLWarning)
except ImportError:
    pass  # older urllib3 has no such class; nothing to silence

USER_AGENT = "bdsl-stats/1.0 (personal league leaderboard; +https://bdsl.org)"
_POLITE_DELAY = 0.4  # seconds between live network fetches


def get_final(url: str, retries: int = 3):
    """Fetch `url`, returning (text, final_url) after any redirects.

    Schedule pages redirect from the runisa element URL to a friendly `schedules/<seg>/<tg>.html`
    page; `final_url` is that resolved address, which callers use to build the per-month bucket
    URLs (see schedules.py).
    """
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
            resp.raise_for_status()
            time.sleep(_POLITE_DELAY)
            return resp.text, resp.url
        except requests.RequestException as err:
            last_err = err
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url} after {retries} attempts: {last_err}")


def get(url: str, retries: int = 3) -> str:
    """Fetch `url` and return its text, retrying transient failures."""
    return get_final(url, retries)[0]


def get_optional(url: str, retries: int = 3):
    """Fetch `url`, returning its text, or `None` if it 404s (no retry on a 404).

    Used to probe per-month schedule buckets, most of which don't exist for a given competition;
    a missing month is expected, not an error, so a 404 returns None immediately instead of
    retrying. Any other persistent failure (timeout, connection error, 5xx, ...) is a real
    problem, not a missing month -- after exhausting retries it raises, the same as `get_final`,
    so a server outage can't be silently mistaken for an absent month and drop a month of games.
    """
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            time.sleep(_POLITE_DELAY)
            return resp.text
        except requests.RequestException as err:
            last_err = err
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url} after {retries} attempts: {last_err}")
