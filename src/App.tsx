import DOMPurify from "dompurify";
import {
  Bold,
  Code,
  Columns2,
  Copy,
  Download,
  Eye,
  FilePlus,
  FolderOpen,
  Heading1,
  Heading2,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  PanelLeft,
  Quote,
  Redo2,
  Rows3,
  Save,
  SeparatorHorizontal,
  Undo2,
} from "lucide-react";
import { marked } from "marked";
import { listen } from "@tauri-apps/api/event";
import { ChangeEvent, KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  applyInlineWrap,
  applyLinePrefix,
  applySlashCommand,
  filterSlashCommands,
  getLineColumn,
  getSlashQuery,
  indentLines,
  insertSnippet,
  outdentLines,
  slashCommands,
  TextSelection,
} from "./editorCommands";
import {
  canUseNativeFileSystem,
  ensureMarkdownExtension,
  openedFilesEvent,
  openNativeMarkdownDocument,
  openNativeMarkdownPath,
  saveNativeMarkdownDocument,
  takePendingNativeOpenedFilePaths,
  titleFromFileName,
} from "./fileService";
import { sampleDocument } from "./sampleDocument";
import {
  addDocument,
  createEmptyDocument,
  createSession,
  documentFromFile,
  getActive,
  isDocumentDirty,
  openDocumentInSession,
  pushDocumentHistory,
  redoDocument,
  replaceActive,
  setActive,
  closeDocument,
  undoDocument,
  type EditorSession,
} from "./documentSession";

type ViewMode = "edit" | "split" | "preview";
type SaveTone = "neutral" | "success" | "error";
type MenuPosition = {
  top: number;
  left: number;
};

type ToolAction =
  | "bold"
  | "italic"
  | "heading1"
  | "heading2"
  | "quote"
  | "unordered"
  | "ordered"
  | "task"
  | "code"
  | "link"
  | "image"
  | "table"
  | "divider";

const toolbarGroups: Array<
  Array<{
    action: ToolAction;
    label: string;
    icon: typeof Bold;
  }>
> = [
  [
    { action: "bold", label: "Bold", icon: Bold },
    { action: "italic", label: "Italic", icon: Italic },
    { action: "heading1", label: "Heading 1", icon: Heading1 },
    { action: "heading2", label: "Heading 2", icon: Heading2 },
  ],
  [
    { action: "unordered", label: "Bulleted list", icon: List },
    { action: "ordered", label: "Numbered list", icon: ListOrdered },
    { action: "task", label: "Task list", icon: ListChecks },
    { action: "quote", label: "Quote", icon: Quote },
  ],
  [
    { action: "code", label: "Code block", icon: Code },
    { action: "link", label: "Link", icon: Link },
    { action: "image", label: "Image", icon: Image },
    { action: "table", label: "Table", icon: Rows3 },
    { action: "divider", label: "Divider", icon: SeparatorHorizontal },
  ],
];

const appName = "HillDown";
const browserFileName = "hilldown.md";
const untitledTitle = "Untitled document";
const slashMenuMargin = 12;
const slashMenuGap = 8;
const slashMenuListboxId = "hilldown-slash-menu";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getTextareaCaretPoint(textarea: HTMLTextAreaElement, position: number) {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const mirroredProperties = [
    "box-sizing",
    "width",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "letter-spacing",
    "line-height",
    "text-align",
    "text-indent",
    "text-transform",
    "tab-size",
  ];

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.left = "-9999px";
  mirror.style.top = "0";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflowWrap = "break-word";
  mirror.style.overflow = "hidden";

  mirroredProperties.forEach((property) => {
    mirror.style.setProperty(property, computed.getPropertyValue(property));
  });

  mirror.textContent = textarea.value.slice(0, position);
  marker.textContent = "\u200b";
  mirror.append(marker);
  document.body.append(mirror);

  const point = {
    left: marker.offsetLeft - textarea.scrollLeft,
    top: marker.offsetTop - textarea.scrollTop,
    height: parseFloat(computed.lineHeight) || 20,
  };

  mirror.remove();
  return point;
}

marked.use({
  gfm: true,
  breaks: false,
});

