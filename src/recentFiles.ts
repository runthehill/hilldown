export interface RecentFile {
  path: string;
  name: string;
}

export const MAX_RECENT = 10;
const STORAGE_KEY = "hilldown.recent";

export function addRecent(list: RecentFile[], entry: RecentFile, cap = MAX_RECENT): RecentFile[] {
  const withoutDuplicate = list.filter((item) => item.path !== entry.path);
  return [entry, ...withoutDuplicate].slice(0, cap);
}

export function removeRecent(list: RecentFile[], path: string): RecentFile[] {
  return list.filter((item) => item.path !== path);
}

export function loadRecentFiles(): RecentFile[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is RecentFile =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as RecentFile).path === "string" &&
          typeof (item as RecentFile).name === "string",
      )
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function saveRecentFiles(list: RecentFile[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota / serialization errors — recents are a nicety */
  }
}
