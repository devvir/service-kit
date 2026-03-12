import http from 'node:http';
import type { Config, Plugin, Service, Spec } from '..';

type HealthcheckConfig =
  | { port?: number, message?: string }
  | boolean
  | number;

const DEFAULT_PORT = 3000;

export default {
  name: 'Health',

  init(service: Service) {
    if (service.spec().healthcheck === false)
      return;



    const server = startServer(service);

    service.once('shutdown', () => server.close());
  },

  extends: ({ spec }: Config) => ({
    isHealthy: () => spec.state?.healthy,
    healthcheck: spec.healthcheck ?? true,
  }),
} as Plugin;

function startServer(service: Service): http.Server {
  const port = resolvePort(service.spec());

  const server = http.createServer(async (_, res): Promise<void> => {
    if (service.hasListeners('healthCheck')) {
      service.emit('healthCheck', res);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    }

    if ('setState' in service) {
      service.setState('healthy', res.statusCode >= 200 && res.statusCode < 300);
    }
  });

  return server.listen(port);
};

function resolvePort(spec: Spec): number {
  const settings = spec.healthcheck as HealthcheckConfig;

  if (typeof settings === 'number') return settings;
  if (typeof settings === 'boolean') return DEFAULT_PORT;

  return settings?.port ?? DEFAULT_PORT;
}

//--- Extend Service interface ------------------------------------------------

declare module '..' {
  interface Service {
    healthcheck: HealthcheckConfig;
    isHealthy: () => boolean;
  }
}
