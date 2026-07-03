import type { TextSelection } from "./editorCommands";

export type DocumentId = string;

export interface EditorDocument {
  id: DocumentId;
  markdown: string;
  title: string;
  path: string | null;
  lastSavedMarkdown: string;
  history: string[];
  historyIndex: number;
  selection: TextSelection;
}

export interface EditorSession {
  documents: EditorDocument[];
  activeId: DocumentId;
}

const HISTORY_LIMIT = 80;
const UNTITLED_TITLE = "Untitled document";

export function createEmptyDocument(id: DocumentId, contents = ""): EditorDocument {
  return {
    id,
    markdown: contents,
    title: UNTITLED_TITLE,
    path: null,
    lastSavedMarkdown: contents,
    history: [contents],
    historyIndex: 0,
    selection: { start: 0, end: 0 },
  };
}

export function documentFromFile(
  id: DocumentId,
  contents: string,
  title: string,
  path: string | null,
): EditorDocument {
  return {
    id,
    markdown: contents,
    title,
    path,
    lastSavedMarkdown: contents,
    history: [contents],
    historyIndex: 0,
    selection: { start: 0, end: 0 },
  };
}

export function createSession(document: EditorDocument): EditorSession {
  return { documents: [document], activeId: document.id };
}

export function getActive(session: EditorSession): EditorDocument {
  return session.documents.find((doc) => doc.id === session.activeId) ?? session.documents[0];
}

export function replaceActive(
  session: EditorSession,
  updater: (doc: EditorDocument) => EditorDocument,
): EditorSession {
  return {
    ...session,
    documents: session.documents.map((doc) =>
      doc.id === session.activeId ? updater(doc) : doc,
    ),
  };
}

export function addDocument(session: EditorSession, document: EditorDocument): EditorSession {
  return { documents: [...session.documents, document], activeId: document.id };
}

export function openDocumentInSession(
  session: EditorSession,
  document: EditorDocument,
): EditorSession {
  if (document.path) {
    const existing = session.documents.find((doc) => doc.path === document.path);
    if (existing) {
      return { ...session, activeId: existing.id };
    }
  }
  return addDocument(session, document);
}

export function setActive(session: EditorSession, id: DocumentId): EditorSession {
  if (!session.documents.some((doc) => doc.id === id)) {
    return session;
  }
  return { ...session, activeId: id };
}

export function closeDocument(
  session: EditorSession,
  id: DocumentId,
  fallback: () => EditorDocument,
): EditorSession {
  const index = session.documents.findIndex((doc) => doc.id === id);
  if (index === -1) {
    return session;
  }

  const remaining = session.documents.filter((doc) => doc.id !== id);
  if (remaining.length === 0) {
    return createSession(fallback());
  }

  if (session.activeId !== id) {
    return { documents: remaining, activeId: session.activeId };
  }

  const neighbour = remaining[index] ?? remaining[index - 1] ?? remaining[0];
  return { documents: remaining, activeId: neighbour.id };
}

export function pushDocumentHistory(doc: EditorDocument, next: string): EditorDocument {
  const history = [...doc.history.slice(0, doc.historyIndex + 1), next].slice(-HISTORY_LIMIT);
  return { ...doc, markdown: next, history, historyIndex: history.length - 1 };
}

export function undoDocument(doc: EditorDocument): EditorDocument {
  if (doc.historyIndex <= 0) {
    return doc;
  }
  const historyIndex = doc.historyIndex - 1;
  return { ...doc, historyIndex, markdown: doc.history[historyIndex] };
}

export function redoDocument(doc: EditorDocument): EditorDocument {
  if (doc.historyIndex >= doc.history.length - 1) {
    return doc;
  }
  const historyIndex = doc.historyIndex + 1;
  return { ...doc, historyIndex, markdown: doc.history[historyIndex] };
}

export function isDocumentDirty(doc: EditorDocument): boolean {
  return doc.markdown !== doc.lastSavedMarkdown;
}
