import { pool } from './db';
import { migrate } from './migrate';
import { seedLibrary } from './seed';

// Usage: node dist/cli.js migrate | seed
const cmd = process.argv[2];

async function main() {
  if (cmd === 'migrate') await migrate();
  else if (cmd === 'seed') {
    await migrate();
    await seedLibrary();
  } else {
    console.error('Usage: cli.js migrate | seed');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
