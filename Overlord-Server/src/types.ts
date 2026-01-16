export type ClientRole = "client" | "viewer";

export type ClientInfo = {
  id: string;
  lastSeen: number;
  role: ClientRole;
  ws: any;
  lastPingSent?: number;
  hwid?: string;
  host?: string;
  os?: string;
  arch?: string;
  version?: string;
  user?: string;
  monitors?: number;
  country?: string;
  pingMs?: number;
};

export type ListFilters = {
  page: number;
  pageSize: number;
  search: string;
  sort: string;
  statusFilter?: string;
  osFilter?: string;
};

export type ListItem = ClientInfo & {
  online: boolean;
  thumbnail: string | null;
};

export type ListResult = {
  page: number;
  pageSize: number;
  total: number;
  online: number;
  items: ListItem[];
};
