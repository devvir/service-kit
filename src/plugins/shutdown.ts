import type { Plugin, Service, ServiceListener } from '..';

export default {
  name: 'Shutdown',

  init(service: Service): void {
    process.once('SIGTERM', () => shutdown(service, 'SIGTERM'));
    process.once('SIGINT',  () => shutdown(service, 'SIGINT'));
  },

  extends: () => ({
    shutdown(this: Service, signal?: string): Promise<void> {
      return shutdown(this, signal ?? 'MANUAL');
    },
  }),
} as Plugin;

/**
 * Notifies listeners that the system is shutting down, allowing graceful cleanup/teardown.
 * Async listeners are supported — all listeners are awaited before proceeding.
 */
let shutdownHandled = false;

const shutdown = async (service: Service, signal: string): Promise<void> => {
  if (shutdownHandled) return;

  shutdownHandled = true;

  const shutdownCbs = service.listeners('shutdown');
  await Promise.all(shutdownCbs.map(fn => (fn as ServiceListener)(service, signal)));

  const shutdownCompleteCbs = service.listeners('shutdownComplete');
  await Promise.all(shutdownCompleteCbs.map(fn => (fn as ServiceListener)(service, signal)));

  process.exit(0);
}

//--- Extend Service interface ------------------------------------------------

declare module '..' {
  interface Service {
    shutdown(signal?: string): Promise<void>;
  }
}

//-----------------------------------------------------------------------------
//--- For testing only: reset the `shutdownHandled` state between tests. ------
//-----------------------------------------------------------------------------
/** @internal */ export const __test__ = { reset: () => (shutdownHandled = false) };