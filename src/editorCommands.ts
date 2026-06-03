export type TextSelection = {
  start: number;
  end: number;
};

export type EditResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export type SlashCommand = {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  markdown: string;
  cursorOffset?: number;
};

export type SlashQuery = {
  start: number;
  end: number;
  query: string;
};

export type LineColumn = {
  line: number;
  column: number;
};

const placeholder = "text";

export const slashCommands: SlashCommand[] = [
  {
    id: "heading-1",
    label: "Heading 1",
    description: "Large section heading",
    keywords: ["h1", "title"],
    markdown: "# Heading",
    cursorOffset: 2,
  },
  {
    id: "heading-2",
    label: "Heading 2",
    description: "Subsection heading",
    keywords: ["h2", "subtitle"],
    markdown: "## Heading",
    cursorOffset: 3,
  },
  {
    id: "bulleted-list",
    label: "Bulleted List",
    description: "Start an unordered list",
    keywords: ["ul", "list", "bullet"],
    markdown: "- First item\n- Second item",
    cursorOffset: 2,
  },
  {
    id: "numbered-list",
    label: "Numbered List",
    description: "Start an ordered list",
    keywords: ["ol", "list", "number"],
    markdown: "1. First item\n2. Second item",
    cursorOffset: 3,
  },
  {
    id: "task-list",
    label: "Task List",
    description: "Add checklist items",
    keywords: ["todo", "check", "task"],
    markdown: "- [ ] First task\n- [ ] Second task",
    cursorOffset: 6,
  },
  {
    id: "quote",
    label: "Quote",
    description: "Insert a blockquote",
    keywords: ["blockquote", "callout"],
    markdown: "> Quote",
    cursorOffset: 2,
  },
  {
    id: "code-block",
    label: "Code Block",
    description: "Insert fenced code",
    keywords: ["code", "fence"],
    markdown: "```ts\nconsole.log(\"Hello Markdown\");\n```",
    cursorOffset: 6,
  },
  {
    id: "table",
    label: "Table",
    description: "Insert a GitHub-flavored table",
    keywords: ["grid", "columns", "rows"],
    markdown: "| Column A | Column B |\n| --- | --- |\n| Value | Value |",
    cursorOffset: 2,
  },
  {
    id: "link",
    label: "Link",
    description: "Insert a Markdown link",
    keywords: ["url", "anchor"],
    markdown: "[link text](https://example.com)",
    cursorOffset: 1,
  },
  {
    id: "divider",
    label: "Divider",
    description: "Insert a horizontal rule",
    keywords: ["rule", "separator", "hr"],
    markdown: "---",
  },
];

export function applyInlineWrap(
  value: string,
  selection: TextSelection,
  before: string,
  after = before,
  fallback = placeholder,
): EditResult {
  const selected = value.slice(selection.start, selection.end) || fallback;
  const next = `${value.slice(0, selection.start)}${before}${selected}${after}${value.slice(selection.end)}`;
  const contentStart = selection.start + before.length;
  const contentEnd = contentStart + selected.length;

  return {
    value: next,
    selectionStart: contentStart,
    selectionEnd: contentEnd,
  };
}

