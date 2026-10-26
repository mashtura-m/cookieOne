import { buildServer } from './server';
import { config } from './config';
import { migrate } from './migrate';
import { seedLibrary } from './seed';
import { pool } from './db';

async function main() {
  if (process.env.AUTO_MIGRATE !== 'false') {
    await migrate();
    await seedLibrary();
  }
  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });
  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
