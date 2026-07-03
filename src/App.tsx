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
  Plus,
  Quote,
  Redo2,
  Rows3,
  Save,
  SeparatorHorizontal,
  Undo2,
  X,
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
import { buildStandaloneHtml } from "./htmlExport";
import {
  canUseNativeFileSystem,
  ensureHtmlExtension,
  ensureMarkdownExtension,
  exportHtmlDocument,
  menuEvent,
  openedFilesEvent,
  openNativeMarkdownDocument,
  openNativeMarkdownPath,
  printNativeDocument,
  saveNativeMarkdownDocument,
  syncTabMenu,
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
  replaceDocumentById,
  setActive,
  closeDocument,
  undoDocument,
  type EditorDocument,
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
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorPaneRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const saveCloseButtonRef = useRef<HTMLButtonElement>(null);
  const menuHandlerRef = useRef(handleMenuAction);
  menuHandlerRef.current = handleMenuAction;

  const nativeFiles = canUseNativeFileSystem();
  const isDirty = isDocumentDirty(activeDoc);
  const pendingCloseDoc = pendingCloseId
    ? session.documents.find((doc) => doc.id === pendingCloseId) ?? null
    : null;

  const renderedHtml = useMemo(() => {
    const raw = marked.parse(markdown) as string;
    return DOMPurify.sanitize(raw);
  }, [markdown]);

  const wordCount = useMemo(() => {
    const words = markdown.trim().match(/\S+/g);
    return words?.length ?? 0;
  }, [markdown]);

  const lineColumn = useMemo(() => getLineColumn(markdown, selection.end), [markdown, selection.end]);

  const tabTitles = useMemo(
    () => session.documents.map((doc) => doc.title || "Untitled document"),
    [session.documents],
  );
  const tabMenuKey = tabTitles.join("\n");

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

  useEffect(() => {
    if (pendingCloseId) {
      saveCloseButtonRef.current?.focus();
    }
  }, [pendingCloseId]);

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
    textarea.setSelectionRange(activeDoc.selection.start, activeDoc.selection.end);
    textarea.focus();
    const remembered = scrollPositionsRef.current.get(session.activeId) ?? 0;
    textarea.scrollTop = remembered;
    textarea.scrollLeft = 0;
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
      const paths = await takePendingNativeOpenedFilePaths();
      for (const path of paths) {
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

  useEffect(() => {
    if (!nativeFiles) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<string>(menuEvent, (event) => {
      menuHandlerRef.current(event.payload);
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch(() => {
        /* menu is a native nicety; ignore listen failures */
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [nativeFiles]);

  useEffect(() => {
    if (!nativeFiles) {
      return;
    }
    const timer = window.setTimeout(() => {
      void syncTabMenu(tabTitles).catch(() => {
        /* the native menu is a nicety; ignore sync failures */
      });
    }, 150);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeFiles, tabMenuKey]);

  function resetDocument() {
    setSession((current) => addDocument(current, createEmptyDocument(crypto.randomUUID())));
    setStatus({ message: "New document", tone: "neutral" });
  }

  function selectTab(id: string) {
    setSession((current) => setActive(current, id));
  }

  function requestCloseTab(id: string) {
    const target = session.documents.find((doc) => doc.id === id);
    if (target && isDocumentDirty(target)) {
      setSession((current) => setActive(current, id));
      setPendingCloseId(id);
      return;
    }
    performCloseTab(id);
  }

  function performCloseTab(id: string) {
    scrollPositionsRef.current.delete(id);
    setSession((current) => closeDocument(current, id, () => createEmptyDocument(crypto.randomUUID())));
  }

  function cancelPendingClose() {
    setPendingCloseId(null);
  }

  function discardPendingClose() {
    if (pendingCloseId) {
      performCloseTab(pendingCloseId);
    }
    setPendingCloseId(null);
  }

  async function savePendingClose() {
    const id = pendingCloseId;
    if (!id) {
      return;
    }
    const saved = await saveDocument(false, id);
    if (saved) {
      performCloseTab(id);
    }
    setPendingCloseId(null);
  }

  function goToTab(index: number) {
    const target = session.documents[index];
    if (target) {
      selectTab(target.id);
    }
  }

  function shiftTab(delta: number) {
    const index = session.documents.findIndex((doc) => doc.id === session.activeId);
    const count = session.documents.length;
    const next = session.documents[(index + delta + count) % count];
    if (next) {
      selectTab(next.id);
    }
  }

  function nextTab() {
    shiftTab(1);
  }

  function previousTab() {
    shiftTab(-1);
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

  async function saveDocument(forceSaveAs = false, targetId: string = session.activeId): Promise<boolean> {
    const target = session.documents.find((doc) => doc.id === targetId);
    if (!target) {
      return false;
    }

    if (!nativeFiles) {
      downloadMarkdownFor(target);
      setSession((current) => replaceDocumentById(current, targetId, (doc) => ({ ...doc, lastSavedMarkdown: doc.markdown })));
      setStatus({ message: "Downloaded Markdown", tone: "success" });
      return true;
    }

    try {
      const saved = await saveNativeMarkdownDocument(
        target.markdown,
        target.path,
        ensureMarkdownExtension(target.title),
        forceSaveAs,
      );

      if (!saved) {
        setStatus({ message: "Save canceled", tone: "neutral" });
        return false;
      }

      setSession((current) =>
        replaceDocumentById(current, targetId, (doc) => ({
          ...doc,
          path: saved.path,
          title: titleFromFileName(saved.name),
          lastSavedMarkdown: doc.markdown,
        })),
      );
      setStatus({ message: `Saved ${saved.name}`, tone: "success" });
      return true;
    } catch (error) {
      setStatus({
        message: `Save failed: ${error instanceof Error ? error.message : String(error)}`,
        tone: "error",
      });
      return false;
    }
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (pendingCloseId) {
      event.preventDefault();
      return;
    }

    const isMod = event.metaKey || event.ctrlKey;

    if (!nativeFiles && isMod) {
      const key = event.key.toLowerCase();

      if (key === "s") {
        event.preventDefault();
        void saveDocument(event.shiftKey);
        return;
      }

      if (key === "o") {
        event.preventDefault();
        void openDocument();
        return;
      }

      if (key === "n") {
        event.preventDefault();
        resetDocument();
        return;
      }

      if (key === "b") {
        event.preventDefault();
        runTool("bold");
        return;
      }

      if (key === "i") {
        event.preventDefault();
        runTool("italic");
        return;
      }

      if (key === "k") {
        event.preventDefault();
        runTool("link");
        return;
      }
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

  function downloadMarkdownFor(doc: EditorDocument) {
    const blob = new Blob([doc.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = ensureMarkdownExtension(doc.title === untitledTitle ? browserFileName : doc.title);
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportHtml() {
    const html = buildStandaloneHtml(title, renderedHtml);
    const suggested = ensureHtmlExtension(title === untitledTitle ? "hilldown" : title);

    if (!nativeFiles) {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = suggested;
      link.click();
      URL.revokeObjectURL(url);
      setStatus({ message: "Exported HTML", tone: "success" });
      return;
    }

    try {
      const saved = await exportHtmlDocument(html, suggested);
      if (!saved) {
        setStatus({ message: "Export canceled", tone: "neutral" });
        return;
      }
      setStatus({ message: `Exported ${saved.name}`, tone: "success" });
    } catch (error) {
      setStatus({
        message: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        tone: "error",
      });
    }
  }

  async function printDocument() {
    const previousTitle = document.title;
    document.title = title === untitledTitle ? appName : title;
    try {
      if (nativeFiles) {
        await printNativeDocument();
      } else {
        window.print();
      }
    } catch (error) {
      setStatus({
        message: `Print failed: ${error instanceof Error ? error.message : String(error)}`,
        tone: "error",
      });
    } finally {
      document.title = previousTitle;
    }
  }

  async function copyMarkdown() {
    await navigator.clipboard.writeText(markdown);
    setStatus({ message: "Copied Markdown", tone: "success" });
  }

  async function copyHtml() {
    await navigator.clipboard.writeText(renderedHtml);
    setStatus({ message: "Copied HTML", tone: "success" });
  }

  function handleMenuAction(id: string) {
    if (pendingCloseId) {
      return; // the unsaved-changes dialog is modal; ignore menu commands until it's resolved
    }
    switch (id) {
      case "new": return resetDocument();
      case "open": return void openDocument();
      case "save": return void saveDocument(false);
      case "saveAs": return void saveDocument(true);
      case "closeTab": return requestCloseTab(session.activeId);
      case "exportHtml": return void exportHtml();
      case "exportPdf":
      case "print": return void printDocument();
      case "undo": return undo();
      case "redo": return redo();
      case "copyMarkdown": return void copyMarkdown();
      case "copyHtml": return void copyHtml();
      case "viewEdit": return setMode("edit");
      case "viewSplit": return setMode("split");
      case "viewPreview": return setMode("preview");
      case "nextTab": return nextTab();
      case "prevTab": return previousTab();
      case "bold":
      case "italic":
      case "heading1":
      case "heading2":
      case "quote":
      case "unordered":
      case "ordered":
      case "task":
      case "code":
      case "link":
      case "table":
      case "divider":
        return runTool(id as ToolAction);
      default:
        if (id.startsWith("goToTab")) {
          const index = Number(id.slice("goToTab".length)) - 1;
          if (Number.isInteger(index)) {
            goToTab(index);
          }
        }
    }
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
      <header
        className="topbar"
        aria-hidden={pendingCloseDoc ? true : undefined}
        inert={pendingCloseDoc ? true : undefined}
      >
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

      <nav
        className="tab-strip"
        role="tablist"
        aria-label="Open documents"
        aria-hidden={pendingCloseDoc ? true : undefined}
        inert={pendingCloseDoc ? true : undefined}
      >
        {session.documents.map((doc) => {
          const dirty = isDocumentDirty(doc);
          const active = doc.id === session.activeId;
          return (
            <div
              key={doc.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`tab ${active ? "active" : ""}`}
              title={doc.path ?? doc.title}
              onClick={() => selectTab(doc.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectTab(doc.id);
                }
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  requestCloseTab(doc.id);
                }
              }}
            >
              <span className="tab-title">{doc.title || "Untitled document"}</span>
              {dirty && <span className="tab-dirty" aria-label="Unsaved changes">●</span>}
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${doc.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  requestCloseTab(doc.id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        <button type="button" className="tab-new" aria-label="New tab" title="New tab" onClick={resetDocument}>
          <Plus size={15} />
        </button>
      </nav>

      <section
        className="toolbar"
        role="toolbar"
        aria-label="Formatting toolbar"
        aria-hidden={pendingCloseDoc ? true : undefined}
        inert={pendingCloseDoc ? true : undefined}
      >
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

      <footer
        className="statusbar"
        aria-hidden={pendingCloseDoc ? true : undefined}
        inert={pendingCloseDoc ? true : undefined}
      >
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

      {pendingCloseDoc && (
        <div className="modal-overlay" role="presentation" onClick={cancelPendingClose}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="unsaved-changes-title"
            aria-describedby="unsaved-changes-desc"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelPendingClose();
              }
            }}
          >
            <h2 id="unsaved-changes-title">Unsaved changes</h2>
            <p id="unsaved-changes-desc">
              Do you want to save the changes you made to “{pendingCloseDoc.title}”? Your changes will be
              lost if you don’t save them.
            </p>
            <div className="modal-actions">
              <button type="button" className="text-button" onClick={cancelPendingClose}>
                Cancel
              </button>
              <button type="button" className="text-button danger" onClick={discardPendingClose}>
                Don't Save
              </button>
              <button
                type="button"
                className="text-button primary"
                ref={saveCloseButtonRef}
                onClick={() => void savePendingClose()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <article
        className="markdown-preview print-only"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    </div>
  );
}
