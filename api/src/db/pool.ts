import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://obs:obspass@localhost:5432/observability',
  max: 20,
  idleTimeoutMillis: 30000,
});

export default pool;
