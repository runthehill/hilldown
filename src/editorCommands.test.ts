import { describe, expect, it } from "vitest";
import {
  applyInlineWrap,
  applyLinePrefix,
  applySlashCommand,
  filterSlashCommands,
  getLineColumn,
  getSlashQuery,
  insertSnippet,
  indentLines,
  outdentLines,
  slashCommands,
} from "./editorCommands";

describe("editor commands", () => {
  it("wraps selected text with inline formatting", () => {
    const result = applyInlineWrap("make bold", { start: 5, end: 9 }, "**");

    expect(result.value).toBe("make **bold**");
    expect(result.selectionStart).toBe(7);
    expect(result.selectionEnd).toBe(11);
  });

  it("wraps placeholder text when nothing is selected", () => {
    const result = applyInlineWrap("make ", { start: 5, end: 5 }, "_");

    expect(result.value).toBe("make _text_");
    expect(result.selectionStart).toBe(6);
    expect(result.selectionEnd).toBe(10);
  });

  it("prefixes each selected line", () => {
    const result = applyLinePrefix("one\ntwo", { start: 0, end: 7 }, "- ");

    expect(result.value).toBe("- one\n- two");
  });

  it("does not duplicate prefixes and fills empty selected lines", () => {
    const result = applyLinePrefix("- one\n", { start: 0, end: 6 }, "- ");

    expect(result.value).toBe("- one\n- text");
  });

  it("inserts snippets on a new line when needed", () => {
    const result = insertSnippet("Intro", { start: 5, end: 5 }, "## Heading", 3);

    expect(result.value).toBe("Intro\n## Heading");
    expect(result.selectionStart).toBe(9);
    expect(result.selectionEnd).toBe(9);
  });

  it("replaces selected text with snippets without adding a leading break at the start", () => {
    const result = insertSnippet("replace this", { start: 0, end: 12 }, "---");

    expect(result.value).toBe("---");
    expect(result.selectionStart).toBe(3);
    expect(result.selectionEnd).toBe(3);
  });

  it("detects slash commands at the start of the active line", () => {
    expect(getSlashQuery("Intro\n/tab", 10)).toEqual({
      start: 6,
      end: 10,
      query: "tab",
    });
    expect(getSlashQuery("/TABLE", 6)).toEqual({
      start: 0,
      end: 6,
      query: "table",
    });
  });

  it("ignores slash text that is not an active command query", () => {
    expect(getSlashQuery("Intro /tab", 10)).toBeNull();
    expect(getSlashQuery("Intro\n/table extra", 18)).toBeNull();
  });

  it("filters slash commands by label and keywords", () => {
    expect(filterSlashCommands("grid").map((command) => command.id)).toContain("table");
    expect(filterSlashCommands("todo").map((command) => command.id)).toContain("task-list");
    expect(filterSlashCommands("  ").length).toBe(slashCommands.length);
  });

  it("replaces the active slash query with command markdown", () => {
    const table = slashCommands.find((command) => command.id === "table");
    expect(table).toBeDefined();

    const result = applySlashCommand("Hello\n/tab", { start: 10, end: 10 }, table!);

    expect(result.value).toBe("Hello\n| Column A | Column B |\n| --- | --- |\n| Value | Value |");
    expect(result.selectionStart).toBe(8);
  });

  it("applies slash commands over a normal selection as a fallback", () => {
    const divider = slashCommands.find((command) => command.id === "divider");
    expect(divider).toBeDefined();

    const result = applySlashCommand("replace me", { start: 0, end: 10 }, divider!);

    expect(result.value).toBe("---");
    expect(result.selectionStart).toBe(3);
    expect(result.selectionEnd).toBe(3);
  });

  it("indents selected lines", () => {
    const result = indentLines("one\ntwo", { start: 0, end: 7 });

    expect(result.value).toBe("  one\n  two");
    expect(result.selectionStart).toBe(2);
    expect(result.selectionEnd).toBe(11);
  });

  it("does not indent the next line when a selection ends at a line break", () => {
    const result = indentLines("one\ntwo\nthree", { start: 0, end: 8 });

    expect(result.value).toBe("  one\n  two\nthree");
  });

  it("outdents selected lines", () => {
    const result = outdentLines("  one\n  two", { start: 2, end: 11 });

    expect(result.value).toBe("one\ntwo");
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe(7);
  });

  it("outdents tabbed and single-space lines", () => {
    const result = outdentLines("\tone\n two\nthree", { start: 1, end: 10 });

    expect(result.value).toBe("one\ntwo\nthree");
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe(8);
  });

  it("leaves unindented lines unchanged when outdenting", () => {
    const result = outdentLines("one\ntwo", { start: 0, end: 7 });

    expect(result.value).toBe("one\ntwo");
    expect(result.selectionStart).toBe(0);
    expect(result.selectionEnd).toBe(7);
  });

  it("returns one-based line and column", () => {
    expect(getLineColumn("one\ntwo", 6)).toEqual({ line: 2, column: 3 });
    expect(getLineColumn("one", -5)).toEqual({ line: 1, column: 1 });
  });
});
