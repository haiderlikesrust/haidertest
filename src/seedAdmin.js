const bcrypt = require("bcrypt");
const config = require("./config");
const { query, pool } = require("./db");

async function seedAdmin() {
  const existing = await query("SELECT id FROM users WHERE username = $1", [
    config.adminBootstrapUser,
  ]);
  if (existing.rowCount > 0) {
    console.log("Admin user already exists.");
    return;
  }

  const hash = await bcrypt.hash(config.adminBootstrapPass, 12);
  await query(
    "INSERT INTO users (username, role, password_hash) VALUES ($1, 'admin', $2)",
    [config.adminBootstrapUser, hash]
  );
  console.log(`Created admin user: ${config.adminBootstrapUser}`);
}

seedAdmin()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("Admin seed failed:", error);
    await pool.end();
    process.exit(1);
  });
