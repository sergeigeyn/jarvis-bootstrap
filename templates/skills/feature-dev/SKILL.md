---
name: feature-dev
description: Guided feature development with codebase understanding and architecture focus. 7-phase workflow — Discovery, Exploration, Questions, Architecture, Implementation, Review, Summary.
argument-hint: Optional feature description
---

# Feature Development

Systematic approach: understand codebase deeply, identify ambiguities, design elegant architectures, then implement.

## Core Principles
- **Ask clarifying questions**: Identify all ambiguities before coding. Wait for answers.
- **Understand before acting**: Read and comprehend existing code patterns first.
- **Read files identified by agents**: After agents complete, read key files to build context.
- **Simple and elegant**: Prioritize readable, maintainable code.
- **Use TodoWrite**: Track all progress throughout.

## Phase 1: Discovery
Understand what needs to be built. Create todo list. If unclear, ask user about problem, behavior, constraints. Summarize and confirm.

## Phase 2: Codebase Exploration
Launch 2-3 code-explorer agents in parallel targeting different aspects (similar features, architecture, UX). Each returns 5-10 key files. Read all identified files. Present summary.

## Phase 3: Clarifying Questions
**CRITICAL: DO NOT SKIP.** Review findings + request. Identify underspecified aspects: edge cases, error handling, integration points, scope, design preferences, performance. Present organized question list. Wait for answers.

## Phase 4: Architecture Design
Launch 2-3 code-architect agents with different focuses: minimal changes, clean architecture, pragmatic balance. Review approaches. Present to user with recommendation. Ask which they prefer.

## Phase 5: Implementation
**DO NOT START WITHOUT USER APPROVAL.** Read relevant files. Implement chosen architecture. Follow codebase conventions. Update todos.

## Phase 6: Quality Review
Launch 3 code-reviewer agents: simplicity/DRY, bugs/correctness, conventions/abstractions. Consolidate findings. Present to user — fix now, fix later, or proceed.

## Phase 7: Summary
Mark todos complete. Document: what was built, key decisions, files modified, suggested next steps.
