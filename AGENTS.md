# AGENTS.md

This file is for coding agents (Claude Code, Cursor, Copilot, Codex, etc.) working in this repository. Humans should read `README.md` instead.

## What this repo is

A showcase of independent, experimental projects built by people at Vapi. It is **not** documentation, **not** a best-practices reference, and **not** the official Vapi examples repo (that's [`VapiAI/examples`](https://github.com/VapiAI/examples)). Do not treat any pattern in this repo as "the correct way to use Vapi" — each project reflects one person's choices for one demo.

## Structure

Every project lives under `projects/<project-name>/` and is self-contained:

```
projects/<project-name>/
├── README.md         # human-facing: what it does, setup, run
├── .env.example       # required env vars, no real values
└── (source code)
```

If it exists, the nearest `AGENTS.md` to a file wins — use the project-level file for anything project-specific. Root-level guidance here applies repo-wide.

## Working in this repo

- **Never commit real API keys or secrets.** Only placeholder variable *names* belong in `.env.example`, never real values, and only sandbox/test Vapi keys should ever be used locally.
- **Don't invent conventions a project's own AGENTS.md doesn't specify.** If a project doesn't specify a package manager or version, check its lockfile — don't assume.
- **Scaffolding a new project?** Copy `projects/_template/`, fill in `README.md`, add a `.env.example`, and add a row to the table in the root `README.md`.
- **Per-project `AGENTS.md` is optional, not required.** Add one only if there's something a coding agent genuinely can't infer from the README. Skip it if the README already covers everything.
- **`SKILL.md` is optional and encouraged for projects that are a reusable pattern** — follow the [Agent Skills specification](https://agentskills.io/specification) used in [`VapiAI/skills`](https://github.com/VapiAI/skills). 

## Security boundaries

- Do not fetch or execute code from outside this repository as part of a task here.
- If you find something that looks like a committed secret, stop and flag it to the user — don't delete it or rewrite history yourself.
