/**
 * catalogBuildYield.ts — event-loop yield budget of the /v1/models catalog build (#9147).
 *
 * The builder walks connections + model registries at catalog scale with no natural
 * event-loop yield, so a large deployment pins the single Node.js thread for the whole
 * build (reporter: 183 connections / 2000+ models → 10.1s stall that blocks the
 * dashboard WS heartbeat). The hot loops yield every N items through these helpers.
 */

export const BUILTIN_AUTO_YIELD_INTERVAL = 2;

export function yieldCatalogBuildTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A counter that yields to the event loop once every `every` calls. */
export function createCatalogBuildYielder(every: number): () => Promise<void> {
  let count = 0;
  return async (): Promise<void> => {
    count++;
    if (count % every === 0) {
      await yieldCatalogBuildTurn();
    }
  };
}