export function applyLinePrefix(
  value: string,
  selection: TextSelection,
  prefix: string,
): EditResult {
  const lineStart = value.lastIndexOf("\n", selection.start - 1) + 1;
  const lineEndIndex = value.indexOf("\n", selection.end);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const block = value.slice(lineStart, lineEnd);
  const prefixed = block
    .split("\n")
    .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line || placeholder}`))
    .join("\n");
  const next = `${value.slice(0, lineStart)}${prefixed}${value.slice(lineEnd)}`;
  const delta = next.length - value.length;

  return {
    value: next,
    selectionStart: selection.start + prefix.length,
    selectionEnd: selection.end + delta,
  };
}

export function insertSnippet(
  value: string,
  selection: TextSelection,
  snippet: string,
  cursorOffset = snippet.length,
): EditResult {
  const needsLeadingBreak = selection.start > 0 && value[selection.start - 1] !== "\n";
  const insert = `${needsLeadingBreak ? "\n" : ""}${snippet}`;
  const insertionStart = selection.start + (needsLeadingBreak ? 1 : 0);
  const next = `${value.slice(0, selection.start)}${insert}${value.slice(selection.end)}`;
  const cursor = insertionStart + cursorOffset;

  return {
    value: next,
    selectionStart: cursor,
    selectionEnd: cursor,
  };
}

function selectedLineRange(value: string, selection: TextSelection) {
  const lineStart = value.lastIndexOf("\n", selection.start - 1) + 1;
  const effectiveEnd = selection.end > selection.start && value[selection.end - 1] === "\n"
    ? selection.end - 1
    : selection.end;
  const lineEndIndex = value.indexOf("\n", effectiveEnd);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;

  return {
    lineStart,
    lineEnd,
    lines: value.slice(lineStart, lineEnd).split("\n"),
  };
}

export function indentLines(
  value: string,
  selection: TextSelection,
  indent = "  ",
): EditResult {
  const { lineStart, lineEnd, lines } = selectedLineRange(value, selection);
  const indented = lines.map((line) => `${indent}${line}`).join("\n");
  const next = `${value.slice(0, lineStart)}${indented}${value.slice(lineEnd)}`;
  const delta = indent.length * lines.length;

  return {
    value: next,
    selectionStart: selection.start + indent.length,
    selectionEnd: selection.end + delta,
  };
}

export function outdentLines(
  value: string,
  selection: TextSelection,
  indent = "  ",
): EditResult {
  const { lineStart, lineEnd, lines } = selectedLineRange(value, selection);
  let absoluteLineStart = lineStart;
  let removedBeforeStart = 0;
  let removedBeforeEnd = 0;

  const outdented = lines.map((line) => {
    const removeCount = line.startsWith(indent)
      ? indent.length
      : line.startsWith("\t") || line.startsWith(" ")
        ? 1
        : 0;

    if (removeCount > 0 && absoluteLineStart < selection.start) {
      removedBeforeStart += Math.min(removeCount, selection.start - absoluteLineStart);
    }

    if (removeCount > 0 && absoluteLineStart < selection.end) {
      removedBeforeEnd += Math.min(removeCount, selection.end - absoluteLineStart);
    }

    absoluteLineStart += line.length + 1;
    return line.slice(removeCount);
  }).join("\n");

  const next = `${value.slice(0, lineStart)}${outdented}${value.slice(lineEnd)}`;

  return {
    value: next,
    selectionStart: Math.max(lineStart, selection.start - removedBeforeStart),
    selectionEnd: Math.max(lineStart, selection.end - removedBeforeEnd),
  };
}

export function getLineColumn(value: string, cursor: number): LineColumn {
  const beforeCursor = value.slice(0, Math.max(0, cursor));
  const lines = beforeCursor.split("\n");
  const currentLine = lines[lines.length - 1] ?? "";

  return {
    line: lines.length,
    column: currentLine.length + 1,
  };
}

export function getSlashQuery(value: string, cursor: number): SlashQuery | null {
  const beforeCursor = value.slice(0, cursor);
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const currentLine = beforeCursor.slice(lineStart);
  const match = currentLine.match(/^\/([a-z0-9-]*)$/i);

  if (!match) {
    return null;
  }

  return {
    start: lineStart,
    end: cursor,
    query: match[1].toLowerCase(),
  };
}

export function filterSlashCommands(query: string): SlashCommand[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return slashCommands;
  }

  return slashCommands.filter((command) => {
    const searchable = [command.label, command.description, ...command.keywords]
      .join(" ")
      .toLowerCase();
    return searchable.includes(normalized);
  });
}

export function applySlashCommand(
  value: string,
  selection: TextSelection,
  command: SlashCommand,
): EditResult {
  const slashQuery = getSlashQuery(value, selection.start);
  const replacementStart = slashQuery?.start ?? selection.start;
  const replacementEnd = slashQuery?.end ?? selection.end;
  const next = `${value.slice(0, replacementStart)}${command.markdown}${value.slice(replacementEnd)}`;
  const cursor = replacementStart + (command.cursorOffset ?? command.markdown.length);

  return {
    value: next,
    selectionStart: cursor,
    selectionEnd: cursor,
  };
}

// Typographic characters the OS "smart" substitution (smart dashes/quotes) swaps
// plain keystrokes for. In Markdown *source* these silently corrupt syntax —
// `---` rules become an em dash, straight quotes in code become curly — so the
// editor rejects the substitution and keeps what was actually typed.
const smartPunctuation = new Set([
  "‐", // hyphen
  "‑", // non-breaking hyphen
  "‒", // figure dash
  "–", // en dash
  "—", // em dash
  "―", // horizontal bar
  "‘", // left single quote
  "’", // right single quote / smart apostrophe
  "“", // left double quote
  "”", // right double quote
  "…", // ellipsis
]);

/**
 * True when an `InputEvent` is the OS replacing typed characters with smart
 * punctuation. We match `insertReplacementText` whose payload is *only* smart
 * characters, so genuine spellcheck corrections (real words) are left alone.
 */
export function isSmartPunctuationSubstitution(
  inputType: string,
  data: string | null,
): boolean {
  if (inputType !== "insertReplacementText" || !data) {
    return false;
  }
  return [...data].every((char) => smartPunctuation.has(char));
}
