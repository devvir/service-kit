# @devvir/service-kit

A lightweight toolkit for Node.js microservices. Handles the scaffolding — health checks, graceful shutdown, provider connections, and structured logging — so your service focuses on its tasks.

## Install

```sh
pnpm install @devvir/service-kit
```

## Usage

The minimal case:

```ts
import SK from '@devvir/service-kit';

SK.run(async (service) => {
  service.logger.info('Running!');
});
```

Out of the box you get a health check on port 3000 and graceful shutdown on SIGTERM/SIGINT. Shutdown listeners can be async — all are awaited before the process exits. No configuration required.

---

Declare config, bind lifecycle hooks, then run:

```ts
import SK from '@devvir/service-kit';

SK.declare({
  name:   'api',
  config: { port: parseInt(process.env.PORT || '3001') },
});

SK.bind({
  onShutdown: async (service) => {
    await cleanup();
    service.logger.info('cleaned up');
  },
});

SK.run(async (service) => {
  const port = service.config('port') as number;
  startServer(port);
});
```

---

Connect to a database or queue in your service function:

```ts
import SK, { type Service } from '@devvir/service-kit';

SK.declare({
  name: 'worker',
  providers: {
    rabbitmq: { url: process.env.AMQP_URL },
  },
});

SK.run(async (service: Service) => {
  const conn = await service.providers.connect('rabbitmq');
  // start consuming...
});
```

## Documentation

[Full documentation →](https://devvir.github.io/service-kit/)
