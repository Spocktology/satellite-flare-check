"""Fill the orbit archive with daily snapshots built from Space-Track history.

Usage:
  SPACETRACK_USER=... SPACETRACK_PASS=... \
  python scripts/backfill_spacetrack.py <history_dir> [--years 2] [--max-days 120]

Space-Track gives blanket approval to redistribute basic SSA data (TLE/OMM)
with citation; the app credits "Space-Track.org / USSPACECOM".

For each UTC day it queries gp_history for element sets with an epoch on
that day, and keeps, per object, the newest set seen so far. Objects that
are updated less often (debris) carry over from earlier days for up to
CARRY_DAYS. The snapshot for day D therefore holds each object's latest
orbit as of the end of day D.

Days are processed newest-first in contiguous chunks (each chunk ascending,
with a short warm-up), so recent months are covered first. Days that
already have a Space-Track snapshot are skipped, so the job can be re-run
until the whole range is filled. CelesTrak snapshots are replaced.

Testing without an account: set SPACETRACK_FAKE_DIR to a folder holding
YYYY-MM-DD.tle files; they're used instead of querying Space-Track.
"""
import argparse
import datetime as dt
import http.cookiejar
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from history_index import build_index, is_spacetrack, read_tles, write_snapshot  # noqa: E402

BASE = "https://www.space-track.org"
CARRY_DAYS = 10          # keep an object this long after its last element set
WARMUP_DAYS = 7          # days queried before a chunk to seed slow-updating objects
PAUSE_S = 13             # stay well under 30 requests/min and 300/hour
FINAL_LAG_DAYS = 2       # history for a day is considered final after this


class SpaceTrack:
    def __init__(self, user, password):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.opener.addheaders = [("User-Agent", "satellite-flare-check-archive/1.0")]
        body = urllib.parse.urlencode({"identity": user, "password": password}).encode()
        resp = self.opener.open(BASE + "/ajaxauth/login", body, timeout=60).read().decode()
        if "Failed" in resp:
            raise SystemExit("Space-Track login failed - check the SPACETRACK_USER / SPACETRACK_PASS secrets")
        self.last = 0.0

    def day(self, day):
        nxt = (dt.date.fromisoformat(day) + dt.timedelta(days=1)).isoformat()
        url = (f"{BASE}/basicspacedata/query/class/gp_history/EPOCH/{day}--{nxt}"
               "/orderby/NORAD_CAT_ID%20asc/format/3le/emptyresult/show")
        for attempt in range(6):
            wait = PAUSE_S - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            try:
                text = self.opener.open(url, timeout=600).read().decode("utf-8", "replace")
            except Exception as e:  # network hiccup or HTTP 429/5xx
                print(f"  {day}: {e} - retrying in {60 * (attempt + 1)} s", flush=True)
                time.sleep(60 * (attempt + 1))
                continue
            if "rate limit" in text.lower():
                print(f"  {day}: rate limited - waiting 5 min", flush=True)
                time.sleep(300)
                continue
            return text
        raise SystemExit(f"giving up on {day} after repeated errors")


class FakeSource:
    def __init__(self, folder):
        self.folder = folder

    def day(self, day):
        p = os.path.join(self.folder, day + ".tle")
        return open(p, encoding="utf-8").read() if os.path.exists(p) else ""


def chunks_newest_first(days, max_days):
    """Split sorted missing days into contiguous runs, newest run first, capped at max_days total."""
    runs, cur = [], []
    for d in days:
        if cur and dt.date.fromisoformat(d) - dt.date.fromisoformat(cur[-1]) != dt.timedelta(days=1):
            runs.append(cur)
            cur = []
        cur.append(d)
    if cur:
        runs.append(cur)
    out, left = [], max_days
    for run in reversed(runs):
        if left <= 0:
            break
        take = run[-left:]
        out.append(take)
        left -= len(take)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("history_dir")
    ap.add_argument("--years", type=float, default=2.0)
    ap.add_argument("--max-days", type=int, default=120)
    args = ap.parse_args()
    hist = args.history_dir

    today = dt.datetime.now(dt.timezone.utc).date()
    end = today - dt.timedelta(days=FINAL_LAG_DAYS)
    start = today - dt.timedelta(days=round(365.25 * args.years))
    all_days = [(start + dt.timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
    missing = [d for d in all_days if not is_spacetrack(hist, d)]
    print(f"range {start} -> {end}: {len(all_days) - len(missing)} days done, {len(missing)} to go")
    if not missing:
        build_index(hist)
        return

    fake = os.environ.get("SPACETRACK_FAKE_DIR")
    if fake:
        src = FakeSource(fake)
    else:
        user, pw = os.environ.get("SPACETRACK_USER"), os.environ.get("SPACETRACK_PASS")
        if not user or not pw:
            print("SPACETRACK_USER / SPACETRACK_PASS not set - nothing to do.")
            return
        src = SpaceTrack(user, pw)

    done = 0
    for run in chunks_newest_first(missing, args.max_days):
        first = dt.date.fromisoformat(run[0])
        warm = [(first - dt.timedelta(days=k)).isoformat() for k in range(WARMUP_DAYS, 0, -1)]
        state = {}  # norad -> (epoch_s, name, l1, l2)
        print(f"chunk {run[0]} -> {run[-1]} ({len(run)} days, {len(warm)} warm-up)", flush=True)
        for day in warm + run:
            t = time.time()
            text = src.day(day)
            n = 0
            for norad, name, l1, l2, ep in read_tles(text):
                n += 1
                cur = state.get(norad)
                if cur is None or ep >= cur[0]:
                    state[norad] = (ep, name or (cur[1] if cur else ""), l1, l2)
            if day not in run:
                print(f"  warm-up {day}: {n} element sets", flush=True)
                continue
            day_end = dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc).timestamp() + 86400
            keep = [(v[1], v[2], v[3]) for v in state.values() if day_end - CARRY_DAYS * 86400 <= v[0] < day_end + 3600]
            if len(keep) < 5000:
                print(f"  {day}: only {len(keep)} objects - skipped (incomplete history?)", flush=True)
                continue
            path = write_snapshot(hist, day, keep, spacetrack=True)
            done += 1
            print(f"  {day}: {n} sets -> {len(keep)} objects, {os.path.getsize(path) // 1024} KB ({time.time() - t:.0f} s)", flush=True)
        build_index(hist)  # keep index current so a partial run is still usable
    print(f"wrote {done} Space-Track snapshots")


if __name__ == "__main__":
    main()
