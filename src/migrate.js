const fs = require("fs/promises");
const path = require("path");
const { pool } = require("./db");

async function runMigrations() {
  const dir = path.resolve(process.cwd(), "migrations");
  const files = (await fs.readdir(dir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(dir, file), "utf8");
    await pool.query(sql);
    console.log(`Applied migration: ${file}`);
  }
}

runMigrations()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("Migration failed:", error);
    await pool.end();
    process.exit(1);
  });
