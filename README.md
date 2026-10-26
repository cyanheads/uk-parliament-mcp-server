<div align="center">
  <h1>@cyanheads/uk-parliament-mcp-server</h1>
  <p><b>Search UK Parliament bills, members, votes, Hansard, written questions, and committees via MCP. STDIO or Streamable HTTP.</b>
  <div>9 Tools</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.1-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/uk-parliament-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.4.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/uk-parliament-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/uk-parliament-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.4-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/uk-parliament-mcp-server/releases/latest/download/uk-parliament-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=uk-parliament-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvdWstcGFybGlhbWVudC1tY3Atc2VydmVyIl19) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22uk-parliament-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fuk-parliament-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://uk-parliament.caseyjhand.com/mcp](https://uk-parliament.caseyjhand.com/mcp)

</div>

---

## Overview

Westminster records from the official UK Parliament Bills, Members, Commons and Lords Votes, Hansard, Written Questions, and Committees APIs. Search parliamentary business, retrieve selected records and source links, and trace members, bills, votes, answers, and committee publications across their distinct identifiers. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above; no API key is required.

### Tools

| Tool | Description |
|:---|:---|
| `ukparl_lookup_reference` | Resolve filter IDs, identifier namespaces, and historical coverage guidance |
| `ukparl_search_bills` | Search and order bill summaries by title, House, session, sponsor, department, stage, type, and status |
| `ukparl_get_bill` | Retrieve bill details, stages, publications, amendments, and ping-pong motions |
| `ukparl_search_members` | Find current and former MPs and peers, including dated membership searches |
| `ukparl_get_member` | Retrieve profiles, roles, committee seats, official contacts, interests, and voting history |
| `ukparl_search_divisions` | Search House-scoped divisions and member votes; inspect metadata, voters, and party totals |
| `ukparl_search_hansard` | Search spoken contributions with complete source text where supplied |
| `ukparl_search_questions` | Search question and answer previews or retrieve complete question details |
| `ukparl_get_committee` | Discover committees and business; retrieve memberships, publications, and written/oral evidence metadata |

## Capability reference

### `ukparl_lookup_reference` <sub>tool</sub>

- `topic`: `identifiers`, `coverage`, `bill_stages`, `bill_types`, `parties`, `departments`, or `answering_bodies`; live directories default to 10 rows, capped at 20, with optional `nameContains` AND-token filtering
- `house` is required only for `parties`; that directory covers active parties in the selected House, not every historical party. Static guides accept neither House nor name filters
- Identifier guidance distinguishes reference `stageId` from bill-specific `billStageId`, House-scoped division IDs, Questions API IDs from UINs, and committee person IDs from Members API IDs
- `departments` IDs feed `ukparl_search_bills.departmentId`; they are distinct from Written Questions answering-body IDs

---

### `ukparl_search_bills` <sub>tool</sub>

- Optional `query`, current `house`, `originatingHouse`, `sessionId`, `memberId`, `departmentId`, `stageIds`, and `billTypeIds`; each ID array accepts up to 20 entries. Defaults to 10 bills, capped at 20
- `sortOrder`: `TitleAscending`, `TitleDescending`, `DateUpdatedAscending`, or `DateUpdatedDescending`; omission preserves source ordering. Optional `isDefeated` and `isWithdrawn` accept true or false. `inAmendableStage: true` restricts to amendable stages; false leaves results unrestricted
- Results are `detailLevel: "summary"` with `billId`, provenance, and collection continuation; no current-session scope is inferred. Resolve reference filters with `ukparl_lookup_reference`

---

### `ukparl_get_bill` <sub>tool</sub>

- Required `billId`; `section` defaults to `overview`, or selects `stages`, `stage`, `publications`, `amendments`, `amendment`, `motions`, or `motion`. Collections default to 20 records, capped at 50
- Stage, amendment, and motion selections require the bill-specific `billStageId` from `stages`; singular amendment/motion retrieval also needs `itemId` from the parent collection (`amendmentId` for amendments, `motion.id` for motions). Amendment/motion lists are summaries; singular selectors retrieve complete text
- Only `section: "amendments"` accepts `amendmentNumber` (a string retaining letter suffixes), official `decision`, and sponsoring `memberId` filters. Filters apply before source pagination; singular retrieval still uses `itemId`
- Missing entities return `found: false` with `guidance`. `section: "publications"` derives `legislationHandoff` (`authoritative_link`, `not_enacted`, or `unavailable`) from the bill's published documents; only supplied legislation.gov.uk links establish a statute handoff
- Overview reads metadata only. Unless `isAct` is explicitly false, its `unavailable` handoff explains that publications remain unchecked; repeat with the same `billId` and `section: "publications"` to discover statute links

---

### `ukparl_search_members` <sub>tool</sub>

- Optional `name`, `constituency` (source location text: constituency name or postcode), `partyId`, and `house`; `currentOnly` defaults to `false`, including current and former members. Defaults to 10 rows, capped at 20
- `asOf` selects membership on a real `YYYY-MM-DD` date and accepts `name`, pagination, and `currentOnly: false` alongside it; returned latest profile fields are not a historical snapshot
- Summary hits carry `memberId` for `ukparl_get_member`, `source`, and `page`; unknown source fields remain absent or null

