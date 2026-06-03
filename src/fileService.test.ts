import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  basenameFromPath,
  canUseNativeFileSystem,
  ensureMarkdownExtension,
  openNativeMarkdownDocument,
  openNativeMarkdownPath,
  saveNativeMarkdownDocument,
  takePendingNativeOpenedFilePaths,
  titleFromFileName,
} from "./fileService";

const nativeMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
  open: vi.fn(),
  readTextFile: vi.fn(),
  save: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: nativeMocks.isTauri,
  invoke: nativeMocks.invoke,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: nativeMocks.open,
  save: nativeMocks.save,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: nativeMocks.readTextFile,
  writeTextFile: nativeMocks.writeTextFile,
}));

beforeEach(() => {
  vi.clearAllMocks();
  nativeMocks.isTauri.mockReturnValue(true);
});

describe("file service helpers", () => {
  it("extracts file names from unix and windows paths", () => {
    expect(basenameFromPath("/Users/jhill/notes/today.md")).toBe("today.md");
    expect(basenameFromPath("C:\\Users\\jhill\\notes\\today.markdown")).toBe("today.markdown");
    expect(basenameFromPath("")).toBe("Untitled.md");
  });

  it("adds markdown extension only when needed", () => {
    expect(ensureMarkdownExtension("meeting-notes")).toBe("meeting-notes.md");
    expect(ensureMarkdownExtension("   ")).toBe("Untitled.md");
    expect(ensureMarkdownExtension("draft.txt")).toBe("draft.txt");
    expect(ensureMarkdownExtension("guide.markdown")).toBe("guide.markdown");
    expect(ensureMarkdownExtension("README.MD")).toBe("README.MD");
  });

  it("derives a document title from a file name", () => {
    expect(titleFromFileName("/tmp/release-notes.md")).toBe("release-notes");
    expect(titleFromFileName("notes.txt")).toBe("notes");
    expect(titleFromFileName(".md")).toBe("Untitled document");
  });

  it("reports native file support from the Tauri runtime", () => {
    nativeMocks.isTauri.mockReturnValue(false);

    expect(canUseNativeFileSystem()).toBe(false);
  });

  it("opens a native markdown document", async () => {
    nativeMocks.open.mockResolvedValue("/Users/jhill/notes/today.md");
    nativeMocks.readTextFile.mockResolvedValue("# Today");

    await expect(openNativeMarkdownDocument()).resolves.toEqual({
      contents: "# Today",
      name: "today.md",
      path: "/Users/jhill/notes/today.md",
    });
    expect(nativeMocks.open).toHaveBeenCalledWith(expect.objectContaining({
      directory: false,
      fileAccessMode: "scoped",
      multiple: false,
    }));
    expect(nativeMocks.readTextFile).toHaveBeenCalledWith("/Users/jhill/notes/today.md");
  });

  it("opens a native markdown document from an OS-provided path", async () => {
    nativeMocks.invoke.mockResolvedValue({
      contents: "# Associated",
      name: "associated.md",
      path: "/Users/jhill/notes/associated.md",
    });

    await expect(openNativeMarkdownPath("/Users/jhill/notes/associated.md")).resolves.toEqual({
      contents: "# Associated",
      name: "associated.md",
      path: "/Users/jhill/notes/associated.md",
    });
    expect(nativeMocks.invoke).toHaveBeenCalledWith("read_markdown_document", {
      path: "/Users/jhill/notes/associated.md",
    });
  });

  it("takes pending native opened file paths", async () => {
    nativeMocks.invoke.mockResolvedValue(["/tmp/one.md", "/tmp/two.markdown"]);

    await expect(takePendingNativeOpenedFilePaths()).resolves.toEqual([
      "/tmp/one.md",
      "/tmp/two.markdown",
    ]);
    expect(nativeMocks.invoke).toHaveBeenCalledWith("take_pending_opened_file_paths");
  });

  it("returns null when open is unavailable or canceled", async () => {
    nativeMocks.isTauri.mockReturnValue(false);
    await expect(openNativeMarkdownDocument()).resolves.toBeNull();
    expect(nativeMocks.open).not.toHaveBeenCalled();

    nativeMocks.isTauri.mockReturnValue(true);
    nativeMocks.open.mockResolvedValue(null);
    await expect(openNativeMarkdownDocument()).resolves.toBeNull();

    nativeMocks.open.mockResolvedValue(["/tmp/one.md"]);
    await expect(openNativeMarkdownDocument()).resolves.toBeNull();
    expect(nativeMocks.readTextFile).not.toHaveBeenCalled();
  });

  it("saves to the existing document path without prompting", async () => {
    await expect(saveNativeMarkdownDocument("# Draft", "/tmp/draft.md", "draft")).resolves.toEqual({
      name: "draft.md",
      path: "/tmp/draft.md",
    });

    expect(nativeMocks.save).not.toHaveBeenCalled();
    expect(nativeMocks.writeTextFile).toHaveBeenCalledWith("/tmp/draft.md", "# Draft");
  });

  it("prompts for save-as when needed", async () => {
    nativeMocks.save.mockResolvedValue("/tmp/new-note.md");

    await expect(saveNativeMarkdownDocument("# New", null, "new-note")).resolves.toEqual({
      name: "new-note.md",
      path: "/tmp/new-note.md",
    });

    expect(nativeMocks.save).toHaveBeenCalledWith(expect.objectContaining({
      canCreateDirectories: true,
      defaultPath: "new-note.md",
    }));
    expect(nativeMocks.writeTextFile).toHaveBeenCalledWith("/tmp/new-note.md", "# New");
  });

  it("returns null when saving is unavailable or canceled", async () => {
    nativeMocks.isTauri.mockReturnValue(false);
    await expect(saveNativeMarkdownDocument("# Draft", null, "draft")).resolves.toBeNull();
    expect(nativeMocks.save).not.toHaveBeenCalled();

    nativeMocks.isTauri.mockReturnValue(true);
    nativeMocks.save.mockResolvedValue(null);
    await expect(saveNativeMarkdownDocument("# Draft", null, "draft")).resolves.toBeNull();
    expect(nativeMocks.writeTextFile).not.toHaveBeenCalled();
  });
});
