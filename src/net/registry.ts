/**
 * Kind registries for the `Net` plugin. Built-in kinds register here via
 * side-effect import (see `net/index.ts`); a consumer may register custom ones.
 */

import type { ServerHandler, ClientHandler } from './types';

const serverKinds = new Map<string, ServerHandler>();
const clientKinds = new Map<string, ClientHandler>();

export function registerServer(kind: string, handler: ServerHandler): void {
  serverKinds.set(kind, handler);
}

export function registerClient(kind: string, handler: ClientHandler): void {
  clientKinds.set(kind, handler);
}

export function lookupServer(kind: string): ServerHandler | undefined {
  return serverKinds.get(kind);
}

export function lookupClient(kind: string): ClientHandler | undefined {
  return clientKinds.get(kind);
}
