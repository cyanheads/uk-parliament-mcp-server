# uk-parliament-mcp-server - Directory Structure

Generated on: 2026-10-25 13:14:52

```text
uk-parliament-mcp-server/
├── .claude-plugin/
│   └── plugin.json
├── .codex-plugin/
│   ├── mcp.json
│   └── plugin.json
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   ├── config.yml
│   │   └── feature_request.yml
│   ├── workflows/
│   │   └── codeql.yml
│   ├── CODE_OF_CONDUCT.md
│   ├── CONTRIBUTING.md
│   ├── FUNDING.yml
│   └── SECURITY.md
├── .vscode/
│   ├── extensions.json
│   └── settings.json
├── changelog/
│   └── template.md
├── docs/
│   └── design.md
├── framework-skills/
│   ├── add-app-tool/
│   │   └── SKILL.md
│   ├── add-prompt/
│   │   └── SKILL.md
│   ├── add-resource/
│   │   └── SKILL.md
│   ├── add-service/
│   │   └── SKILL.md
│   ├── add-test/
│   │   └── SKILL.md
│   ├── add-tool/
│   │   └── SKILL.md
│   ├── api-auth/
│   │   └── SKILL.md
│   ├── api-canvas/
│   │   └── SKILL.md
│   ├── api-config/
│   │   └── SKILL.md
│   ├── api-context/
│   │   └── SKILL.md
│   ├── api-errors/
│   │   └── SKILL.md
│   ├── api-linter/
│   │   └── SKILL.md
│   ├── api-mirror/
│   │   └── SKILL.md
│   ├── api-services/
│   │   ├── references/
│   │   │   ├── graph.md
│   │   │   ├── llm.md
│   │   │   └── speech.md
│   │   └── SKILL.md
│   ├── api-telemetry/
│   │   └── SKILL.md
│   ├── api-testing/
│   │   └── SKILL.md
│   ├── api-utils/
│   │   ├── references/
│   │   │   ├── formatting.md
│   │   │   ├── parsing.md
│   │   │   └── security.md
│   │   └── SKILL.md
│   ├── api-workers/
│   │   └── SKILL.md
│   ├── code-simplifier/
│   │   └── SKILL.md
│   ├── design-mcp-server/
│   │   └── SKILL.md
│   ├── field-test/
│   │   └── SKILL.md
│   ├── git-wrapup/
│   │   └── SKILL.md
│   ├── maintenance/
│   │   └── SKILL.md
│   ├── orchestrations/
│   │   ├── workflows/
│   │   │   ├── field-test-fix.md
│   │   │   ├── fix-wrapup-release.md
│   │   │   ├── greenfield-build.md
│   │   │   └── maintenance-release.md
│   │   └── SKILL.md
│   ├── polish-docs-meta/
│   │   ├── references/
│   │   │   ├── agent-protocol.md
│   │   │   ├── package-meta.md
│   │   │   ├── readme.md
│   │   │   └── server-json.md
│   │   └── SKILL.md
│   ├── release-and-publish/
│   │   └── SKILL.md
│   ├── release-pr-review/
│   │   └── SKILL.md
│   ├── report-issue-framework/
│   │   └── SKILL.md
│   ├── report-issue-local/
│   │   └── SKILL.md
│   ├── security-pass/
│   │   └── SKILL.md
│   ├── setup/
│   │   └── SKILL.md
│   ├── techniques/
│   │   ├── references/
│   │   │   └── outline-on-overflow.md
│   │   └── SKILL.md
│   └── tool-defs-analysis/
│       └── SKILL.md
├── scripts/
│   ├── build-changelog.ts
│   ├── build.ts
│   ├── check-dependency-specifiers.ts
│   ├── check-docs-sync.ts
│   ├── check-framework-antipatterns.ts
│   ├── check-skill-versions.ts
│   ├── check-skills-sync.ts
│   ├── clean-mcpb.ts
│   ├── clean.ts
│   ├── devcheck.ts
│   ├── install-otel.ts
│   ├── lint-mcp.ts
│   ├── lint-packaging.ts
│   ├── list-skills.ts
│   ├── prune-musl-packages.ts
│   ├── release-github.ts
│   └── tree.ts
├── src/
│   ├── mcp-server/
│   │   ├── prompts/
│   │   │   └── definitions/
│   │   ├── resources/
│   │   │   └── definitions/
│   │   └── tools/
│   │       └── definitions/
│   │           ├── ukparl-get-bill.tool.ts
│   │           ├── ukparl-get-committee.tool.ts
│   │           ├── ukparl-get-member.tool.ts
│   │           ├── ukparl-lookup-reference.tool.ts
│   │           ├── ukparl-search-bills.tool.ts
│   │           ├── ukparl-search-divisions.tool.ts
│   │           ├── ukparl-search-hansard.tool.ts
│   │           ├── ukparl-search-members.tool.ts
│   │           └── ukparl-search-questions.tool.ts
│   ├── services/
│   │   ├── bills/
│   │   │   ├── bills-schemas.ts
│   │   │   └── bills-service.ts
│   │   ├── committees/
│   │   │   ├── committee-models.ts
│   │   │   └── committees-service.ts
│   │   ├── divisions/
│   │   │   ├── divisions-schemas.ts
│   │   │   └── divisions-service.ts
│   │   ├── hansard/
│   │   │   ├── hansard-schemas.ts
│   │   │   └── hansard-service.ts
│   │   ├── members/
│   │   │   ├── member-models.ts
│   │   │   ├── member-normalization.ts
│   │   │   └── members-service.ts
│   │   ├── parliament-http/
│   │   │   ├── parliament-cursors.ts
│   │   │   ├── parliament-delivery.ts
│   │   │   ├── parliament-http-service.ts
│   │   │   └── parliament-models.ts
│   │   └── questions/
│   │       ├── question-models.ts
│   │       └── questions-service.ts
│   └── index.ts
├── tests/
│   ├── fuzz/
│   ├── integration/
│   │   └── parliament-registration.int.test.ts
│   ├── prompts/
│   ├── resources/
│   ├── services/
│   │   ├── bills/
│   │   │   ├── bills-fixtures.ts
│   │   │   └── bills-service.test.ts
│   │   ├── committees/
│   │   │   ├── committees-fixtures.ts
│   │   │   └── committees-service.test.ts
│   │   ├── divisions/
│   │   │   ├── divisions-fixtures.ts
│   │   │   └── divisions-service.test.ts
│   │   ├── hansard/
│   │   │   ├── hansard-fixtures.ts
│   │   │   └── hansard-service.test.ts
│   │   ├── members/
│   │   │   ├── members-fixtures.ts
│   │   │   └── members-service.test.ts
│   │   ├── parliament-http/
│   │   │   ├── parliament-cursors.test.ts
│   │   │   ├── parliament-delivery.test.ts
│   │   │   ├── parliament-http-service.test.ts
│   │   │   └── parliament-wire-budget.test.ts
│   │   └── questions/
│   │       ├── questions-fixtures.ts
│   │       └── questions-service.test.ts
│   ├── smoke/
│   └── tools/
│       ├── ukparl-get-bill.test.ts
│       ├── ukparl-get-committee.test.ts
│       ├── ukparl-get-member.test.ts
│       ├── ukparl-lookup-reference.test.ts
│       ├── ukparl-search-bills.test.ts
│       ├── ukparl-search-divisions.test.ts
│       ├── ukparl-search-hansard.test.ts
│       ├── ukparl-search-members.test.ts
│       └── ukparl-search-questions.test.ts
├── .dockerignore
├── .env.example
├── .gitattributes
├── .gitignore
├── .mcpbignore
├── AGENTS.md
├── biome.json
├── bun.lock
├── bunfig.toml
├── CLAUDE.md
├── devcheck.config.json
├── Dockerfile
├── LICENSE
├── manifest.json
├── package.json
├── README.md
├── server.json
├── tsconfig.build.json
├── tsconfig.json
└── vitest.config.ts
```

_Note: This tree excludes files and directories matched by .gitignore and default patterns._
