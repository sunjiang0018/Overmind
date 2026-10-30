# Learnings

## [LRN-20261030-N24] correction

**Logged**: 2026-10-30T12:44:01+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
The user confirmed that the target official Screeps environment runs Node.js 24.

### Details
The package originally declared Node 20.11, which led to an overly conservative plan for Object.groupBy. The actual target version supplied by the user takes precedence over stale project metadata. The shared workspace was subsequently updated to Node 24 and TypeScript 5.9.3; TypeScript already includes Object.groupBy types, so the temporary declaration added during migration was removed.

### Suggested Action
Use native Node 24 APIs for this deployment target. Re-read current package scripts and types before final checks when the shared workspace changes. Preserve Lodash 3's plain grouping records and null/undefined keys at the migration boundary, and keep caller-provided object predicates lazy when their side effects can change later values.

### Metadata
- Source: user_feedback
- Related Files: package.json, src/utilities/groupBy.ts, tests/native-grouping.test.cjs
- Tags: screeps, node24, native-grouping, shared-workspace

### Resolution
- **Resolved**: 2026-10-30
- **Notes**: Native Object.groupBy and Object.keys are used; object filters use Object.entries where predicates are suitable. Grouping behavior is checked against Lodash 3.10.1.

---
