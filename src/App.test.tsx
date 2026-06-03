import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const fileMocks = vi.hoisted(() => ({
  canUseNativeFileSystem: vi.fn(() => false),
  ensureMarkdownExtension: vi.fn((name: string) => {
    const trimmed = name.trim() || "Untitled";
    return /\.(md|markdown|mdown|txt)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
  }),
  openedFilesEvent: "hilldown://open-files",
  openNativeMarkdownDocument: vi.fn(),
  openNativeMarkdownPath: vi.fn(),
  saveNativeMarkdownDocument: vi.fn(),
  takePendingNativeOpenedFilePaths: vi.fn(),
  titleFromFileName: vi.fn((name: string) => {
    const base = name.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "Untitled document";
    return base.replace(/\.(md|markdown|mdown|txt)$/i, "") || "Untitled document";
  }),
}));

vi.mock("./fileService", () => fileMocks);

const eventMocks = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => eventMocks);

let lastDownloadName = "";
let openedFilesHandler: ((event: { payload: string[] }) => void) | undefined;

function sourceEditor() {
  return screen.getByRole("textbox", { name: /markdown source/i }) as HTMLTextAreaElement;
}

function selectText(editor: HTMLTextAreaElement, start: number, end = start) {
  editor.setSelectionRange(start, end);
  fireEvent.select(editor);
}

function replaceEditorValue(value: string, selectionStart = value.length, selectionEnd = selectionStart) {
  const editor = sourceEditor();
  fireEvent.change(editor, { target: { value } });
  selectText(editor, selectionStart, selectionEnd);
  return editor;
}

beforeEach(() => {
  vi.clearAllMocks();
  lastDownloadName = "";
  fileMocks.canUseNativeFileSystem.mockReturnValue(false);
  fileMocks.openNativeMarkdownDocument.mockResolvedValue(null);
  fileMocks.openNativeMarkdownPath.mockResolvedValue(null);
  fileMocks.saveNativeMarkdownDocument.mockResolvedValue(null);
  fileMocks.takePendingNativeOpenedFilePaths.mockResolvedValue([]);
  openedFilesHandler = undefined;
  eventMocks.listen.mockImplementation((_event: string, handler: (event: { payload: string[] }) => void) => {
    openedFilesHandler = handler;
    return Promise.resolve(vi.fn());
  });

  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });

  vi.stubGlobal("confirm", vi.fn(() => true));
  window.URL.createObjectURL = vi.fn(() => "blob:hilldown");
  window.URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn(function (this: HTMLAnchorElement) {
    lastDownloadName = this.download;
  });
  HTMLInputElement.prototype.click = vi.fn();
});