export function App() {
  const [session, setSession] = useState<EditorSession>(() =>
    createSession(documentFromFile(crypto.randomUUID(), sampleDocument, untitledTitle, null)),
  );
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());

  const activeDoc = getActive(session);
  const markdown = activeDoc.markdown;
  const title = activeDoc.title;
  const documentPath = activeDoc.path;
  const history = activeDoc.history;
  const historyIndex = activeDoc.historyIndex;
  const selection = activeDoc.selection;

  const [mode, setMode] = useState<ViewMode>("split");
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashMenuPosition, setSlashMenuPosition] = useState<MenuPosition>({ top: 22, left: 24 });
  const [status, setStatus] = useState<{ message: string; tone: SaveTone }>({
    message: "Ready",
    tone: "neutral",
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorPaneRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const nativeFiles = canUseNativeFileSystem();
  const isDirty = isDocumentDirty(activeDoc);

  const renderedHtml = useMemo(() => {
    const raw = marked.parse(markdown) as string;
    return DOMPurify.sanitize(raw);
  }, [markdown]);

  const wordCount = useMemo(() => {
    const words = markdown.trim().match(/\S+/g);
    return words?.length ?? 0;
  }, [markdown]);

  const lineColumn = useMemo(() => getLineColumn(markdown, selection.end), [markdown, selection.end]);

  const slashQuery = useMemo(() => {
    if (selection.start !== selection.end) {
      return null;
    }

    return getSlashQuery(markdown, selection.start);
  }, [markdown, selection]);

  const visibleSlashCommands = useMemo(
    () => filterSlashCommands(slashQuery?.query ?? ""),
    [slashQuery],
  );

  useEffect(() => {
    setSlashIndex(0);
    if (slashMenuRef.current) {
      slashMenuRef.current.scrollTop = 0;
    }
  }, [slashQuery?.query]);

  useLayoutEffect(() => {
    updateSlashMenuPosition();
  }, [slashQuery?.start, slashQuery?.end, markdown, visibleSlashCommands.length, mode]);

  useEffect(() => {
    const menu = slashMenuRef.current;
    const item = slashItemRefs.current[slashIndex];

    if (!menu || !item) {
      return;
    }

    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    const menuTop = menu.scrollTop;
    const menuBottom = menuTop + menu.clientHeight;

    if (itemTop < menuTop) {
      menu.scrollTop = itemTop - 6;
    } else if (itemBottom > menuBottom) {
      menu.scrollTop = itemBottom - menu.clientHeight + 6;
    }
  }, [slashIndex, visibleSlashCommands.length]);

  useEffect(() => {
    document.title = `${isDirty ? "* " : ""}${title} - ${appName}`;
  }, [isDirty, title]);

  function getSelection(): TextSelection {
    const textarea = textareaRef.current;
    return {
      start: textarea?.selectionStart ?? selection.start,
      end: textarea?.selectionEnd ?? selection.end,
    };
  }

  function updateActiveSelection(next: TextSelection) {
    setSession((current) => replaceActive(current, (doc) => ({ ...doc, selection: next })));
  }

  function syncSelection(target = textareaRef.current) {
    if (!target) {
      return;
    }

    updateActiveSelection({ start: target.selectionStart, end: target.selectionEnd });
  }

  function updateSlashMenuPosition() {
    const textarea = textareaRef.current;
    const editorPane = editorPaneRef.current;

    if (!textarea || !editorPane || !slashQuery) {
      return;
    }

    const caret = getTextareaCaretPoint(textarea, slashQuery.end);
    const editorRect = editorPane.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();
    const menu = slashMenuRef.current;
    const menuWidth = menu?.offsetWidth ?? Math.min(320, Math.max(0, editorPane.clientWidth - 48));
    const menuHeight = menu?.offsetHeight ?? 280;
    const maxLeft = Math.max(slashMenuMargin, editorPane.clientWidth - menuWidth - slashMenuMargin);
    const belowTop = textareaRect.top - editorRect.top + caret.top + caret.height + slashMenuGap;
    const aboveTop = textareaRect.top - editorRect.top + caret.top - menuHeight - slashMenuGap;
    const fitsBelow = belowTop + menuHeight <= editorPane.clientHeight - slashMenuMargin;
    const nextPosition = {
      left: clamp(textareaRect.left - editorRect.left + caret.left, slashMenuMargin, maxLeft),
      top: fitsBelow ? belowTop : Math.max(slashMenuMargin, aboveTop),
    };

    setSlashMenuPosition((current) => {
      if (Math.abs(current.left - nextPosition.left) < 1 && Math.abs(current.top - nextPosition.top) < 1) {
        return current;
      }

      return nextPosition;
    });
  }

  function focusSelection(selectionStart: number, selectionEnd = selectionStart) {
    updateActiveSelection({ start: selectionStart, end: selectionEnd });
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function commit(next: string, selectionStart?: number, selectionEnd = selectionStart) {
    setSession((current) => replaceActive(current, (doc) => pushDocumentHistory(doc, next)));
    if (selectionStart !== undefined) {
      focusSelection(selectionStart, selectionEnd);
    }
  }

  function renameActive(nextTitle: string) {
    setSession((current) => replaceActive(current, (doc) => ({ ...doc, title: nextTitle })));
  }

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const remembered = scrollPositionsRef.current.get(session.activeId) ?? 0;
    textarea.scrollTop = remembered;
    textarea.scrollLeft = 0;
    textarea.setSelectionRange(activeDoc.selection.start, activeDoc.selection.end);
    textarea.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.activeId]);

  function onEditorScroll() {
    updateSlashMenuPosition();
    const textarea = textareaRef.current;
    if (textarea) {
      scrollPositionsRef.current.set(session.activeId, textarea.scrollTop);
    }
  }

  function loadDocument(contents: string, name: string, path: string | null) {
    setSession((current) =>
      openDocumentInSession(
        current,
        documentFromFile(crypto.randomUUID(), contents, titleFromFileName(name), path),
      ),
    );
    setStatus({ message: `Opened ${name}`, tone: "success" });
  }

  async function openNativePath(path: string) {
    try {
      const opened = await openNativeMarkdownPath(path);
      if (!opened) {
        return;
      }

      loadDocument(opened.contents, opened.name, opened.path);
    } catch (error) {
      setStatus({
        message: `Open failed: ${error instanceof Error ? error.message : String(error)}`,
        tone: "error",
      });
    }
  }

  async function flushPendingOpenedFiles() {
    try {
      const [path] = await takePendingNativeOpenedFilePaths();
      if (path) {
        await openNativePath(path);
      }
    } catch (error) {
      setStatus({
        message: `Open failed: ${error instanceof Error ? error.message : String(error)}`,
        tone: "error",
      });
    }
  }

  useEffect(() => {
    if (!nativeFiles) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<string[]>(openedFilesEvent, () => {
      void flushPendingOpenedFiles();
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }

        unlisten = cleanup;
        void flushPendingOpenedFiles();
      })
      .catch((error) => {
        setStatus({
          message: `Open listener failed: ${error instanceof Error ? error.message : String(error)}`,
          tone: "error",
        });
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [nativeFiles]);

  function resetDocument() {
    setSession((current) => addDocument(current, createEmptyDocument(crypto.randomUUID())));
    setStatus({ message: "New document", tone: "neutral" });
  }

  function runTool(action: ToolAction) {
    const activeSelection = getSelection();
    const apply = {
      bold: () => applyInlineWrap(markdown, activeSelection, "**", "**", "bold text"),
      italic: () => applyInlineWrap(markdown, activeSelection, "_", "_", "italic text"),
      heading1: () => applyLinePrefix(markdown, activeSelection, "# "),
      heading2: () => applyLinePrefix(markdown, activeSelection, "## "),
      quote: () => applyLinePrefix(markdown, activeSelection, "> "),
      unordered: () => applyLinePrefix(markdown, activeSelection, "- "),
      ordered: () => applyLinePrefix(markdown, activeSelection, "1. "),
      task: () => applyLinePrefix(markdown, activeSelection, "- [ ] "),
      code: () => insertSnippet(markdown, activeSelection, "```ts\ncode\n```", 6),
      link: () => applyInlineWrap(markdown, activeSelection, "[", "](https://example.com)", "link text"),
      image: () => insertSnippet(markdown, activeSelection, "![alt text](image-url)", 2),
      table: () => insertSnippet(markdown, activeSelection, "| Column A | Column B |\n| --- | --- |\n| Value | Value |", 2),
      divider: () => insertSnippet(markdown, activeSelection, "---"),
    } satisfies Record<ToolAction, () => ReturnType<typeof applyInlineWrap>>;

    const result = apply[action]();
    commit(result.value, result.selectionStart, result.selectionEnd);
  }

  function undo() {
    setSession((current) => replaceActive(current, undoDocument));
  }

  function redo() {
    setSession((current) => replaceActive(current, redoDocument));
  }

  function onTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    const nextSelection = { start: event.target.selectionStart, end: event.target.selectionEnd };
    setSession((current) =>
      replaceActive(current, (doc) => ({ ...pushDocumentHistory(doc, next), selection: nextSelection })),
    );
  }

  function chooseSlashCommand(index: number) {
    const command = visibleSlashCommands[index];
    if (!command) {
      return;
    }
    const result = applySlashCommand(markdown, getSelection(), command);
    commit(result.value, result.selectionStart, result.selectionEnd);
  }

  async function openDocument() {
    if (!nativeFiles) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const opened = await openNativeMarkdownDocument();
      if (!opened) {
        setStatus({ message: "Open canceled", tone: "neutral" });
        return;
      }

      loadDocument(opened.contents, opened.name, opened.path);
    } catch (error) {
      setStatus({
        message: `Open failed: ${error instanceof Error ? error.message : String(error)}`,
        tone: "error",
      });
    }
  }

  async function saveDocument(forceSaveAs = false) {
    if (!nativeFiles) {
      downloadMarkdown();
      setSession((current) => replaceActive(current, (doc) => ({ ...doc, lastSavedMarkdown: doc.markdown })));
      setStatus({ message: "Downloaded Markdown", tone: "success" });
      return;
    }

    try {
      const saved = await saveNativeMarkdownDocument(
        markdown,
        documentPath,
        ensureMarkdownExtension(title),
        forceSaveAs,
      );

      if (!saved) {
        setStatus({ message: "Save canceled", tone: "neutral" });
        return;
      }

      setSession((current) =>
        replaceActive(current, (doc) => ({
          ...doc,
          path: saved.path,
          title: titleFromFileName(saved.name),
          lastSavedMarkdown: doc.markdown,
        })),
      );
      setStatus({ message: `Saved ${saved.name}`, tone: "success" });
    } catch (error) {
      setStatus({
        message: `Save failed: ${error instanceof Error ? error.message : String(error)}`,
        tone: "error",
      });
    }
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isMod = event.metaKey || event.ctrlKey;

    if (isMod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveDocument(event.shiftKey);
      return;
    }

    if (isMod && event.key.toLowerCase() === "o") {
      event.preventDefault();
      void openDocument();
      return;
    }

    if (isMod && event.key.toLowerCase() === "n") {
      event.preventDefault();
      resetDocument();
      return;
    }

    if (isMod && event.key.toLowerCase() === "b") {
      event.preventDefault();
      runTool("bold");
      return;
    }

    if (isMod && event.key.toLowerCase() === "i") {
      event.preventDefault();
      runTool("italic");
      return;
    }

    if (isMod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      runTool("link");
      return;
    }

    if (slashQuery && visibleSlashCommands.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashIndex((current) => (current + 1) % visibleSlashCommands.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashIndex((current) => (current - 1 + visibleSlashCommands.length) % visibleSlashCommands.length);
        return;
      }

      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        chooseSlashCommand(slashIndex);
        return;
      }
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const result = event.shiftKey
        ? outdentLines(markdown, getSelection())
        : indentLines(markdown, getSelection());
      commit(result.value, result.selectionStart, result.selectionEnd);
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = ensureMarkdownExtension(title === untitledTitle ? browserFileName : title);
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyMarkdown() {
    await navigator.clipboard.writeText(markdown);
    setStatus({ message: "Copied Markdown", tone: "success" });
  }

  async function copyHtml() {
    await navigator.clipboard.writeText(renderedHtml);
    setStatus({ message: "Copied HTML", tone: "success" });
  }

  function importMarkdown(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    file.text().then((contents) => {
      loadDocument(contents, file.name, null);
    });

    event.target.value = "";
  }

  const editorVisible = mode === "edit" || mode === "split";
  const previewVisible = mode === "preview" || mode === "split";
  const pathLabel = documentPath ?? (nativeFiles ? "No file selected" : "Browser fallback mode");
  const slashMenuOpen = slashQuery !== null && visibleSlashCommands.length > 0;
  const activeSlashOptionId =
    slashMenuOpen && visibleSlashCommands[slashIndex]
      ? `${slashMenuListboxId}-${visibleSlashCommands[slashIndex].id}`
      : undefined;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="document-title">
          <div className="brand-mark" aria-hidden="true">H</div>
          <div>
            <p className="app-name">{appName}</p>
            <input
              aria-label="Document title"
              value={title}
              onChange={(event) => renameActive(event.target.value)}
            />
            <p className="document-path" title={pathLabel}>
              <span className={`save-state ${isDirty ? "dirty" : "clean"}`}>
                {isDirty ? "Unsaved" : "Saved"}
              </span>
              <span>{pathLabel}</span>
            </p>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="segmented" aria-label="View mode">
            <button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")} title="Edit" aria-label="Edit view" aria-pressed={mode === "edit"}>
              <PanelLeft size={17} />
            </button>
            <button className={mode === "split" ? "active" : ""} onClick={() => setMode("split")} title="Split" aria-label="Split view" aria-pressed={mode === "split"}>
              <Columns2 size={17} />
            </button>
            <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")} title="Preview" aria-label="Preview" aria-pressed={mode === "preview"}>
              <Eye size={17} />
            </button>
          </div>
          <button className="text-button" onClick={resetDocument}>
            <FilePlus size={16} />
            New
          </button>
          <button className="text-button" onClick={() => void openDocument()}>
            <FolderOpen size={16} />
            Open
          </button>
          <button className="text-button primary" onClick={() => void saveDocument(false)}>
            <Save size={16} />
            Save
          </button>
          <button className="text-button" onClick={() => void saveDocument(true)}>
            <Download size={16} />
            Save As
          </button>
          <input ref={fileInputRef} type="file" accept=".md,.markdown,.mdown,.txt" hidden onChange={importMarkdown} />
        </div>
      </header>

      <section className="toolbar" role="toolbar" aria-label="Formatting toolbar">
        <div className="history-controls">
          <button className="icon-button" onClick={undo} disabled={historyIndex === 0} title="Undo" aria-label="Undo">
            <Undo2 size={17} />
          </button>
          <button className="icon-button" onClick={redo} disabled={historyIndex === history.length - 1} title="Redo" aria-label="Redo">
            <Redo2 size={17} />
          </button>
        </div>
        {toolbarGroups.map((group, groupIndex) => (
          <div className="toolbar-group" key={groupIndex}>
            {group.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className="icon-button"
                  key={item.action}
                  onClick={() => runTool(item.action)}
                  title={item.label}
                  aria-label={item.label}
                >
                  <Icon size={17} />
                </button>
              );
            })}
          </div>
        ))}
      </section>

      <main className={`workspace ${mode}`}>
        {editorVisible && (
          <section ref={editorPaneRef} className="editor-pane" aria-label="Markdown editor">
            <div className="pane-header">
              <span>Source</span>
              <span>Ln {lineColumn.line}, Col {lineColumn.column}</span>
            </div>
            <textarea
              ref={textareaRef}
              spellCheck="true"
              autoCorrect="off"
              autoCapitalize="off"
              value={markdown}
              onChange={onTextChange}
              onClick={(event) => syncSelection(event.currentTarget)}
              onKeyDown={onEditorKeyDown}
              onKeyUp={(event) => syncSelection(event.currentTarget)}
              onScroll={onEditorScroll}
              onSelect={(event) => syncSelection(event.currentTarget)}
              aria-label="Markdown source"
              aria-controls={slashMenuOpen ? slashMenuListboxId : undefined}
              aria-activedescendant={activeSlashOptionId}
            />
            {slashQuery && visibleSlashCommands.length > 0 && (
              <div
                ref={slashMenuRef}
                id={slashMenuListboxId}
                className="slash-menu"
                style={{
                  left: slashMenuPosition.left,
                  top: slashMenuPosition.top,
                }}
                role="listbox"
                aria-label="Slash commands"
              >
                {visibleSlashCommands.map((command, index) => (
                  <button
                    className={index === slashIndex ? "active" : ""}
                    key={command.id}
                    id={`${slashMenuListboxId}-${command.id}`}
                    ref={(element) => {
                      slashItemRefs.current[index] = element;
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseSlashCommand(index)}
                    role="option"
                    aria-selected={index === slashIndex}
                  >
                    <strong>{command.label}</strong>
                    <span>{command.description}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {previewVisible && (
          <section className="preview-pane" aria-label="Markdown preview">
            <div className="pane-header">
              <span>Preview</span>
              <span>{wordCount} words</span>
            </div>
            <div className="preview-scroll" tabIndex={0} aria-label="Markdown preview">
              <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
            </div>
          </section>
        )}
      </main>

      <footer className="statusbar">
        <span>{wordCount} words</span>
        <span>{markdown.length} characters</span>
        <span>
          Ln {lineColumn.line}, Col {lineColumn.column}
        </span>
        <span>{slashCommands.length} slash commands</span>
        <span className={`status-message ${status.tone}`} role="status" aria-live="polite" aria-atomic="true">{status.message}</span>
        <div className="status-actions">
          <button onClick={copyMarkdown}>
            <Copy size={15} />
            Markdown
          </button>
          <button onClick={copyHtml}>
            <Save size={15} />
            HTML
          </button>
        </div>
      </footer>
    </div>
  );
}
