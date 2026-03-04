const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres:haider@localhost:5432/postgres",
  });
  await client.connect();
  const existing = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = 'narfwiki'"
  );
  if (!existing.rowCount) {
    await client.query("CREATE DATABASE narfwiki");
    console.log("Created database narfwiki");
  } else {
    console.log("Database narfwiki already exists");
  }
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
