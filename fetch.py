"""Minimal HTTP layer: a polite, retrying GET.

There is deliberately no raw-HTML cache here anymore -- persistence lives in the structured
data store (see store.py), which keeps the *extracted* data instead of throwaway HTML. A
single collect run fetches each page at most once, so an in-run cache buys nothing.
"""
import time
import warnings

import requests

warnings.filterwarnings("ignore")  # silence LibreSSL urllib3 notice on system Python

USER_AGENT = "bdsl-stats/1.0 (personal league leaderboard; +https://bdsl.org)"
_POLITE_DELAY = 0.4  # seconds between live network fetches


def get(url: str, retries: int = 3) -> str:
    """Fetch `url` and return its text, retrying transient failures."""
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
            resp.raise_for_status()
            time.sleep(_POLITE_DELAY)
            return resp.text
        except requests.RequestException as err:
            last_err = err
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url} after {retries} attempts: {last_err}")
