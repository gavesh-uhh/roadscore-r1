import { loadDbEnv } from '../src/config/env.js';
import { createDb, closeDb } from '../src/db/client.js';

async function check() {
  const env = loadDbEnv();
  const sql = createDb(env);
  try {
    const tables = await sql`
      select table_name 
      from information_schema.tables 
      where table_schema = 'public' 
      order by table_name;
    `;
    console.log('Tables in public schema:', tables.map((t: any) => t.table_name));
    const devices = await sql`select * from devices`;
    console.log('Registered devices:', devices);
    for (const t of tables) {
      const name = (t as any).table_name;
      const rows = await sql.unsafe(`select count(*)::int from public.${name}`);
      const count = (rows as any)?.[0]?.count ?? 0;
      console.log(`  - ${name}: ${count} rows`);
    }
  } catch (err) {
    console.error('Check error:', err);
  } finally {
    await closeDb(sql);
  }
}

check();
