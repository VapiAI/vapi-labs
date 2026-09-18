#!/usr/bin/env python3
"""Validate one or more Agent Skills without external dependencies."""

from __future__ import annotations

import argparse
from pathlib import Path

from skill_validation import discover_skills, validate_skill


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "skills",
        nargs="*",
        help="Skill directories. Defaults to this project, which is itself one skill.",
    )
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    skill_dirs = (
        [Path(skill_name).resolve() for skill_name in args.skills]
        if args.skills
        else ([project_root] if (project_root / "SKILL.md").is_file() else discover_skills(project_root))
    )
    if not skill_dirs:
        raise SystemExit("No skills found")

    failures: list[str] = []
    for skill_dir in skill_dirs:
        if not skill_dir.is_dir():
            failures.append(f"{skill_dir.name}: skill directory does not exist")
            continue
        try:
            warnings = validate_skill(skill_dir)
        except ValueError as error:
            failures.append(str(error))
            continue
        print(f"PASS {skill_dir.name}")
        for warning in warnings:
            print(f"WARN {skill_dir.name}: {warning}")

    if failures:
        raise SystemExit("\n".join(failures))

    print(f"Validated {len(skill_dirs)} skill(s).")


if __name__ == "__main__":
    main()
