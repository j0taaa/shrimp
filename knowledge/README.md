# Project Knowledge

This folder is Shrimp's repo-local knowledge base.

## Contract

- `knowledge/skills/<topic-slug>/SKILL.md`
  - Procedural capabilities, workflows, and troubleshooting playbooks
  - Optional auxiliaries:
    - `references/*.md`
    - `examples/*.ts` (or `.js`, `.py`)
    - `assets/*`

- `knowledge/facts/<domain-or-entity>/FACTS.md`
  - Situational facts (for example profile, people, domains, context notes)
  - Optional auxiliaries:
    - `references/*.md`
    - `examples/*`
    - `assets/*`

## Naming and Organization

- Keep folder names stable and merge-friendly (for example `twitter-api`, `jota-profile`, `friends`).
- Prefer updating existing folders over creating near-duplicates.
- Keep `SKILL.md` and `FACTS.md` as the entry points and link any auxiliary files.

## Examples

- `knowledge/skills/twitter-api/SKILL.md`
- `knowledge/skills/twitter-api/examples/post-tweet.ts`
- `knowledge/facts/jota-profile/FACTS.md`
- `knowledge/facts/friends/FACTS.md`
