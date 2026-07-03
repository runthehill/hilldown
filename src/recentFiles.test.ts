import { beforeEach, describe, expect, it } from "vitest";
import {
  addRecent,
  loadRecentFiles,
  MAX_RECENT,
  removeRecent,
  saveRecentFiles,
  type RecentFile,
} from "./recentFiles";

const f = (path: string): RecentFile => ({ path, name: path });

describe("recentFiles", () => {
  beforeEach(() => window.localStorage.clear());

  it("prepends a new entry", () => {
    expect(addRecent([f("/a")], f("/b"))).toEqual([f("/b"), f("/a")]);
  });

  it("moves an existing path to the front, deduped by path", () => {
    const list = [f("/a"), f("/b"), f("/c")];
    expect(addRecent(list, { path: "/b", name: "renamed" })).toEqual([
      { path: "/b", name: "renamed" },
      f("/a"),
      f("/c"),
    ]);
  });

  it("caps the list at MAX_RECENT, most-recent-first", () => {
    let list: RecentFile[] = [];
    for (let i = 0; i < MAX_RECENT + 5; i += 1) {
      list = addRecent(list, f(`/f${i}`));
    }
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toEqual(f(`/f${MAX_RECENT + 4}`));
  });

  it("removes an entry by path", () => {
    expect(removeRecent([f("/a"), f("/b")], "/a")).toEqual([f("/b")]);
  });

  it("round-trips through localStorage", () => {
    saveRecentFiles([f("/a"), f("/b")]);
    expect(loadRecentFiles()).toEqual([f("/a"), f("/b")]);
  });

  it("returns [] for absent, malformed, or wrongly-shaped storage", () => {
    expect(loadRecentFiles()).toEqual([]);
    window.localStorage.setItem("hilldown.recent", "{ not json");
    expect(loadRecentFiles()).toEqual([]);
    window.localStorage.setItem(
      "hilldown.recent",
      JSON.stringify([{ path: 1 }, "x", { path: "/ok", name: "ok" }]),
    );
    expect(loadRecentFiles()).toEqual([{ path: "/ok", name: "ok" }]);
  });
});
