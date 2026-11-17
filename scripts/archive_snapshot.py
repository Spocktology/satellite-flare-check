"""Save one compressed snapshot per UTC day of all mirrored orbital data.

Usage: python scripts/archive_snapshot.py <data_dir> <history_dir>

Writes <history_dir>/YYYY/YYYY-MM-DD.tle.gz (3-line TLE, one entry per NORAD
id) if today's file doesn't exist yet, and keeps <history_dir>/index.json up
to date with the list of available days. The app fetches these files from
raw.githubusercontent.com to analyse past sightings.
"""
import glob
import gzip
import json
import os
import sys
import time


def read_tles(path):
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    out = []
    for i, l1 in enumerate(lines):
        if not l1.startswith("1 ") or i + 1 >= len(lines) or not lines[i + 1].startswith("2 "):
            continue
        name = lines[i - 1].strip() if i > 0 and not lines[i - 1].startswith(("1 ", "2 ")) else ""
        out.append((l1[2:7].strip(), name, l1.rstrip(), lines[i + 1].rstrip()))
    return out


def main():
    data_dir, hist_dir = sys.argv[1], sys.argv[2]
    day = time.strftime("%Y-%m-%d", time.gmtime())
    path = os.path.join(hist_dir, day[:4], day + ".tle.gz")
    index_path = os.path.join(hist_dir, "index.json")

    if os.path.exists(path):
        print("snapshot already exists:", path)
        return

    seen = {}
    for f in sorted(glob.glob(os.path.join(data_dir, "*.tle"))):
        for norad, name, l1, l2 in read_tles(f):
            seen.setdefault(norad, (name, l1, l2))
    if len(seen) < 5000:
        raise SystemExit(f"only {len(seen)} objects in {data_dir} — not archiving an incomplete snapshot")

    text = "".join(f"{n}\n{l1}\n{l2}\n" for n, l1, l2 in seen.values())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as g:
        g.write(text)

    days = sorted(os.path.basename(p)[:10] for p in glob.glob(os.path.join(hist_dir, "*", "*.tle.gz")))
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump({"updated": int(time.time() * 1000), "days": days}, f)
    print(f"archived {len(seen)} objects to {path} ({os.path.getsize(path) // 1024} KB); {len(days)} days total")


if __name__ == "__main__":
    main()
