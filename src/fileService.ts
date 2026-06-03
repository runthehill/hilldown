import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export type OpenedDocument = {
  contents: string;
  name: string;
  path: string | null;
};

export type SavedDocument = {
  name: string;
  path: string | null;
};

const markdownFilters = [
  {
    name: "Markdown",
    extensions: ["md", "markdown", "mdown", "txt"],
  },
];

export const openedFilesEvent = "hilldown://open-files";

export function canUseNativeFileSystem(): boolean {
  return isTauri();
}

export function basenameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "Untitled.md";
}

export function ensureMarkdownExtension(name: string): string {
  const trimmed = name.trim() || "Untitled";
  return /\.(md|markdown|mdown|txt)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
}

export function titleFromFileName(name: string): string {
  return basenameFromPath(name).replace(/\.(md|markdown|mdown|txt)$/i, "") || "Untitled document";
}

export async function openNativeMarkdownDocument(): Promise<OpenedDocument | null> {
  if (!canUseNativeFileSystem()) {
    return null;
  }

  const selected = await open({
    title: "Open Markdown File",
    multiple: false,
    directory: false,
    filters: markdownFilters,
    fileAccessMode: "scoped",
  });

  if (!selected || Array.isArray(selected)) {
    return null;
  }

  return {
    contents: await readTextFile(selected),
    name: basenameFromPath(selected),
    path: selected,
  };
}

export async function openNativeMarkdownPath(path: string): Promise<OpenedDocument | null> {
  if (!canUseNativeFileSystem()) {
    return null;
  }

  return invoke<OpenedDocument>("read_markdown_document", { path });
}

export async function takePendingNativeOpenedFilePaths(): Promise<string[]> {
  if (!canUseNativeFileSystem()) {
    return [];
  }

  return invoke<string[]>("take_pending_opened_file_paths");
}

export async function saveNativeMarkdownDocument(
  contents: string,
  currentPath: string | null,
  suggestedName: string,
  forceSaveAs = false,
): Promise<SavedDocument | null> {
  if (!canUseNativeFileSystem()) {
    return null;
  }

  const targetPath = forceSaveAs || !currentPath
    ? await save({
        title: "Save Markdown File",
        defaultPath: ensureMarkdownExtension(suggestedName),
        filters: markdownFilters,
        canCreateDirectories: true,
      })
    : currentPath;

  if (!targetPath) {
    return null;
  }

  await writeTextFile(targetPath, contents);

  return {
    name: basenameFromPath(targetPath),
    path: targetPath,
  };
}
