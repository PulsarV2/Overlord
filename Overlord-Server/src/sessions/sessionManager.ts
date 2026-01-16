import type { ServerWebSocket } from "bun";
import type {
  ConsoleSession,
  RemoteDesktopViewer,
  FileBrowserViewer,
  ProcessViewer,
  SocketData,
} from "./types";

const consoleSessions = new Map<string, ConsoleSession>();
const rdSessions = new Map<string, RemoteDesktopViewer>();
const fileBrowserSessions = new Map<string, FileBrowserViewer>();
const processSessions = new Map<string, ProcessViewer>();

export function addConsoleSession(session: ConsoleSession): void {
  consoleSessions.set(session.id, session);
}

export function getConsoleSession(
  sessionId: string,
): ConsoleSession | undefined {
  return consoleSessions.get(sessionId);
}

export function deleteConsoleSession(sessionId: string): boolean {
  return consoleSessions.delete(sessionId);
}

export function getConsoleSessionsByClient(clientId: string): ConsoleSession[] {
  return Array.from(consoleSessions.values()).filter(
    (s) => s.clientId === clientId,
  );
}

export function getAllConsoleSessions(): Map<string, ConsoleSession> {
  return consoleSessions;
}

export function addRdSession(session: RemoteDesktopViewer): void {
  rdSessions.set(session.id, session);
}

export function getRdSession(
  sessionId: string,
): RemoteDesktopViewer | undefined {
  return rdSessions.get(sessionId);
}

export function deleteRdSession(sessionId: string): boolean {
  return rdSessions.delete(sessionId);
}

export function getRdSessionsByClient(clientId: string): RemoteDesktopViewer[] {
  return Array.from(rdSessions.values()).filter((s) => s.clientId === clientId);
}

export function getAllRdSessions(): Map<string, RemoteDesktopViewer> {
  return rdSessions;
}

export function addFileBrowserSession(session: FileBrowserViewer): void {
  fileBrowserSessions.set(session.id, session);
}

export function getFileBrowserSession(
  sessionId: string,
): FileBrowserViewer | undefined {
  return fileBrowserSessions.get(sessionId);
}

export function deleteFileBrowserSession(sessionId: string): boolean {
  return fileBrowserSessions.delete(sessionId);
}

export function getFileBrowserSessionsByClient(
  clientId: string,
): FileBrowserViewer[] {
  return Array.from(fileBrowserSessions.values()).filter(
    (s) => s.clientId === clientId,
  );
}

export function getAllFileBrowserSessions(): Map<string, FileBrowserViewer> {
  return fileBrowserSessions;
}

export function addProcessSession(session: ProcessViewer): void {
  processSessions.set(session.id, session);
}

export function getProcessSession(
  sessionId: string,
): ProcessViewer | undefined {
  return processSessions.get(sessionId);
}

export function deleteProcessSession(sessionId: string): boolean {
  return processSessions.delete(sessionId);
}

export function getProcessSessionsByClient(clientId: string): ProcessViewer[] {
  return Array.from(processSessions.values()).filter(
    (s) => s.clientId === clientId,
  );
}

export function getAllProcessSessions(): Map<string, ProcessViewer> {
  return processSessions;
}

export function getConsoleSessionCount(): number {
  return consoleSessions.size;
}

export function getRdSessionCount(): number {
  return rdSessions.size;
}

export function getFileBrowserSessionCount(): number {
  return fileBrowserSessions.size;
}

export function getProcessSessionCount(): number {
  return processSessions.size;
}

export function safeSendViewer(
  ws: ServerWebSocket<SocketData>,
  payload: any,
): boolean {
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    return false;
  }
}

export function safeSendViewerFrame(
  ws: ServerWebSocket<SocketData>,
  bytes: Uint8Array,
  header?: any,
): number {
  try {
    const meta = JSON.stringify(header || {});
    const metaBytes = new TextEncoder().encode(meta);
    const metaLength = new Uint8Array(4);
    const view = new DataView(metaLength.buffer);
    view.setUint32(0, metaBytes.length, false);
    const buf = new Uint8Array(4 + metaBytes.length + bytes.length);
    buf.set(metaLength, 0);
    buf.set(metaBytes, 4);
    buf.set(bytes, 4 + metaBytes.length);
    ws.send(buf);
    return buf.length;
  } catch (err) {
    return 0;
  }
}
