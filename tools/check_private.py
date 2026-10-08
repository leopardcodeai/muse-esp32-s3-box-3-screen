#!/usr/bin/env python3
"""Refuses a publish while private data sits in the repo.

What: scans every tracked or untracked text file of the project for patterns of personal
  data (private IP ranges, Tailscale names, tokens, e-mail addresses, the owner's house
  names) and for files that must never leave the house (firmware/secrets.yaml, Meta's
  Muse artwork in firmware/figure/ or web/figure-default/, which is recognised by its
  checksums not matching the project's own figure). Exit code 1 means: do not push.
Why: the firmware grew up in a real house; names, addresses and tokens crept into
  comments and examples more than once. A check that runs before every push is cheaper
  than a leaked token.
Pitfalls:
  * The checksums of the project's figure are stored in tools/figure_checksums.txt by
    `--record-figure` after running tools/make_figure.py; run that again whenever the
    figure changes on purpose.
  * Allowed by design: 192.168.0.X and 192.168.0.N (the documentation network of the
    examples), example.ts.net, localhost, the author's byline.
Usage:
  python3 tools/check_private.py            # scan, exit 1 on findings
  python3 tools/check_private.py --record-figure
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECKSUMS = ROOT / "tools" / "figure_checksums.txt"
TEXT_SUFFIXES = {".yaml", ".yml", ".h", ".cpp", ".py", ".md", ".txt", ".json", ".sh", ".html", ".css", ".js"}
PATTERNS = [
    ("private IPv4 address", re.compile(r"\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.(?!0\.(?:X|\d{1,3})\b)\d{1,3}\.\d{1,3}\b")),
    ("Tailscale tailnet name", re.compile(r"\btail[0-9a-f]{6}\.ts\.net\b")),
    ("long-lived token", re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}")),
    ("e-mail address", re.compile(r"\b[\w.+-]+@(?!example\.)[\w-]+\.(?!ttf\b|png\b|yaml\b|json\b|txt\b)[a-z]{2,}\b")),
    # The author's own byline is public by design; the family's surname alone is not.
    ("household name", re.compile(r"\b(Packenius|Alicia|Wolfgang)\b|(?<!Alexander )\bBrunker\b")),
    ("Home Assistant camera token", re.compile(r"[?&]token=[0-9a-f]{16,}")),
    ("Spotify client id", re.compile(r"\b[0-9a-f]{32}\b(?=.*(?:client|spotify))", re.I)),
]
MUST_NOT_EXIST = ["firmware/secrets.yaml"]


def tracked_files():
    try:
        out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=ROOT,
                             capture_output=True, text=True, check=True).stdout
        return [ROOT / l for l in out.splitlines() if l]
    except Exception:
        return [p for p in ROOT.rglob("*") if p.is_file() and ".git" not in p.parts]


def figure_checksums():
    """The project's figure frames that git would commit; ignored muse_*.png (Meta's artwork) are not looked at."""
    out = {}
    tracked = set(tracked_files())
    for p in sorted((ROOT / "firmware" / "figure").glob("*.png")):
        if p in tracked:
            out[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def main():
    if "--record-figure" in sys.argv:
        CHECKSUMS.write_text("".join(f"{v}  {k}\n" for k, v in figure_checksums().items()))
        print(f"recorded {len(figure_checksums())} figure checksums")
        return 0
    findings = []
    for rel in MUST_NOT_EXIST:
        if (ROOT / rel).exists() and rel in subprocess.run(["git", "ls-files", rel], cwd=ROOT, capture_output=True, text=True).stdout:
            findings.append(f"{rel}: tracked by git")
    if CHECKSUMS.exists():
        known = dict(line.split()[::-1] for line in CHECKSUMS.read_text().splitlines() if line.strip())
        for name, digest in figure_checksums().items():
            if known.get(name) != digest:
                findings.append(f"firmware/figure/{name}: not the project's figure (Meta's artwork? never publish it)")
        # The web app's copy of the figure is deployed: it must be the same six files.
        tracked = set(tracked_files())
        for path in sorted((ROOT / "web" / "figure-default").glob("*")):
            if path in tracked and known.get(path.name) != hashlib.sha256(path.read_bytes()).hexdigest():
                findings.append(f"web/figure-default/{path.name}: not the project's figure (copy firmware/figure/)")
    else:
        findings.append("tools/figure_checksums.txt missing: run --record-figure after tools/make_figure.py")
    for path in tracked_files():
        if path.suffix.lower() not in TEXT_SUFFIXES or not path.exists():
            continue
        if path.name == "check_private.py" or "muse_gif" in path.parts:  # third-party code keeps its author's address
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        for what, pat in PATTERNS:
            for m in pat.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                findings.append(f"{path.relative_to(ROOT)}:{line}: {what}: {m.group(0)[:40]}")
    if findings:
        print("Private data found, do not publish:")
        for f in findings[:60]:
            print("  " + f)
        if len(findings) > 60:
            print(f"  ... and {len(findings) - 60} more")
        return 1
    print("No private data found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
