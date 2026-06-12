// ─────────────────────────────────────────────────────────────────────────────
// dom.ts
//
// Tiny DOM helpers used by the streaming renderer. The point of this module
// is to keep the per-token append path *fast and reflow-free*:
//
//   - `appendTextNoReflow(node, chunk)` mutates `node.nodeValue` in place.
//     It does NOT replace the node or insert new children, so the browser
//     does not invalidate layout. This is the single most important
//     optimisation in the chat renderer.
//
//   - `ensureChild(parent, tag, className)` lazily creates a child element
//     if one does not already exist. Used by the tool card update path:
//
//       ensureChild(toolCardEl, "div", "result")  // no-op if exists
//
//   - `shortNumber` and `truncate` are small string utilities used by the
//     timeline and context view to keep rendered output compact.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append text to a Text node without creating new DOM nodes. The browser
 * only updates the existing text content; layout is incremental and fast.
 */
export function appendTextNoReflow(textNode: Text, chunk: string): void {
  // nodeValue concatenation is O(n) in the existing string length. For
  // token-by-token streaming at ~30–80ms cadence with <50 char chunks,
  // this is fast enough up to ~1MB of text. Beyond that, callers should
  // batch chunks (we don't, by design — the spec says "incremental").
  textNode.nodeValue = (textNode.nodeValue ?? "") + chunk;
}

export function ensureChild(
  parent: ParentNode,
  tag: string,
  className?: string,
  idAttr?: string,
): HTMLElement {
  // We pick the first child matching the tag name and class. For the
  // simple shapes we use, this is unambiguous; the timeline and tool
  // cards each only ever have at most one of each.
  const existing = Array.from(parent.children).find((c) => {
    if (c.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    if (className !== undefined && c.className !== className) return false;
    if (idAttr !== undefined && c.id !== idAttr) return false;
    return true;
  });
  if (existing instanceof HTMLElement) return existing;

  const el = document.createElement(tag);
  if (className !== undefined) el.className = className;
  if (idAttr !== undefined) el.id = idAttr;
  parent.appendChild(el);
  return el;
}

export function clearChildren(parent: ParentNode): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
}

export function shortNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "\u2026";
}

/** Class-name joiner that filters falsy. */
export function cx(...parts: ReadonlyArray<string | false | null | undefined>): string {
  let out = "";
  for (const p of parts) {
    if (!p) continue;
    if (out.length > 0) out += " ";
    out += p;
  }
  return out;
}
