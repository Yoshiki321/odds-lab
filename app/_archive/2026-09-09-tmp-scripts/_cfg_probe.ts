import { loadDbConfig } from '../../src/server/db/pool.js';
const c = loadDbConfig();
console.log(`host=${c.host} port=${c.port} database=${c.database} ssl=${c.ssl}`);
