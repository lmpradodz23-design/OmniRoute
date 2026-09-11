// Shutdown-hook registry (R-6), split out of gracefulShutdown.ts so that any module that owns
// a background timer can register its stopper WITHOUT importing the shutdown orchestrator
// (which pulls in serverLifecycle/db and would create import cycles). No imports here — on
// purpose: this file must be safe to load from open-sse/, src/lib/db/ and the packaged CLI.
//
// The registry lives on globalThis so HMR module instances and the custom server share it.

export type ShutdownHook = () => void | Promise<void>;

declare global {
  var __omnirouteShutdownHooks: Map<string, ShutdownHook> | undefined;
}

export function getShutdownHooks(): Map<string, ShutdownHook> {
  return (globalThis.__omnirouteShutdownHooks ??= new Map());
}

/**
 * Register teardown for a module-owned timer/worker. Runs at the START of graceful shutdown
 * — before requests drain and before the database closes — so no background job fires into
 * a closing process. Idempotent per `name`; returns an unregister handle that only removes
 * the hook it registered.
 */
export function registerShutdownHook(name: string, hook: ShutdownHook): () => void {
  getShutdownHooks().set(name, hook);
  return () => {
    if (getShutdownHooks().get(name) === hook) getShutdownHooks().delete(name);
  };
}

export function unregisterShutdownHook(name: string): void {
  getShutdownHooks().delete(name);
}
