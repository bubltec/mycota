# Agent instructions

**The source of truth for agent instructions in this repo is [`.cursor/rules/`](.cursor/rules/).**
Read the rules there before making changes. Rules with `alwaysApply: true` always
apply; the others apply when their `globs` match the files you are touching, or when
their `description` fits the task.

This file and `CLAUDE.md` are pointers only. Do not add rules here. Add or change
them in `.cursor/rules/`, so there is exactly one place to keep current.

| Rule | Applies | Covers |
| --- | --- | --- |
| [`sync-before-code-changes`](.cursor/rules/sync-before-code-changes.mdc) | always | Fetch origin, compare `main` and the current branch, check whether the branch's PR merged, and the merge/rebase guard |
| [`release-on-merge`](.cursor/rules/release-on-merge.mdc) | always | Merging to `main` publishes to npm; how the version bump is chosen |
| [`recover-from-merged-branch`](.cursor/rules/recover-from-merged-branch.mdc) | on request | The stash-and-restart sequence when a branch's PR already merged |
| [`mycota-solution-architecture`](.cursor/rules/mycota-solution-architecture.mdc) | globs | Package design, peer-dependency policy, manifest contract, testing, new-package checklist |

Human-facing documentation is in [`README.md`](README.md).