---

### `ukparl_get_member` <sub>tool</sub>

- Required `memberId`; `section`: `profile` (default), `roles`, `committee_seats`, `contact`, `interests`, or `voting`. Roles without `category` returns an availability outline; select a returned category for whole role periods
- `house` is required for interests and voting, and omitted elsewhere. Local histories default to 20 rows, capped at 50; voting uses native 20-row pages regardless of `limit`
- `found` and `guidance` distinguish missing members and unavailable source collections. Interest trees and committee relationships retain source pointers; voting preserves recorded lobby and teller facts without inferring abstention or lifetime participation

---

### `ukparl_search_divisions` <sub>tool</sub>

- Required `house`: `commons` or `lords`; `mode`: `search` (default), `detail`, `voters`, or `party_totals`. Search accepts `query`, `memberId`, and inclusive `startDate` / `endDate`; defaults to 5 divisions, capped at 10
- Other modes require a `divisionId` from the same House. Voters default to 20 rows, capped at 50, with exact source `party` labels and `lobby`: Commons `aye`, `no`, `not_recorded`; Lords `content`, `not_content`
- Detail preserves headline counts and teller identities; `partyTotals` counts listed non-tellers and tellers separately. `not_recorded` is the source list, never an abstention claim; member searches include teller participation
- Search with `memberId` returns `memberVote: { memberId, lobby, wasTeller }` on each result, using the House's recorded lobby. A missing result does not imply abstention

---

### `ukparl_search_hansard` <sub>tool</sub>

- Optional `query`, `memberId`, `house`, inclusive `startDate` / `endDate`, and numeric `debateSectionId`; defaults to 5 contributions, capped at 20. Dates are `YYYY-MM-DD`, with no inferred window
- `detailLevel: "complete"` carries full source contribution text, including HTML; `summary` means the source supplied only a preview. Section filtering does not establish a complete debate transcript
- `coverage` reports historical limitations, including the 2004–2006 website warning; empty results do not prove no debate occurred. Narrow date windows after timeouts; use `ukparl_lookup_reference` with `topic: "coverage"` for archive guidance

---

### `ukparl_search_questions` <sub>tool</sub>

- `mode: "search"` (default) accepts `query`, `uin`, asking-member `memberId`, `answeringMemberId`, `house`, up to 20 `answeringBodyIds`, `answered`, and inclusive `tabledFrom` / `tabledTo` / `answeredFrom` / `answeredTo` dates (`YYYY-MM-DD`). Defaults to 10 previews, capped at 20
- Search includes all sessions and withdrawn questions; omitted `answered` includes either state. `mode: "detail"` takes a returned `questionId` alone for complete question/answer HTML, corrections, and attachment metadata; a UIN is not a `questionId`
- `uin` retains leading zeros and normalizes the `HL` prefix. Without dates, reused UINs can return candidates across sessions; combine `tabledFrom` / `tabledTo` and House filters to narrow them, then retrieve a returned `questionId`
- Results distinguish `detailLevel: "summary"` from `"complete"`; detail misses return `found: false` with `guidance`. Attachments are links and metadata, not downloaded files

---

### `ukparl_get_committee` <sub>tool</sub>

- `mode: "search"` (default) accepts `query`, `house` (`commons`, `lords`, `joint`), and `status: Current|Former|All`, default 10/cap 20. `detail`, `members`, and `publications` require `committeeId`; `inquiries` accepts it optionally for committee-specific or cross-committee discovery. Nested collections default to 20/cap 50
- `inquiry` requires `businessId`; `publication` requires `publicationId`. `businessId` can also filter publications. `membership` selects `all` (default), `current`, or `former` in members mode; `query` in inquiries/publications requires at least two characters
- `inquiries` accepts `status: Open|Closed`, `acceptingEvidence`, inclusive `openedFrom` / `openedTo` dates, and `sortOrder: DateOpenedNewest|DateOpenedOldest|PublicationDateAscending|PublicationDateDescending`. `acceptingEvidence: true` restricts to accepting businesses; false is unrestricted. All business types remain labelled by `isInquiry`
- `publications` accepts repeated `publicationTypeIds`, inclusive `publishedFrom` / `publishedTo` dates, and `sortOrder: PublicationDateAscending|PublicationDateDescending|ResponseDateAscending|ResponseDateDescending`. Omitted filters preserve source defaults
- `evidence` requires `businessId` and `evidenceType: written|oral`; `evidence_detail` requires `evidenceId` and the same `evidenceType`. These IDs occupy separate written/oral namespaces. Records retain typed entities and `sourcePath` relationships, witnesses, organisations, dates, source state, and supplied document links. Publications remain separate reports, responses, and correspondence; no mode downloads or extracts documents

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

UK Parliament-specific:

