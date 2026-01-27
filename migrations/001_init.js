export async function up(knex) {
  await knex.schema.createTable("users", (t) => {
    t.string("id").primary();              // uuid as string
    t.string("email").notNullable().unique();
    t.string("name");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("otps", (t) => {
    t.increments("id").primary();
    t.string("email").notNullable();
    t.string("otp_hash").notNullable();
    t.timestamp("expires_at").notNullable();
    t.integer("attempts").notNullable().defaultTo(0);
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.index(["email"]);
    t.index(["expires_at"]);
  });

  await knex.schema.createTable("sessions", (t) => {
    t.increments("id").primary();
    t.string("user_id").notNullable();
    t.string("session_hash").notNullable();
    t.timestamp("expires_at").notNullable();
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.index(["user_id"]);
    t.index(["expires_at"]);
  });

  await knex.schema.createTable("basecamp_tokens", (t) => {
    t.string("user_id").primary();
    t.text("access_token").notNullable();
    t.text("refresh_token");
    t.timestamp("expires_at");
    t.integer("default_account_id");
    t.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("oauth_states", (t) => {
    t.string("state").primary();
    t.string("user_id").notNullable();
    t.timestamp("expires_at").notNullable();
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.index(["expires_at"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("oauth_states");
  await knex.schema.dropTableIfExists("basecamp_tokens");
  await knex.schema.dropTableIfExists("sessions");
  await knex.schema.dropTableIfExists("otps");
  await knex.schema.dropTableIfExists("users");
}