describe("App", () => {
  it("renders the editor, preview, and initial document metadata", () => {
    render(<App />);

    expect(screen.getAllByText("HillDown")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: /document title/i })).toHaveValue("Untitled document");
    expect(sourceEditor().value).toContain("# HillDown");
    expect(screen.getByRole("region", { name: /markdown preview/i })).toBeInTheDocument();
    expect(screen.getByText("Browser fallback mode")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("switches between split, edit, and preview modes", () => {
    render(<App />);

    fireEvent.click(screen.getByTitle("Preview"));
    expect(screen.queryByRole("textbox", { name: /markdown source/i })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: /markdown preview/i })).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Edit"));
    expect(sourceEditor()).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /markdown preview/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Split"));
    expect(sourceEditor()).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /markdown preview/i })).toBeInTheDocument();
  });

  it("applies toolbar formatting to the current selection", () => {
    render(<App />);
    const editor = sourceEditor();

    selectText(editor, 2, 10);
    fireEvent.click(screen.getByTitle("Bold"));

    expect(editor.value).toContain("# **HillDown**");
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it.each([
    ["Italic", "plain", 0, 5, "_plain_"],
    ["Heading 1", "plain", 0, 5, "# plain"],
    ["Heading 2", "plain", 0, 5, "## plain"],
    ["Quote", "plain", 0, 5, "> plain"],
    ["Bulleted list", "plain", 0, 5, "- plain"],
    ["Numbered list", "plain", 0, 5, "1. plain"],
    ["Task list", "plain", 0, 5, "- [ ] plain"],
    ["Code block", "", 0, 0, "```ts\ncode\n```"],
    ["Link", "plain", 0, 5, "[plain](https://example.com)"],
    ["Image", "", 0, 0, "![alt text](image-url)"],
    ["Table", "", 0, 0, "| Column A | Column B |\n| --- | --- |\n| Value | Value |"],
    ["Divider", "", 0, 0, "---"],
  ])("applies the %s toolbar action", (title, initialValue, start, end, expectedValue) => {
    render(<App />);
    const editor = replaceEditorValue(initialValue, start, end);

    fireEvent.click(screen.getByTitle(title));

    expect(editor).toHaveValue(expectedValue);
  });

  it("supports undo and redo after edits", () => {
    render(<App />);
    const editor = replaceEditorValue("# Changed");

    fireEvent.click(screen.getByTitle("Undo"));
    expect(editor.value).toContain("# HillDown");

    fireEvent.click(screen.getByTitle("Redo"));
    expect(editor).toHaveValue("# Changed");
  });

  it("handles keyboard shortcuts for save and formatting", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.saveNativeMarkdownDocument.mockResolvedValue({
      name: "shortcut.md",
      path: "/tmp/shortcut.md",
    });

    render(<App />);
    const editor = replaceEditorValue("shortcut", 0, 8);

    fireEvent.keyDown(editor, { key: "b", ctrlKey: true });
    expect(editor).toHaveValue("**shortcut**");

    selectText(editor, 2, 10);
    fireEvent.keyDown(editor, { key: "k", ctrlKey: true });
    expect(editor.value).toContain("[shortcut](https://example.com)");

    fireEvent.keyDown(editor, { key: "s", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(fileMocks.saveNativeMarkdownDocument).toHaveBeenCalledWith(
      expect.any(String),
      null,
      "Untitled document.md",
      true,
    ));

    expect(screen.getByText("Saved shortcut.md")).toBeInTheDocument();
  });

  it("handles keyboard shortcuts for opening and italic formatting", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.openNativeMarkdownDocument.mockResolvedValue({
      contents: "# Keyboard open",
      name: "keyboard.md",
      path: "/tmp/keyboard.md",
    });

    render(<App />);
    const editor = replaceEditorValue("italic", 0, 6);

    fireEvent.keyDown(editor, { key: "i", ctrlKey: true });
    expect(editor).toHaveValue("_italic_");

    fireEvent.keyDown(editor, { key: "o", ctrlKey: true });
    await waitFor(() => expect(sourceEditor()).toHaveValue("# Keyboard open"));
    expect(screen.getByText("Opened keyboard.md")).toBeInTheDocument();
  });

  it("creates a new document from the keyboard after dirty confirmation", () => {
    render(<App />);
    const editor = replaceEditorValue("# Dirty shortcut");

    fireEvent.keyDown(editor, { key: "n", ctrlKey: true });

    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved changes and create a new document?");
    expect(editor).toHaveValue("");
  });

  it("indents and outdents with Tab shortcuts", () => {
    render(<App />);
    const editor = replaceEditorValue("one\ntwo", 0, 7);

    fireEvent.keyDown(editor, { key: "Tab" });
    expect(editor).toHaveValue("  one\n  two");

    selectText(editor, 2, 11);
    fireEvent.keyDown(editor, { key: "Tab", shiftKey: true });
    expect(editor).toHaveValue("one\ntwo");
  });

  it("shows slash commands and inserts the chosen command", () => {
    render(<App />);
    const editor = replaceEditorValue("/tab");

    expect(screen.getByRole("listbox", { name: /slash commands/i })).toBeInTheDocument();

    fireEvent.keyDown(editor, { key: "Enter" });

    expect(editor).toHaveValue("| Column A | Column B |\n| --- | --- |\n| Value | Value |");
  });

  it("navigates slash commands with arrow keys", () => {
    render(<App />);
    const editor = replaceEditorValue("/");

    fireEvent.keyDown(editor, { key: "ArrowDown" });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(editor).toHaveValue("## Heading");
  });

  it("scrolls the slash menu to the active keyboard item", async () => {
    render(<App />);
    const editor = replaceEditorValue("/");
    const menu = screen.getByRole("listbox", { name: /slash commands/i });
    const options = screen.getAllByRole("option");

    Object.defineProperty(menu, "clientHeight", { configurable: true, value: 50 });
    Object.defineProperty(options[1], "offsetTop", { configurable: true, value: 100 });
    Object.defineProperty(options[1], "offsetHeight", { configurable: true, value: 30 });

    fireEvent.keyDown(editor, { key: "ArrowDown" });

    await waitFor(() => expect(menu.scrollTop).toBe(86));
  });

  it("keeps focus in the editor when a slash option is pressed", () => {
    render(<App />);
    replaceEditorValue("/");
    const option = screen.getByRole("option", { name: /heading 1/i });
    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(mouseDown, "preventDefault");

    fireEvent(option, mouseDown);

    expect(preventDefault).toHaveBeenCalled();
  });

  it("inserts a slash command when a menu option is clicked", () => {
    render(<App />);
    const editor = replaceEditorValue("/");

    fireEvent.click(screen.getByRole("option", { name: /divider/i }));

    expect(editor).toHaveValue("---");
  });

  it("wraps upward slash-menu navigation and scrolls back to the item", async () => {
    render(<App />);
    const editor = replaceEditorValue("/");
    const menu = screen.getByRole("listbox", { name: /slash commands/i });
    const options = screen.getAllByRole("option");
    const lastOption = options[options.length - 1];

    menu.scrollTop = 100;
    Object.defineProperty(menu, "clientHeight", { configurable: true, value: 50 });
    Object.defineProperty(lastOption, "offsetTop", { configurable: true, value: 10 });
    Object.defineProperty(lastOption, "offsetHeight", { configurable: true, value: 30 });

    fireEvent.keyDown(editor, { key: "ArrowUp" });

    await waitFor(() => expect(menu.scrollTop).toBe(4));
  });

  it("copies Markdown to the clipboard", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /markdown/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("# HillDown"));
    });
    expect(screen.getByText("Copied Markdown")).toBeInTheDocument();
  });

  it("copies rendered HTML to the clipboard", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /html/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("<h1>HillDown</h1>"));
    });
    expect(screen.getByText("Copied HTML")).toBeInTheDocument();
  });

  it("uses the browser file picker when native files are unavailable", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /open/i }));

    expect(HTMLInputElement.prototype.click).toHaveBeenCalled();
  });

  it("ignores an empty browser file import", () => {
    render(<App />);
    const fileInput = document.querySelector("input[type='file']") as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [] } });

    expect(sourceEditor().value).toContain("# HillDown");
    expect(screen.getByRole("textbox", { name: /document title/i })).toHaveValue("Untitled document");
  });

  it("imports a browser-selected Markdown file", async () => {
    render(<App />);
    const fileInput = document.querySelector("input[type='file']") as HTMLInputElement;
    const file = {
      name: "browser-note.md",
      text: vi.fn().mockResolvedValue("# Browser import"),
    };

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(sourceEditor()).toHaveValue("# Browser import"));
    expect(screen.getByRole("textbox", { name: /document title/i })).toHaveValue("browser-note");
    expect(screen.getByText("Opened browser-note.md")).toBeInTheDocument();
  });

  it("updates cursor metadata when the editor is clicked", () => {
    render(<App />);
    const editor = sourceEditor();

    editor.setSelectionRange(11, 11);
    fireEvent.click(editor);

    expect(screen.getAllByText("Ln 2, Col 1").length).toBeGreaterThan(0);
  });

  it("opens a native markdown document", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.openNativeMarkdownDocument.mockResolvedValue({
      contents: "# Imported",
      name: "imported.md",
      path: "/tmp/imported.md",
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /open/i }));

    await waitFor(() => expect(sourceEditor()).toHaveValue("# Imported"));
    expect(screen.getByRole("textbox", { name: /document title/i })).toHaveValue("imported");
    expect(screen.getByText("Opened imported.md")).toBeInTheDocument();
  });

  it("loads a pending native file path on startup", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.takePendingNativeOpenedFilePaths.mockResolvedValue(["/tmp/associated.md"]);
    fileMocks.openNativeMarkdownPath.mockResolvedValue({
      contents: "# Associated",
      name: "associated.md",
      path: "/tmp/associated.md",
    });

    render(<App />);

    await waitFor(() => expect(fileMocks.openNativeMarkdownPath).toHaveBeenCalledWith("/tmp/associated.md"));
    expect(sourceEditor()).toHaveValue("# Associated");
    expect(screen.getByText("Opened associated.md")).toBeInTheDocument();
    expect(eventMocks.listen).toHaveBeenCalledWith("hilldown://open-files", expect.any(Function));
  });

  it("loads a native file path when the backend emits an open-files event", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.takePendingNativeOpenedFilePaths
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["/tmp/event-opened.markdown"]);
    fileMocks.openNativeMarkdownPath.mockResolvedValue({
      contents: "# Event opened",
      name: "event-opened.markdown",
      path: "/tmp/event-opened.markdown",
    });

    render(<App />);
    await waitFor(() => expect(eventMocks.listen).toHaveBeenCalled());

    openedFilesHandler?.({ payload: ["/tmp/event-opened.markdown"] });

    await waitFor(() => expect(sourceEditor()).toHaveValue("# Event opened"));
    expect(screen.getByRole("textbox", { name: /document title/i })).toHaveValue("event-opened");
  });

  it("keeps dirty content when a native opened file is rejected", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.takePendingNativeOpenedFilePaths
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["/tmp/rejected.md"]);
    vi.mocked(window.confirm).mockReturnValue(false);

    render(<App />);
    const editor = replaceEditorValue("# Keep dirty");
    await waitFor(() => expect(eventMocks.listen).toHaveBeenCalled());

    openedFilesHandler?.({ payload: ["/tmp/rejected.md"] });

    await waitFor(() => expect(fileMocks.takePendingNativeOpenedFilePaths).toHaveBeenCalledTimes(2));
    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved changes and open another document?");
    expect(fileMocks.openNativeMarkdownPath).not.toHaveBeenCalled();
    expect(editor).toHaveValue("# Keep dirty");
  });

  it("does not open another document when dirty changes are kept", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    vi.mocked(window.confirm).mockReturnValue(false);

    render(<App />);
    const editor = replaceEditorValue("# Dirty");

    fireEvent.click(screen.getByRole("button", { name: /open/i }));

    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved changes and open another document?");
    expect(fileMocks.openNativeMarkdownDocument).not.toHaveBeenCalled();
    expect(editor).toHaveValue("# Dirty");
  });

  it("shows native open cancel and error states", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.openNativeMarkdownDocument.mockResolvedValueOnce(null);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /open/i }));

    expect(await screen.findByText("Open canceled")).toBeInTheDocument();

    fileMocks.openNativeMarkdownDocument.mockRejectedValueOnce(new Error("permission denied"));
    fireEvent.click(screen.getByRole("button", { name: /open/i }));

    expect(await screen.findByText("Open failed: permission denied")).toBeInTheDocument();
  });

  it("saves through the native file service when available", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.saveNativeMarkdownDocument.mockResolvedValue({
      name: "saved.md",
      path: "/tmp/saved.md",
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(fileMocks.saveNativeMarkdownDocument).toHaveBeenCalledWith(
        expect.stringContaining("# HillDown"),
        null,
        "Untitled document.md",
        false,
      );
    });
    expect(screen.getByText("Saved saved.md")).toBeInTheDocument();
  });

  it("passes force-save-as to the native file service", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.saveNativeMarkdownDocument.mockResolvedValue({
      name: "saved-as.md",
      path: "/tmp/saved-as.md",
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /save as/i }));

    await waitFor(() => expect(fileMocks.saveNativeMarkdownDocument).toHaveBeenCalledWith(
      expect.stringContaining("# HillDown"),
      null,
      "Untitled document.md",
      true,
    ));
    expect(screen.getByText("Saved saved-as.md")).toBeInTheDocument();
  });

  it("shows native save cancel and error states", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.saveNativeMarkdownDocument.mockResolvedValueOnce(null);

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Save canceled")).toBeInTheDocument();

    fileMocks.saveNativeMarkdownDocument.mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("Save failed: disk full")).toBeInTheDocument();
  });

  it("downloads Markdown in browser fallback mode", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(window.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(screen.getByText("Downloaded Markdown")).toBeInTheDocument();
  });

  it("uses the edited document title for browser downloads", async () => {
    render(<App />);

    fireEvent.change(screen.getByRole("textbox", { name: /document title/i }), {
      target: { value: "Release Notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(lastDownloadName).toBe("Release Notes.md"));
    expect(screen.getByText("Downloaded Markdown")).toBeInTheDocument();
  });

  it("keeps dirty content when new document confirmation is rejected", () => {
    vi.mocked(window.confirm).mockReturnValue(false);

    render(<App />);
    const editor = replaceEditorValue("# Keep me");

    fireEvent.click(screen.getByRole("button", { name: /new/i }));

    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved changes and create a new document?");
    expect(editor).toHaveValue("# Keep me");
  });
});
