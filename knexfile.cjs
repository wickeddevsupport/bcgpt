module.exports = {
  client: "sqlite3",
  connection: {
    filename: process.env.SQLITE_PATH || "./data/bcgpt.sqlite",
  },
  useNullAsDefault: true,
};
