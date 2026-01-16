import type { ClientInfo } from "./types";

const clients = new Map<string, ClientInfo>();

export function addClient(id: string, info: ClientInfo): void {
  clients.set(id, info);
}

export function getClient(id: string): ClientInfo | undefined {
  return clients.get(id);
}

export function deleteClient(id: string): boolean {
  return clients.delete(id);
}

export function hasClient(id: string): boolean {
  return clients.has(id);
}

export function getAllClients(): Map<string, ClientInfo> {
  return clients;
}

export function getClientCount(): number {
  return clients.size;
}

export function getOnlineClients(): ClientInfo[] {
  return Array.from(clients.values()).filter(
    (c) => c.lastSeen && Date.now() - c.lastSeen < 60000,
  );
}
