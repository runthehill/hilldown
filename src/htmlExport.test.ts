import { describe, expect, it } from "vitest";
import { buildStandaloneHtml, escapeHtml } from "./htmlExport";

describe("htmlExport", () => {
  it("escapes markup-significant characters in text", () => {
    expect(escapeHtml(`a & b < c > "d"`)).toBe("a &amp; b &lt; c &gt; &quot;d&quot;");
  });

  it("wraps sanitized body html in a self-contained document", () => {
    const html = buildStandaloneHtml("My <Notes>", "<h1>Notes</h1><p>Hi</p>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>My &lt;Notes&gt;</title>");
    expect(html).toContain('<article class="markdown-preview">');
    expect(html).toContain("<h1>Notes</h1><p>Hi</p>"); // body is NOT re-escaped
    expect(html).toContain("<style>"); // reading theme inlined
  });
});
