# Manual Release Process Guide

This document describes the step-by-step manual release process for OpenNeato using AI assistance to analyze
commits, generate release notes, trigger the GitHub Actions workflow, and roll over release milestones via opencode
(with `gh` CLI integration).

## Overview

The manual release process involves:

1. **AI-driven commit analysis** - Analyze commit history since the last release
2. **AI-generated release notes** following strict formatting conventions, committed as `release-notes/<tag>.md`
3. **Preview and review** - release notes shown before any actions are taken
4. **Human review and approval** for quality control
5. **Notes committed first** - the tag carries its notes, so the release page is the reviewed file
6. **Workflow dispatch** - trigger GitHub Actions via `gh` CLI with the tag alone
7. **Automated build and release** - the workflow builds frontend, firmware and the flash tool, then publishes the
   GitHub Release with the notes from the tagged commit
8. **Milestone rollover** - close the released milestone and create the next minor milestone

## Prerequisites

- [opencode](https://opencode.ai/) installed
- [GitHub CLI (`gh`)](https://cli.github.com) installed and authenticated (`gh auth login`)
- Understanding of conventional commit patterns
- Familiarity with major.minor versioning (no patch versions)
- The release notes committed on the branch you dispatch from (the workflow refuses a tag with no notes)

## AI-Assisted Release Process

Use this prompt in opencode to handle the entire release process:

### Master Release Prompt

```
I need to create a new release for OpenNeato. Please:

STEP 1: ANALYZE COMMITS
- Use `gh` CLI or available tools to get the latest release tag
- Fetch all commits between that tag and current HEAD
- Analyze each commit for user-facing changes
- Resolve the GitHub username for each externally authored user-facing change from its commit or merged PR

STEP 2: GENERATE RELEASE NOTES
Draft release-notes/v[VERSION].md with this EXACT format:

[Only if breaking changes exist - add a [!CAUTION] banner at the top:]

> [!CAUTION]
> **Brief summary of the breaking change and user impact.**
> Upgrade steps or workarounds if applicable.

### Breaking Changes
- Description focusing on user impact (abc1234)

### New Features
- Feature description emphasizing user benefit (abc1234)

### Improvements
- Improvement description with user impact (abc1234)

### Bug Fixes
- Fix description focusing on the resolved user issue (abc1234)

REQUIREMENTS:
- Open with the sections, not a banner: a banner is for breaking changes ([!CAUTION]) or for one sentence the
  sections cannot carry (a release with nothing user-visible), never for routine context
- Focus ONLY on user-facing changes and impact
- EXCLUDE: docs, build, ci, chore, refactor, test commits
- Use active voice, present tense
- Include commit short hashes (GitHub renders them as links)
- Credit external contributors inline as `abc1234 by @username`, never the repository owner; changes authored in
  this repository carry the bare hash
- Closely related changes may be collapsed into one bullet; keep a separate attribution for each external author
- Do not add a separate Contributors section
- Version logic: major.minor format only (no patch), and the file name matches the tag exactly
  - MINOR version (1.0 -> 1.1): new features, improvements, bug fixes
  - MAJOR version (1.1 -> 2.0): breaking changes detected
- Show this preview BEFORE any actions

STEP 3: SHOW PREVIEW
Display the file's content and ask for approval before proceeding.

STEP 4: COMMIT THE NOTES (after approval)
Commit release-notes/v[VERSION].md and push the branch. The release workflow refuses a tag whose notes are not in
the repository, so this has to land on the branch you dispatch from.

STEP 5: TRIGGER THE WORKFLOW
Trigger the "Build and Release" workflow with the tag alone:

gh workflow run release.yml \
  -f release_tag="v[VERSION]" \
  -F draft=false \
  -F prerelease=false

STEP 6: ROLL OVER THE MILESTONE (after the workflow succeeds)
- Wait for the release workflow to complete successfully
- List all milestones and find the open milestone matching the release tag
- Verify that the next minor milestone does not already exist
- Close the released milestone and create the next minor milestone

gh api --paginate 'repos/{owner}/{repo}/milestones?state=all' \
  --jq '.[] | [.number, .title, .state] | @tsv'
gh api --method PATCH 'repos/{owner}/{repo}/milestones/[MILESTONE_NUMBER]' \
  -f state=closed
gh api --method POST 'repos/{owner}/{repo}/milestones' \
  -f title='v[NEXT_VERSION]'

Please start with Step 1 - analyze the commits and show me the preview.
```

## How It Works

opencode will:
1. **Analyze commits** since the last release via `gh` CLI
2. **Draft `release-notes/<tag>.md`** with proper formatting, categorization, and inline external-author shoutouts
3. **Show preview** and ask for approval
4. **Commit the notes** and **trigger the GitHub Actions workflow** with the tag alone
5. The workflow **refuses a tag with no notes**, then **builds frontend** (npm), **builds firmware** (PlatformIO),
   and **GoReleaser** builds the cross-platform flash tool binaries and publishes the GitHub Release with the
   firmware packs and the OpenAPI spec attached
6. After the workflow succeeds, **close the released milestone** and **create the next minor milestone**

The release page's body is `release-notes/<tag>.md` read from the tagged commit, not an input: what was reviewed
before the run is what the release says. A release publishes as soon as the run succeeds, since its notes were
reviewed before dispatch; pass `draft=true` to the workflow to hold one back.

### The notes are part of the repository

`release-notes/<tag>.md` holds one file per published release, named exactly like its tag (`v0.15.md`). They are the
record of what shipped, so they are committed and never edited after publishing. Only the PR and branch prereleases
(`prerelease.yml`) skip this, since their notes are generated from the PR number or branch.

## Features

- **Automatic filtering** of technical commits (docs, tests, CI, etc.)
- **User-focused** release notes with clear impact descriptions
- **Notes in the repository** - a release cannot publish without `release-notes/<tag>.md` at the tag
- **Smart versioning** - minor for features/fixes, major for breaking changes
- **Inline contributor recognition** - externally authored changes credit their authors
- **Preview before action** - human approval required
- **Full build pipeline** - frontend, firmware, and flash tool all built in one workflow
- **Milestone rollover** - completed releases close their milestone and open the next minor milestone

## Prereleases

Prereleases let you build and publish full release artifacts from a PR or branch for testing before merging or
releasing. They do not need committed notes.

### Triggering

**From the PR page:** Comment `/prerelease` on the PR. Only repository collaborators (OWNER, MEMBER, COLLABORATOR)
can trigger this.

**From the CLI:**
```bash
gh workflow run prerelease.yml -f pr_number=<pr-number>
```

For a branch-only prerelease, omit `pr_number` and choose the branch ref:

```bash
gh workflow run prerelease.yml -r <branch-name>
```

### How it works

1. If `pr_number` is provided, resolves the PR head branch and commit
2. If `pr_number` is omitted, uses the workflow ref as a branch-only prerelease source
3. Computes a tag based on the latest release: `v<base>-pr<number>.<sha>` for PRs or `v<base>-<branch>.<sha>` for
   branches
4. Builds frontend, firmware, and flash tool
5. Publishes a GitHub prerelease via GoReleaser
6. Posts a comment on the PR with the release link when triggered via `/prerelease`

### Notes

- No CI gate - trigger whenever you want a test build
- Previous prereleases are not automatically cleaned up; remove stale PR or branch prereleases manually when needed
- The base version comes from the latest non-prerelease GitHub release (falls back to `v0.0`)
- A prerelease is stale when its PR is merged or closed, its PR head SHA no longer matches, or a branch prerelease
  has been superseded by a later stable release

## Troubleshooting

- **gh CLI issues**: Run `gh auth status` to verify authentication
- **Workflow dispatch failed**: Check repository permissions for workflow dispatch
- **`release-notes/<tag>.md is missing`**: commit the notes for that tag on the branch you dispatch from, then run
  it again; the workflow refuses to tag without them. An existing tag is checked too, so a tag created without notes
  has to be moved to a commit that has them
- **Milestone rollover failed**: Verify the released milestone exists, the next milestone does not, and your token
  has issue write permission
- **Invalid release notes**: Review format requirements and regenerate the file
- **PlatformIO build fails**: Ensure `c3-release` environment builds locally first
- **Frontend build fails**: Run `npm run build` in `frontend/` locally to verify

---

*Use the master prompt above to start your next release.*
