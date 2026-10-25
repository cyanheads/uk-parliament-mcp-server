#!/usr/bin/env node
/**
 * @fileoverview uk-parliament-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { echoTool } from './mcp-server/tools/definitions/echo.tool.js';

await createApp({
  name: 'uk-parliament-mcp-server',
  title: 'uk-parliament-mcp-server',
  tools: [echoTool],
  sessionMode: 'stateless',
});
