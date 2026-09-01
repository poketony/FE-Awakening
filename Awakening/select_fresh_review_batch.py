#!/usr/bin/env python3
from __future__ import annotations

import argparse
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TRACKER = ROOT / "AUTOMATION_REVIEWED_FILES.txt"
SOURCES = (
    (ROOT / "Messages (K)", ROOT / "Messages (J)", "Awakening/Messages (K)/"),
    (ROOT / "DLC Message (K)", ROOT / "DLC Message (J)", "Awakening/DLC Message (K)/"),
)


def tracked_files() -> set[str]:
    text = TRACKER.read_text(encoding="utf-8")
    return {line.strip() for line in text.splitlines() if line.startswith("Awakening/")}


def is_nonlive_lucina_alias(kdir: Path, name: str) -> bool:
    if not name.endswith("_ルキナ.txt"):
        return False
    marth_name = name.replace("_ルキナ.txt", "_マルス.txt")
    return (kdir / marth_name).exists()


def fresh_candidates(done: set[str]) -> list[str]:
    out: list[str] = []
    for kdir, jdir, prefix in SOURCES:
        for kfile in kdir.glob("*.txt"):
            rel = prefix + kfile.name
            if rel in done:
                continue
            if not (jdir / kfile.name).exists():
                continue
            if is_nonlive_lucina_alias(kdir, kfile.name):
                continue
            out.append(rel)
    return sorted(out)


def select_batch(count: int) -> list[str]:
    done = tracked_files()
    candidates = fresh_candidates(done)
    if len(candidates) < count:
        raise SystemExit(f"only {len(candidates)} fresh files remain; requested {count}")
    return random.SystemRandom().sample(candidates, count)


def read_manifest(path: Path) -> list[str]:
    rows = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(rows) != len(set(rows)):
        raise SystemExit("manifest contains duplicate paths")
    return rows


def guard_manifest(rows: list[str]) -> None:
    done = tracked_files()
    overlap = [row for row in rows if row in done]
    if overlap:
        raise SystemExit("already reviewed since selection:\n" + "\n".join(overlap))

    valid = set(fresh_candidates(done))
    invalid = [row for row in rows if row not in valid]
    if invalid:
        raise SystemExit("manifest contains paths that are no longer valid fresh candidates:\n" + "\n".join(invalid))


def append_manifest(rows: list[str]) -> None:
    guard_manifest(rows)
    old = TRACKER.read_text(encoding="utf-8")
    suffix = "" if old.endswith("\n") else "\n"
    TRACKER.write_text(old + suffix + "".join(row + "\n" for row in rows), encoding="utf-8", newline="\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Select and guard fresh Awakening review batches")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_select = sub.add_parser("select", help="randomly select fresh, unreviewed files")
    p_select.add_argument("--count", type=int, default=50)
    p_select.add_argument("--output", type=Path)

    p_guard = sub.add_parser("guard", help="re-check that a selected manifest is still unreviewed")
    p_guard.add_argument("manifest", type=Path)

    p_append = sub.add_parser("append", help="guard, then append reviewed files to the tracker")
    p_append.add_argument("manifest", type=Path)

    args = parser.parse_args()

    if args.cmd == "select":
        rows = select_batch(args.count)
        text = "\n".join(rows) + "\n"
        if args.output:
            args.output.write_text(text, encoding="utf-8", newline="\n")
        else:
            print(text, end="")
    elif args.cmd == "guard":
        guard_manifest(read_manifest(args.manifest))
        print("OK: every manifest path is still fresh and unreviewed")
    elif args.cmd == "append":
        rows = read_manifest(args.manifest)
        append_manifest(rows)
        print(f"OK: appended {len(rows)} reviewed paths to {TRACKER}")


if __name__ == "__main__":
    main()
