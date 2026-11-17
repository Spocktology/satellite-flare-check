"""Shared helpers for the orbit archive on the "history" branch.

Layout:
  YYYY/YYYY-MM-DD.tle.gz        3-line TLE snapshot, one entry per object
  YYYY/YYYY-MM-DD.spacetrack    empty marker: snapshot built from Space-Track
                                (complete catalog). No marker = CelesTrak.
  index.json                    {"updated", "days": [...], "sources": {day: src}}

index.json is always rebuilt from the files, so two jobs writing different
days can't leave it inconsistent.
"""
import calendar
import glob
import gzip
import json
import os
import time


def day_path(hist_dir, day):
    return os.path.join(hist_dir, day[:4], day + ".tle.gz")


def is_spacetrack(hist_dir, day):
    return os.path.exists(os.path.join(hist_dir, day[:4], day + ".spacetrack"))


def write_snapshot(hist_dir, day, entries, spacetrack):
    """entries: iterable of (name, line1, line2)."""
    path = day_path(hist_dir, day)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    text = "".join(f"{n}\n{l1}\n{l2}\n" for n, l1, l2 in entries)
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as g:
        g.write(text)
    marker = os.path.join(hist_dir, day[:4], day + ".spacetrack")
    if spacetrack:
        open(marker, "w").close()
    elif os.path.exists(marker):
        os.remove(marker)
    return path


def build_index(hist_dir):
    days = sorted(os.path.basename(p)[:10] for p in glob.glob(os.path.join(hist_dir, "*", "*.tle.gz")))
    sources = {d: ("space-track" if is_spacetrack(hist_dir, d) else "celestrak") for d in days}
    with open(os.path.join(hist_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": int(time.time() * 1000), "days": days, "sources": sources}, f)
    return days


def read_tles(text):
    """Yield (norad, name, line1, line2, epoch_seconds) from TLE/3LE text."""
    lines = text.splitlines()
    for i, l1 in enumerate(lines):
        if not l1.startswith("1 ") or i + 1 >= len(lines) or not lines[i + 1].startswith("2 "):
            continue
        prev = lines[i - 1] if i > 0 else ""
        name = prev[2:].strip() if prev.startswith("0 ") else ("" if prev.startswith(("1 ", "2 ")) else prev.strip())
        yield l1[2:7].strip(), name, l1.rstrip(), lines[i + 1].rstrip(), tle_epoch(l1)


def tle_epoch(l1):
    yy = int(l1[18:20])
    year = 2000 + yy if yy < 57 else 1900 + yy
    doy = float(l1[20:32])
    return calendar.timegm((year, 1, 1, 0, 0, 0)) + (doy - 1) * 86400