- Keyless, read-only access to seven official Westminster API origins; devolved legislatures are outside scope
- Separate identifier namespaces and explicit source selections, with no inferred current session or date window
- Shared per-origin backpressure, bounded retries, and a 45-second call deadline across related requests
- Hansard coverage is source-specific: the archive starts on 22 November 1803, the Spoken API minimum date is unknown, and there is no automatic historical-archive fallback

Agent-friendly output:

- Provenance — source API, request URL, retrieval timestamp, and licence link accompany source records; `applied` reports effective selections and limits
- Whole-record pagination — `page.returned`, `hasMore`, and `nextCursor` describe actually emitted records, with `total` only when known; every response stays under 24,000 bytes across both output surfaces
- Lossless large records — `delivery: "full" | "outline" | "fragment"`; an oversized record returns `contentPage` descriptors, and repeating the original inputs plus each `contentCursor` reconstructs it exactly
- Compact JSON — content renders complete values as reversible JSON blocks with clickable source links. An outline entry's optional `jsonValue` is complete JSON text you can decode directly; its `contentCursor` still retrieves the same value. Fragment sizes adapt to the response budget; concatenate their JSON text before decoding
- Explicit recovery — `invalid_cursor` restarts a selection; `source_changed` restarts content retrieval after an upstream revision. Search previews, missing records, and unavailable collections remain distinct
- Selector errors name each missing or incompatible field and its repair in deterministic order, before network requests; existing error reasons and recovery hints remain stable

## Getting started

Connect to the hosted instance, no install:

```sh
claude mcp add --transport http uk-parliament-mcp-server https://uk-parliament.caseyjhand.com/mcp
```

Or run it locally:

```sh
claude mcp add uk-parliament-mcp-server -- npx -y @cyanheads/uk-parliament-mcp-server
```

For other clients, add this to the MCP config file:

```json
{
  "mcpServers": {
    "uk-parliament-mcp-server": {
      "command": "npx",
      "args": ["-y", "@cyanheads/uk-parliament-mcp-server"]
    }
  }
}
```

No API key is required. For Docker or a source build, see [Running the server](#running-the-server).

## Configuration

| Variable | Description | Default |
|:---|:---|:---|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Initial HTTP server port; startup logs report the bound port after collision retries. | `3010` |
| `MCP_HTTP_HOST` | HTTP bind address. | `127.0.0.1` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP MCP endpoint. | `/mcp` |
| `MCP_SESSION_MODE` | HTTP session mode: `stateless`, `stateful`, or `auto`. | `stateless` |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<app-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1`. | `in-memory` |
| `OTEL_ENABLED` | Enable [OpenTelemetry](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |

See [`.env.example`](./.env.example) for the common framework overrides. There are no server-specific environment variables.

## Running the server

### Local development

Requires [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+) and internet access to the official Parliament APIs.

- **Clone and install:**

  ```sh
  git clone https://github.com/cyanheads/uk-parliament-mcp-server.git
  cd uk-parliament-mcp-server && bun install
  cp .env.example .env
  # edit .env for transport, logging, or authentication overrides as needed
  ```

- **Build and run the production version**:

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:http
  # or
  bun run start:stdio
  ```

- **Run checks and tests**:
  ```sh
  bun run devcheck  # Lints, formats, type-checks, and more
  bun run test      # Runs the test suite
  ```

### Docker

```sh
docker run --rm -p 3010:3010 ghcr.io/cyanheads/uk-parliament-mcp-server:latest
```

The image defaults to HTTP transport, stateless sessions, and logs to `/var/log/uk-parliament-mcp-server`. For an MCP client using stdio, use `"command": "docker"` with `"args": ["run", "-i", "--rm", "-e", "MCP_TRANSPORT_TYPE=stdio", "ghcr.io/cyanheads/uk-parliament-mcp-server:latest"]`. Build locally with `docker build -t uk-parliament-mcp-server .`; `--build-arg OTEL_ENABLED=false` omits the optional OpenTelemetry peers.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/mcp-server/tools/definitions` | Nine tool definitions (`*.tool.ts`). |
| `src/services/parliament-http` | Fixed-origin transport, provenance, cursors, and lossless content delivery. |
| `src/services/bills` | Bill search, scrutiny records, publications, and reference directories. |
| `src/services/members` | Member discovery, profiles, biographies, interests, and voting history. |
| `src/services/divisions` | Commons/Lords division metadata and recorded voter collections. |
| `src/services/hansard` | Spoken contribution search and historical coverage metadata. |
| `src/services/questions` | Written question previews and complete question/answer records. |
| `src/services/committees` | Committee business, memberships, publications, evidence metadata, and typed relationships. |
| `tests/` | Unit and integration tests, mirroring the `src/` structure. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for logging, `ctx.state` for storage
- Register new tools and resources in the `createApp()` arrays in `src/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](./LICENSE) for details.

Contains Parliamentary information licensed under the [Open Parliament Licence v3.0](https://www.parliament.uk/site-information/copyright-parliament/open-parliament-licence/) where applicable. Personal data, parliamentary marks, and third-party rights are excluded; preserve the source's notices and check rights before reusing excluded material. This software is independent and does not imply parliamentary endorsement.
