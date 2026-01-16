import type { ServerWebSocket } from "bun";
import type { ClientRole } from "../types";

export type SocketRole =
  | ClientRole
  | "console_viewer"
  | "rd_viewer"
  | "file_browser_viewer"
  | "process_viewer";

export type SocketData = {
  role: SocketRole;
  clientId: string;
  sessionId?: string;
  ip?: string;
  userRole?: string;
};

export type ConsoleSession = {
  id: string;
  clientId: string;
  viewer: ServerWebSocket<SocketData>;
  createdAt: number;
};

export type RemoteDesktopViewer = {
  id: string;
  clientId: string;
  viewer: ServerWebSocket<SocketData>;
  createdAt: number;
};

export type FileBrowserViewer = {
  id: string;
  clientId: string;
  viewer: ServerWebSocket<SocketData>;
  createdAt: number;
};

export type ProcessViewer = {
  id: string;
  clientId: string;
  viewer: ServerWebSocket<SocketData>;
  createdAt: number;
};
