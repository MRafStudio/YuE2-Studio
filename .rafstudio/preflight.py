#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Preflight for a pull request to YuE2-Studio: the author's rules, checked.

Run this BEFORE opening a PR to timoncool/YuE2-Studio. It reads the branch we are
about to offer and reports every rule the author keeps - so nothing depends on
remembering them.

    python preflight.py                 # check the branch against upstream/main
    python preflight.py --root <tree>   # another working copy
    python preflight.py --base origin/main

Only the lines WE add are judged: an inherited comment that happens to hold a
Cyrillic word (the author's own note about the Создать button) is not our doing.

Every check prints PASS / FAIL / WARN. A FAIL is something the author would send
back; a WARN is worth a look before asking for a review.
"""
import argparse
import pathlib
import re
import subprocess
import sys

# The checkout this script belongs to: it sits in <repo>/.rafstudio, so the
# repository is found relative to the script and no path is hard-coded.
HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_ROOT = HERE.parent
CONVENTIONAL = re.compile(r"^(feat|fix|docs|refactor|test|chore|perf|ci|build|style)(\([a-z0-9_.-]+\))?!?: .+")
CYRILLIC = re.compile(r"[А-Яа-яЁё]")

# Files that must never ride along in a pull request.
FORBIDDEN_SUFFIXES = (
    ".gguf", ".safetensors", ".bin", ".onnx", ".pt", ".pth", ".ckpt",
    ".mp3", ".wav", ".flac", ".db", ".sqlite", ".bak", ".log",
    ".key", ".pem", ".pfx",
)
FORBIDDEN_NAMES = {"IDEA.md", ".env", ".env.local", "AGENT-NOTES.md"}
FORBIDDEN_DIRS = ("node_modules/", "target/", "dist/", ".hermes/", "webview-data/")

# The runtime the author keeps out of the application.
FORBIDDEN_IN_NEW_CODE = (
    ("python", "Python in the runtime path"),
    ("child_process", "Node.js child processes"),
)


def run(root: pathlib.Path, args: list[str]) -> tuple[int, str]:
    done = subprocess.run(["git", "-C", str(root)] + args, capture_output=True, text=True)
    return done.returncode, (done.stdout + done.stderr).strip()


def added_lines(root: pathlib.Path, base: str) -> dict[str, list[tuple[int, str]]]:
    """Lines our commit adds, per file, with their numbers in the new file."""
    code, diff = run(root, ["diff", "--unified=0", f"{base}..HEAD"])
    out: dict[str, list[tuple[int, str]]] = {}
    name = None
    number = 0
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            name = line[6:]
            out.setdefault(name, [])
        elif line.startswith("@@"):
            found = re.search(r"\+(\d+)", line)
            number = int(found.group(1)) if found else 0
        elif name is not None:
            if line.startswith("+") and not line.startswith("+++"):
                out[name].append((number, line[1:]))
                number += 1
            elif line.startswith(" "):
                number += 1
    return out


class Report:
    def __init__(self) -> None:
        self.fails = 0
        self.warns = 0

    def line(self, state: str, text: str) -> None:
        if state == "FAIL":
            self.fails += 1
        elif state == "WARN":
            self.warns += 1
        mark = {"PASS": "ok  ", "FAIL": "!!  ", "WARN": "?   "}[state]
        print(f"  {mark}{text}")


def check_branch(root: pathlib.Path, base: str, report: Report) -> list[str]:
    """One commit on a fresh base, a conventional subject, only source files."""
    code, ahead = run(root, ["rev-list", "--count", f"{base}..HEAD"])
    if code != 0:
        report.line("FAIL", f"no such base '{base}' - fetch the remotes first")
        return []
    count = int(ahead or 0)
    if count == 1:
        report.line("PASS", "one commit on top of the base")
    elif count == 0:
        report.line("FAIL", f"nothing to offer: HEAD equals {base}")
    else:
        report.line("WARN", f"{count} commits on top of {base} - consider squashing into one")

    code, subject = run(root, ["log", "-1", "--pretty=%s"])
    if CONVENTIONAL.match(subject):
        report.line("PASS", f"conventional commit subject: {subject[:60]}")
    else:
        report.line("FAIL", f"commit subject is not conventional: {subject[:60]}")

    code, behind = run(root, ["rev-list", "--count", f"HEAD..{base}"])
    if code == 0 and int(behind or 0) > 0:
        report.line("WARN", f"{behind} commits behind {base} - merge it before asking for review")
    else:
        report.line("PASS", f"branch is up to date with {base}")

    code, names = run(root, ["diff", "--name-only", f"{base}..HEAD"])
    files = [name for name in names.splitlines() if name.strip()]
    if not files:
        report.line("FAIL", "the commit touches no files")
        return []
    bad = [
        name for name in files
        if name.startswith(FORBIDDEN_DIRS)
        or pathlib.PurePosixPath(name).name in FORBIDDEN_NAMES
        or name.lower().endswith(FORBIDDEN_SUFFIXES)
    ]
    if bad:
        report.line("FAIL", "personal or heavy files in the commit: " + ", ".join(bad))
    else:
        shown = ", ".join(files[:6]) + (" …" if len(files) > 6 else "")
        report.line("PASS", f"{len(files)} files, all source: {shown}")
    return files


def check_added_code(added: dict[str, list[tuple[int, str]]], report: Report) -> None:
    """Our own added lines: English comments, no banned runtime."""
    comment_leaks = []
    banned = []
    for name, lines in added.items():
        translated = "/i18n/" in name  # the catalogues hold every language by design
        for number, text in lines:
            stripped = text.strip()
            if stripped.startswith(("//", "/*", "*")) and CYRILLIC.search(stripped):
                comment_leaks.append(f"{name}:{number}")
            if not translated:
                for token, why in FORBIDDEN_IN_NEW_CODE:
                    if token in text:
                        banned.append(f"{name}:{number} - {why}")

    if comment_leaks:
        report.line("FAIL", "Russian comments in the lines we add: " + ", ".join(comment_leaks[:6]))
    else:
        report.line("PASS", "comments in our lines are English only")

    if banned:
        report.line("FAIL", "runtime the author forbids: " + "; ".join(banned))
    else:
        report.line("PASS", "no Python or Node in the runtime path")


def check_checks(root: pathlib.Path, report: Report) -> None:
    """The two gates the repository already has: types and tests."""
    app = root / "app"
    if not (app / "node_modules").is_dir():
        report.line("WARN", "app/node_modules is missing - run `npm --prefix app install`, then tsc and vitest")
        return
    for label, args in (
        ("tsc --noEmit", ["npx", "tsc", "--noEmit", "-p", "tsconfig.json"]),
        ("vitest run", ["npx", "vitest", "run"]),
    ):
        done = subprocess.run(args, cwd=str(app), capture_output=True, text=True, shell=(sys.platform == "win32"))
        tail = (done.stdout + done.stderr).strip().splitlines()
        if done.returncode == 0:
            summary = next((l for l in reversed(tail) if "Tests" in l or "passed" in l), "")
            report.line("PASS", f"{label} passed {('· ' + summary.strip()) if summary else ''}")
        else:
            report.line("FAIL", f"{label} failed: " + (tail[-1] if tail else "no output"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Check the author's rules before a pull request")
    parser.add_argument("--root", default=DEFAULT_ROOT, help="working copy of the repository")
    parser.add_argument("--base", default="upstream/main", help="the branch the PR would target")
    opts = parser.parse_args()

    root = pathlib.Path(opts.root)
    print(f"PREFLIGHT: {root}  →  {opts.base}")
    if not (root / "app" / "App.tsx").is_file():
        print(f"  !!  {root} does not look like a YuE2-Studio copy")
        return 2

    report = Report()
    files = check_branch(root, opts.base, report)
    if files:
        check_added_code(added_lines(root, opts.base), report)
    check_checks(root, report)

    print()
    if report.fails:
        print(f"NOT READY: {report.fails} check(s) failed, {report.warns} warning(s)")
        return 1
    print(f"READY for a pull request: {report.warns} warning(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
