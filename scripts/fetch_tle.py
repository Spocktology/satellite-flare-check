"""Download CelesTrak orbital-element groups into data/ for the site mirror.

Run by .github/workflows/deploy.yml every few hours. If CelesTrak refuses a
download (it allows one per group per 2 hours per IP), the copy from the
currently deployed site is reused so the mirror never goes empty.
"""
import json
import os
import time
import urllib.request

GROUPS = ["active", "visual", "analyst", "fengyun-1c-debris", "cosmos-2251-debris", "iridium-33-debris"]
SITE = os.environ.get("SITE_URL", "").rstrip("/")
UA = {"User-Agent": "satellite-flare-check-mirror/1.0"}


def get(url, timeout=120):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def count(text):
    return sum(1 for line in text.splitlines() if line.startswith("1 "))


def main():
    os.makedirs("data", exist_ok=True)
    old = {}
    if SITE:
        try:
            old = json.loads(get(SITE + "/data/meta.json", 30)).get("groups", {})
        except Exception as e:  # first deploy, or site unreachable
            print("no previous meta:", e)

    meta = {}
    for g in GROUPS:
        text = fetched = src = None
        try:
            t = get(f"https://celestrak.org/NORAD/elements/gp.php?GROUP={g}&FORMAT=tle")
            if count(t) > 0:
                text, fetched, src = t, int(time.time() * 1000), "CelesTrak"
            else:
                print(g, "CelesTrak returned no data:", t.strip()[:120])
        except Exception as e:
            print(g, "CelesTrak error:", e)
        if text is None and g in old and SITE:
            try:
                t = get(f"{SITE}/data/{g}.tle", 60)
                if count(t) > 0:
                    text, fetched, src = t, old[g]["fetched"], "previous deploy"
            except Exception as e:
                print(g, "previous copy error:", e)
        if text is None:
            print(g, "SKIPPED")
            continue
        with open(f"data/{g}.tle", "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        meta[g] = {"fetched": fetched, "count": count(text)}
        print(f"{g}: {meta[g]['count']} objects from {src}")
        time.sleep(2)

    with open("data/meta.json", "w", encoding="utf-8") as f:
        json.dump({"generated": int(time.time() * 1000), "groups": meta}, f)
    if "active" not in meta:
        raise SystemExit("active group missing - not deploying an incomplete mirror")


if __name__ == "__main__":
    main()
