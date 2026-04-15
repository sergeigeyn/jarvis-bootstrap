---
name: mcp-builder
description: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate external APIs or services.
---

# MCP Server Development Guide

## Overview
Create MCP servers that enable LLMs to interact with external services through well-designed tools.

## Four-Phase Process

### Phase 1: Deep Research and Planning

**Design Principles:**
- Balance API coverage with workflow tools. When uncertain, prioritize comprehensive API coverage.
- Clear, descriptive tool names with consistent prefixes (e.g., `github_create_issue`)
- Tools return focused, relevant data with pagination/filtering
- Actionable error messages with specific suggestions

**Recommended Stack:**
- Language: TypeScript (recommended) or Python
- Transport: Streamable HTTP for remote, stdio for local

**MCP Docs:** Start with `https://modelcontextprotocol.io/sitemap.xml`

### Phase 2: Implementation

**Project Structure:** See language-specific guides.

**Core Infrastructure:**
- API client with authentication
- Error handling helpers
- Response formatting (JSON/Markdown)
- Pagination support

**Tool Implementation:**
- Input Schema: Use Zod (TypeScript) or Pydantic (Python)
- Output Schema: Define outputSchema for structured data
- Annotations: readOnlyHint, destructiveHint, idempotentHint, openWorldHint
- Async/await for I/O, proper error handling, pagination support

### Phase 3: Review and Test

**TypeScript:**
```bash
npm run build
npx @modelcontextprotocol/inspector
```

**Python:**
```bash
python -m py_compile your_server.py
```

### Phase 4: Create Evaluations

Create 10 complex, realistic questions to test LLM effectiveness with your MCP server.
Requirements: Independent, Read-only, Complex (multi-tool), Realistic, Verifiable, Stable.

## SDK Documentation
- Python: `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
- TypeScript: `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
