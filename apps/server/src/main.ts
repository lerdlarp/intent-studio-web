import { buildApp } from './app';

const app = buildApp({ log: (line) => console.log(line) });
const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });

// Graceful shutdown: stop accepting, let in-flight requests finish (closing the database last), force-exit after 10 s.
let closing = false;
const shutdown = (signal: string): void => {
  if (closing) return;
  closing = true;
  console.log(`${signal} received, shutting down`);
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  app.close().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error('shutdown failed', err);
      process.exit(1);
    },
  );
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
