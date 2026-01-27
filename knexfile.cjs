module.exports = {
  client: "better-sqlite3",
  connection: {
    filename: process.env.SQLITE_PATH || "/tmp/bcgpt.sqlite"
  },
  useNullAsDefault: true
};
