---
name: claude-api
description: Build, debug, and optimize Claude API / Anthropic SDK apps. TRIGGER when code imports anthropic/@anthropic-ai/sdk; user asks to use the Claude API, Anthropic SDKs, or Managed Agents.
---

# Building LLM-Powered Applications with Claude

## Output Requirement
Code must call Claude through the official Anthropic SDK for the project's language. Never mix SDK with raw HTTP. Never fall back to OpenAI-compatible shims.

## Defaults
- Model: `claude-opus-4-7` (unless user specifies otherwise)
- Thinking: Adaptive thinking (`thinking: {type: "adaptive"}`)
- Streaming for long input/output
- max_tokens: ~16K (non-streaming) or ~64K (streaming)

## Which Surface Should I Use?

| Use Case | Surface |
|----------|---------|
| Single LLM call (classify, summarize, extract) | Claude API |
| Multi-step workflow, you control loop | Claude API + tool use |
| Server-managed stateful agent with workspace | Managed Agents |

## Language Detection
- `*.py`, `requirements.txt` → Python — `python/`
- `*.ts`, `*.tsx`, `package.json` → TypeScript — `typescript/`
- `*.go`, `go.mod` → Go — `go/`

## Current Models

| Model | ID | Context | Input $/1M | Output $/1M |
|-------|-----|---------|-----------|------------|
| Claude Opus 4.7 | `claude-opus-4-7` | 1M | $5.00 | $25.00 |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 200K | $3.00 | $15.00 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | $1.00 | $5.00 |

ALWAYS use `claude-opus-4-7` unless user explicitly names a different model.

## Thinking & Effort
- Opus 4.7 / Sonnet 4.6: Use `thinking: {type: "adaptive"}`. Do NOT use budget_tokens (deprecated).
- Effort: `output_config: {effort: "low"|"medium"|"high"|"max"|"xhigh"}`. Default is high. max/xhigh — Opus only.

## Prompt Caching
Prefix match. Keep stable content first, volatile last. Max 4 breakpoints. Verify with `usage.cache_read_input_tokens`.

## Common Pitfalls
- Don't lowball max_tokens — hitting cap truncates output
- Don't use budget_tokens on Opus 4.7 / Sonnet 4.6
- Don't use assistant prefills on Opus 4.7 (use structured outputs)
- Always parse tool inputs with json.loads()/JSON.parse()
- Use SDK helpers (.finalMessage(), typed exceptions, SDK types)

## Live Documentation
Use WebFetch for latest docs. URLs in shared/live-sources.md.
