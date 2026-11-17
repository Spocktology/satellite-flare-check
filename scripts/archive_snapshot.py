"""Save one compressed snapshot per UTC day of the CelesTrak mirror.

Usage: python scripts/archive_snapshot.py <data_dir> <history_dir>

Writes <history_dir>/YYYY/YYYY-MM-DD.tle.gz if today's file doesn't exist yet
and rebuilds index.json. These CelesTrak snapshots give immediate coverage;
backfill_spacetrack.py later replaces them with complete Space-Track
snapshots once that day's history is final.
"""
import glob
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from history_index import build_index, day_path, read_tles, write_snapshot  # noqa: E402


def main():
    data_dir, hist_dir = sys.argv[1], sys.argv[2]
    day = time.strftime("%Y-%m-%d", time.gmtime())
    if os.path.exists(day_path(hist_dir, day)):
        print("snapshot already exists for", day)
        build_index(hist_dir)
        return

    seen = {}
    for f in sorted(glob.glob(os.path.join(data_dir, "*.tle"))):
        text = open(f, encoding="utf-8", errors="replace").read()
        for norad, name, l1, l2, _ in read_tles(text):
            seen.setdefault(norad, (name, l1, l2))
    if len(seen) < 5000:
        raise SystemExit(f"only {len(seen)} objects in {data_dir} - not archiving an incomplete snapshot")

    path = write_snapshot(hist_dir, day, seen.values(), spacetrack=False)
    days = build_index(hist_dir)
    print(f"archived {len(seen)} objects to {path} ({os.path.getsize(path) // 1024} KB); {len(days)} days total")


if __name__ == "__main__":
    main()
