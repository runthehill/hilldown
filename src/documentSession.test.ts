import { describe, expect, it } from "vitest";
import {
  addDocument,
  closeDocument,
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
  undoDocument,
  type EditorDocument,
} from "./documentSession";

const fresh = (id: string): EditorDocument => createEmptyDocument(id);

describe("documentSession", () => {
  it("creates an empty untitled document", () => {
    const doc = createEmptyDocument("a");
    expect(doc).toMatchObject({ id: "a", markdown: "", title: "Untitled document", path: null });
    expect(doc.history).toEqual([""]);
    expect(doc.historyIndex).toBe(0);
    expect(isDocumentDirty(doc)).toBe(false);
  });

  it("builds a document from file contents seeded as saved", () => {
    const doc = documentFromFile("b", "# Hi", "notes", "/tmp/notes.md");
    expect(doc).toMatchObject({ markdown: "# Hi", title: "notes", path: "/tmp/notes.md", lastSavedMarkdown: "# Hi" });
    expect(isDocumentDirty(doc)).toBe(false);
  });

  it("adds and activates a document", () => {
    const session = addDocument(createSession(fresh("a")), fresh("b"));
    expect(session.documents.map((d) => d.id)).toEqual(["a", "b"]);
    expect(session.activeId).toBe("b");
  });

  it("activates the existing tab when opening an already-open path (no duplicate)", () => {
    const first = documentFromFile("a", "one", "one", "/p/one.md");
    const again = documentFromFile("b", "one", "one", "/p/one.md");
    const session = openDocumentInSession(createSession(first), again);
    expect(session.documents).toHaveLength(1);
    expect(session.activeId).toBe("a");
  });

  it("adds a tab when opening a distinct path", () => {
    const first = documentFromFile("a", "one", "one", "/p/one.md");
    const other = documentFromFile("b", "two", "two", "/p/two.md");
    const session = openDocumentInSession(createSession(first), other);
    expect(session.documents.map((d) => d.id)).toEqual(["a", "b"]);
    expect(session.activeId).toBe("b");
  });

  it("closing the active middle tab activates the right neighbour", () => {
    let session = createSession(fresh("a"));
    session = addDocument(session, fresh("b"));
    session = addDocument(session, fresh("c"));
    session = setActive(session, "b");
    session = closeDocument(session, "b", () => fresh("z"));
    expect(session.documents.map((d) => d.id)).toEqual(["a", "c"]);
    expect(session.activeId).toBe("c");
  });

  it("closing the active last tab activates the left neighbour", () => {
    let session = createSession(fresh("a"));
    session = addDocument(session, fresh("b"));
    session = closeDocument(session, "b", () => fresh("z"));
    expect(session.documents.map((d) => d.id)).toEqual(["a"]);
    expect(session.activeId).toBe("a");
  });

  it("closing the only tab leaves one fresh untitled document", () => {
    const session = closeDocument(createSession(fresh("a")), "a", () => fresh("z"));
    expect(session.documents.map((d) => d.id)).toEqual(["z"]);
    expect(session.activeId).toBe("z");
    expect(getActive(session).markdown).toBe("");
  });

  it("replaceActive updates only the active document immutably", () => {
    const before = addDocument(createSession(fresh("a")), fresh("b")); // active b
    const after = replaceActive(before, (doc) => ({ ...doc, markdown: "x" }));
    expect(getActive(after).markdown).toBe("x");
    expect(after.documents[0]).toBe(before.documents[0]); // untouched by reference
    expect(after).not.toBe(before);
  });

  it("pushDocumentHistory sets markdown, appends history, and caps at 80", () => {
    let doc = createEmptyDocument("a");
    for (let i = 1; i <= 85; i += 1) doc = pushDocumentHistory(doc, `v${i}`);
    expect(doc.markdown).toBe("v85");
    expect(doc.history).toHaveLength(80);
    expect(doc.history[doc.history.length - 1]).toBe("v85");
    expect(doc.historyIndex).toBe(79);
  });

  it("pushDocumentHistory truncates redo tail before appending", () => {
    let doc = pushDocumentHistory(createEmptyDocument("a"), "one");
    doc = pushDocumentHistory(doc, "two");
    doc = undoDocument(doc); // back to "one"
    doc = pushDocumentHistory(doc, "three");
    expect(doc.history).toEqual(["", "one", "three"]);
    expect(doc.markdown).toBe("three");
  });

  it("undo/redo walk the history without falling off the ends", () => {
    let doc = pushDocumentHistory(createEmptyDocument("a"), "one");
    doc = pushDocumentHistory(doc, "two");
    doc = undoDocument(doc);
    expect(doc.markdown).toBe("one");
    doc = undoDocument(doc);
    expect(doc.markdown).toBe("");
    doc = undoDocument(doc); // clamp
    expect(doc.markdown).toBe("");
    doc = redoDocument(doc);
    expect(doc.markdown).toBe("one");
  });

  it("detects dirty state", () => {
    const doc = pushDocumentHistory(documentFromFile("a", "saved", "t", "/p"), "edited");
    expect(isDocumentDirty(doc)).toBe(true);
  });
});
