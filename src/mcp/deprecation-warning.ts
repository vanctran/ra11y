/**
 * Layers a deprecation-warning code onto a tool result's top-level
 * `warnings: string[]` array so agents calling a renamed / aliased
 * tool can migrate on their own schedule. Edits both the
 * JSON-stringified text payload and the structured content so the
 * signal is visible regardless of which surface the agent reads.
 *
 * Returns the result unchanged when the shape doesn't match our
 * text+structured convention (defensive; never throws). Errors
 * (`isError: true`) are also left untouched — warnings layered on
 * errors would muddy the error-envelope contract.
 */

export function layerDeprecationWarning(result: unknown, code: string): unknown {
  if (!result || typeof result !== "object") return result;
  const shape = result as {
    content?: Array<{ type?: string; text?: unknown }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  if (shape.isError === true) return result;
  const first = shape.content?.[0];
  if (!first || typeof first.text !== "string") return result;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(first.text) as Record<string, unknown>;
  } catch {
    return result;
  }
  const existing = Array.isArray(parsed["warnings"])
    ? (parsed["warnings"] as readonly string[])
    : [];
  if (existing.includes(code)) return result;
  const warnings = [...existing, code];
  const patched = { ...parsed, warnings };
  const nextContent = [{ type: "text", text: JSON.stringify(patched, null, 2) }];
  const structured =
    shape.structuredContent && typeof shape.structuredContent === "object"
      ? { ...shape.structuredContent, warnings }
      : patched;
  return { ...shape, content: nextContent, structuredContent: structured };
}
