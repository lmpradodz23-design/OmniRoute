/**
 * Operator settings that shape the MCP tool descriptions announced by createMcpServer,
 * read from the `compression` namespace of the key_value table:
 *  - `mcpDescriptionCompressionEnabled` — description compression toggle (default ON);
 *  - `mcpAccessibility` — smartFilterText config, clamped to safe bounds.
 * Both fail open to their defaults when the row is absent, unparsable, or the database
 * is unavailable.
 */
import {
  DEFAULT_MCP_ACCESSIBILITY_CONFIG,
  clampMcpAccessibilityConfig,
  type McpAccessibilityConfig,
} from "../services/compression/engines/mcpAccessibility/constants.ts";
import { getDbInstance } from "../../src/lib/db/core.ts";

export function readMcpDescriptionCompressionEnabled(): boolean {
  try {
    const row = getDbInstance()
      .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
      .get("compression", "mcpDescriptionCompressionEnabled") as { value?: string } | undefined;
    if (!row?.value) return true;
    return JSON.parse(row.value) !== false;
  } catch {
    return true;
  }
}

export function readMcpAccessibilityConfig(): McpAccessibilityConfig {
  try {
    const row = getDbInstance()
      .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
      .get("compression", "mcpAccessibility") as { value?: string } | undefined;
    if (!row?.value) return { ...DEFAULT_MCP_ACCESSIBILITY_CONFIG };
    // clampMcpAccessibilityConfig bounds every field (and folds in the non-object guard), so a
    // persisted out-of-range maxTextChars can't make smartFilterText truncate the whole text.
    return clampMcpAccessibilityConfig(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_MCP_ACCESSIBILITY_CONFIG };
  }
}
