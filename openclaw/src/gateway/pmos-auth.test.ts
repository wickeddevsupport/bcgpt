import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adminResetPmosUserPassword,
  changePmosUserPassword,
  loginPmosUser,
  resolvePmosSessionFromToken,
  signupPmosUser,
} from "./pmos-auth.js";

let tempDir = "";
let previousStateDir: string | undefined;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-pmos-auth-"));
  previousStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = tempDir;
});

afterEach(async () => {
  if (previousStateDir === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = previousStateDir;
  }
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

describe("pmos auth bootstrap roles", () => {
  it("assigns first signup as super_admin and later signups as workspace_admin", async () => {
    const first = await signupPmosUser({
      name: "Owner",
      email: "owner@example.com",
      password: "Passw0rd!",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error(first.error);
    }
    expect(first.user.role).toBe("super_admin");

    const second = await signupPmosUser({
      name: "Team Admin",
      email: "admin@example.com",
      password: "Passw0rd!",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error(second.error);
    }
    expect(second.user.role).toBe("workspace_admin");
  });

  it("creates usable sessions on signup and login", async () => {
    const signup = await signupPmosUser({
      name: "Owner",
      email: "owner@example.com",
      password: "Passw0rd!",
    });
    expect(signup.ok).toBe(true);
    if (!signup.ok) {
      throw new Error(signup.error);
    }

    const sessionFromSignup = await resolvePmosSessionFromToken(signup.sessionToken);
    expect(sessionFromSignup.ok).toBe(true);
    if (!sessionFromSignup.ok) {
      throw new Error(sessionFromSignup.error);
    }
    expect(sessionFromSignup.user.email).toBe("owner@example.com");

    const login = await loginPmosUser({
      email: "owner@example.com",
      password: "Passw0rd!",
    });
    expect(login.ok).toBe(true);
    if (!login.ok) {
      throw new Error(login.error);
    }

    const sessionFromLogin = await resolvePmosSessionFromToken(login.sessionToken);
    expect(sessionFromLogin.ok).toBe(true);
    if (!sessionFromLogin.ok) {
      throw new Error(sessionFromLogin.error);
    }
    expect(sessionFromLogin.user.role).toBe("super_admin");
  });

  it("changes a user password and invalidates old credentials", async () => {
    const signup = await signupPmosUser({
      name: "Owner",
      email: "owner@example.com",
      password: "Passw0rd!",
    });
    expect(signup.ok).toBe(true);
    if (!signup.ok) {
      throw new Error(signup.error);
    }

    const changed = await changePmosUserPassword({
      userId: signup.user.id,
      currentPassword: "Passw0rd!",
      newPassword: "N3wPassw0rd!",
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) {
      throw new Error(changed.error);
    }

    const staleLogin = await loginPmosUser({
      email: "owner@example.com",
      password: "Passw0rd!",
    });
    expect(staleLogin.ok).toBe(false);

    const freshLogin = await loginPmosUser({
      email: "owner@example.com",
      password: "N3wPassw0rd!",
    });
    expect(freshLogin.ok).toBe(true);
    if (!freshLogin.ok) {
      throw new Error(freshLogin.error);
    }

    const oldSession = await resolvePmosSessionFromToken(signup.sessionToken);
    expect(oldSession.ok).toBe(false);
  });

  it("allows super_admin to reset another user's password", async () => {
    const owner = await signupPmosUser({
      name: "Owner",
      email: "owner@example.com",
      password: "Passw0rd!",
    });
    expect(owner.ok).toBe(true);
    if (!owner.ok) {
      throw new Error(owner.error);
    }
    const member = await signupPmosUser({
      name: "Member",
      email: "member@example.com",
      password: "Passw0rd!",
    });
    expect(member.ok).toBe(true);
    if (!member.ok) {
      throw new Error(member.error);
    }

    const reset = await adminResetPmosUserPassword({
      actorUserId: owner.user.id,
      targetEmail: "member@example.com",
      newPassword: "Memb3rN3wPass!",
    });
    expect(reset.ok).toBe(true);
    if (!reset.ok) {
      throw new Error(reset.error);
    }

    const oldLogin = await loginPmosUser({
      email: "member@example.com",
      password: "Passw0rd!",
    });
    expect(oldLogin.ok).toBe(false);

    const newLogin = await loginPmosUser({
      email: "member@example.com",
      password: "Memb3rN3wPass!",
    });
    expect(newLogin.ok).toBe(true);
  });

  it("allows workspace_admin to reset another user in the same workspace only", async () => {
    const owner = await signupPmosUser({
      name: "Owner",
      email: "owner@example.com",
      password: "Passw0rd!",
    });
    expect(owner.ok).toBe(true);
    if (!owner.ok) {
      throw new Error(owner.error);
    }

    const workspaceAdmin = await signupPmosUser({
      name: "Workspace Admin",
      email: "admin@example.com",
      password: "Passw0rd!",
    });
    expect(workspaceAdmin.ok).toBe(true);
    if (!workspaceAdmin.ok) {
      throw new Error(workspaceAdmin.error);
    }

    const teammate = await signupPmosUser({
      name: "Teammate",
      email: "teammate@example.com",
      password: "Passw0rd!",
    });
    expect(teammate.ok).toBe(true);
    if (!teammate.ok) {
      throw new Error(teammate.error);
    }

    const outsider = await signupPmosUser({
      name: "Outsider",
      email: "outsider@example.com",
      password: "Passw0rd!",
    });
    expect(outsider.ok).toBe(true);
    if (!outsider.ok) {
      throw new Error(outsider.error);
    }

    const storePath = path.join(tempDir, "pmos-auth.json");
    const store = JSON.parse(await fs.readFile(storePath, "utf-8")) as {
      users: Array<{ email: string; workspaceId: string }>;
    };
    const adminRow = store.users.find((entry) => entry.email === "admin@example.com");
    const teammateRow = store.users.find((entry) => entry.email === "teammate@example.com");
    expect(adminRow).toBeTruthy();
    expect(teammateRow).toBeTruthy();
    if (!adminRow || !teammateRow) {
      throw new Error("Expected seeded PMOS users to exist.");
    }
    teammateRow.workspaceId = adminRow.workspaceId;
    await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf-8");

    const sameWorkspaceReset = await adminResetPmosUserPassword({
      actorUserId: workspaceAdmin.user.id,
      targetEmail: "teammate@example.com",
      newPassword: "Teammat3N3wPass!",
    });
    expect(sameWorkspaceReset.ok).toBe(true);
    if (!sameWorkspaceReset.ok) {
      throw new Error(sameWorkspaceReset.error);
    }

    const crossWorkspaceReset = await adminResetPmosUserPassword({
      actorUserId: workspaceAdmin.user.id,
      targetEmail: "outsider@example.com",
      newPassword: "Outsid3rN3wPass!",
    });
    expect(crossWorkspaceReset.ok).toBe(false);
    expect(crossWorkspaceReset).toMatchObject({
      status: 403,
      error: "workspace_admin or super_admin role required for this workspace.",
    });
  });
});
