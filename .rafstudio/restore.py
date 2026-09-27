#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Restore our interface work in a copy of YuE2-Studio.

The work is a branch in our fork (`feat/top-control-panel-journal`). This script
puts it back into any copy of the repository by applying the patch kept beside
it (`patches/*.patch`).

It uses `patch -p1`, not `git apply`: a working copy unpacked from an archive
has no `.git`, and outside a repository `git apply` silently skips every file
while still reporting success — which is worse than failing.

Usage:
    python restore.py                  # apply to this checkout (its .rafstudio)
    python restore.py --root <tree>    # apply to another copy of the repository
    python restore.py --check          # report only, change nothing
"""
import argparse
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
# The checkout is this script's parent (<repo>/.rafstudio): nothing is pinned to
# one machine, so the repository can be moved or cloned anywhere.
DEFAULT_ROOT = HERE.parent

# What the finished state looks like: the two components, the strip and the log
# wired into the window, and the three strings present in the translated catalogue.
MARKERS = [
    ("app/components/TopControlPanel.tsx", 'data-slot="top-control-panel"'),
    ("app/components/AgentJournalPanel.tsx", 'data-slot="agent-journal-panel"'),
    ("app/App.tsx", "AgentJournalPanel"),
    ("app/App.tsx", "agentNotices"),
    ("app/i18n/yue2.ts", "controlPanelJournal"),
]


def missing(root: pathlib.Path) -> list[str]:
    """Markers that are not there yet, as 'file: reason' lines."""
    out = []
    for rel, token in MARKERS:
        path = root / rel
        if not path.is_file():
            out.append(f"{rel}: file missing")
            continue
        if token not in path.read_text(encoding="utf-8", errors="replace"):
            out.append(f"{rel}: no {token!r}")
    return out


def patches() -> list[pathlib.Path]:
    return sorted((HERE / "patches").glob("*.patch"))


def apply_patch(root: pathlib.Path, patch_file: pathlib.Path) -> int:
    """Run `patch -p1` inside the copy. Returns patch's exit code (0 = clean)."""
    with open(patch_file, "rb") as handle:
        done = subprocess.run(
            ["patch", "-p1", "--forward", "--batch"],
            cwd=str(root),
            stdin=handle,
            capture_output=True,
        )
    output = (done.stdout + done.stderr).decode("utf-8", "replace").strip()
    for line in output.splitlines()[:12]:
        print(f"      {line}")
    return done.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore the RafStudio interface work")
    parser.add_argument("--root", default=DEFAULT_ROOT, help="copy of the YuE2-Studio repository")
    parser.add_argument("--check", action="store_true", help="report only, change nothing")
    opts = parser.parse_args()

    root = pathlib.Path(opts.root)
    print(f"{'CHECK' if opts.check else 'RESTORE'}: {root}")
    if not (root / "app" / "App.tsx").is_file():
        print(f"  !!  {root} does not look like a YuE2-Studio copy")
        return 2

    gaps = missing(root)
    if not gaps:
        print("  ok  the interface work is already in place")
        return 0

    print(f"  ..  {len(gaps)} of {len(MARKERS)} markers are missing:")
    for line in gaps:
        print(f"      {line}")

    if opts.check:
        print("  !!  run without --check to put the work back")
        return 1

    found = patches()
    if not found:
        print("  !!  no patch in patches/ — nothing to apply")
        return 2

    for patch_file in found:
        print(f"  ..  applying {patch_file.name}")
        code = apply_patch(root, patch_file)
        if code > 1:
            print("  !!  the patch did not apply cleanly")
            return 2
        if code == 1:
            print("  !!  some hunks were rejected — check them by hand")

    gaps = missing(root)
    if gaps:
        print("  !!  still missing after the patch:")
        for line in gaps:
            print(f"      {line}")
        return 1
    print("  ok  restored: the control strip and the agent message log are in place")
    return 0


if __name__ == "__main__":
    sys.exit(main())
