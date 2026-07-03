export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const exportStyles = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    background: #fcfaf5;
    color: #221e16;
    font-family: Newsreader, Georgia, "Times New Roman", serif;
  }
  .markdown-preview {
    max-width: 42rem;
    margin: 0 auto;
    padding: 3rem 1.5rem 4rem;
    font-size: 1.125rem;
    line-height: 1.72;
    text-wrap: pretty;
  }
  .markdown-preview > :first-child { margin-top: 0; }
  .markdown-preview h1, .markdown-preview h2, .markdown-preview h3, .markdown-preview h4 {
    margin: 1.5em 0 0.5em; line-height: 1.18; font-weight: 600;
  }
  .markdown-preview h1 { font-size: 2.1rem; }
  .markdown-preview h2 { font-size: 1.5rem; }
  .markdown-preview p, .markdown-preview ul, .markdown-preview ol,
  .markdown-preview blockquote, .markdown-preview table, .markdown-preview pre { margin: 0 0 1.15em; }
  .markdown-preview a { color: #1e6e6a; }
  .markdown-preview blockquote {
    padding: 0.1em 0 0.1em 1.1em; border-left: 2px solid rgba(30,110,106,0.32);
    color: #524a3c; font-style: italic;
  }
  .markdown-preview code {
    padding: 0.08em 0.38em; border: 1px solid #e6dfd0; border-radius: 5px;
    background: #f3efe5; font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.84em;
  }
  .markdown-preview pre {
    overflow: auto; padding: 15px 18px; border: 1px solid #e6dfd0; border-radius: 10px; background: #f3efe5;
  }
  .markdown-preview pre code { padding: 0; border: 0; background: transparent; }
  .markdown-preview table { width: 100%; border-collapse: collapse; font-family: system-ui, sans-serif; font-size: 0.92rem; }
  .markdown-preview th, .markdown-preview td { padding: 9px 14px; border: 1px solid #e6dfd0; text-align: left; }
  .markdown-preview th { background: #f3efe5; }
  .markdown-preview hr { margin: 2.2em auto; border: 0; height: 1px; background: #d8cfbc; }
  .markdown-preview img { max-width: 100%; }
`;

export function buildStandaloneHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${exportStyles}</style>
</head>
<body>
<article class="markdown-preview">
${bodyHtml}
</article>
</body>
</html>
`;
}
