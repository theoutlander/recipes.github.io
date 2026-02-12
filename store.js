import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function initStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_FILE)) {
    const seed = {
      users: [],
      sessions: [],
      recipes: [],
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(seed, null, 2));
  }
}

export function createUser({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const safeName = sanitizeName(name);
  const safePassword = sanitizePassword(password);
  if (!normalizedEmail || !safePassword) {
    throw new Error("Email and password are required.");
  }
  if (safePassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const store = readStore();
  const existing = store.users.find((user) => user.email === normalizedEmail);
  if (existing) {
    throw new Error("An account with that email already exists.");
  }

  const passwordHash = hashPassword(safePassword);
  const user = {
    id: buildId(),
    name: safeName || "Home Cook",
    email: normalizedEmail,
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  store.users.push(user);
  writeStore(store);
  return omitSensitiveUser(user);
}

export function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const safePassword = sanitizePassword(password);
  if (!normalizedEmail || !safePassword) {
    throw new Error("Email and password are required.");
  }

  const store = readStore();
  const user = store.users.find((candidate) => candidate.email === normalizedEmail);
  if (!user || !verifyPassword(safePassword, user.passwordHash)) {
    throw new Error("Invalid email or password.");
  }
  return omitSensitiveUser(user);
}

export function createSession(userId) {
  const store = readStore();
  cleanupExpiredSessions(store);
  const session = {
    token: buildSessionToken(),
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  store.sessions.push(session);
  writeStore(store);
  return session;
}

export function revokeSession(token) {
  if (!token) {
    return;
  }
  const store = readStore();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((session) => session.token !== token);
  if (store.sessions.length !== before) {
    writeStore(store);
  }
}

export function getUserByToken(token) {
  if (!token) {
    return null;
  }

  const store = readStore();
  cleanupExpiredSessions(store);
  const session = store.sessions.find((candidate) => candidate.token === token);
  if (!session) {
    writeStore(store);
    return null;
  }
  const user = store.users.find((candidate) => candidate.id === session.userId);
  if (!user) {
    store.sessions = store.sessions.filter((candidate) => candidate.token !== token);
    writeStore(store);
    return null;
  }
  writeStore(store);
  return omitSensitiveUser(user);
}

export function listRecipesByUser(userId) {
  const store = readStore();
  return store.recipes
    .filter((record) => record.userId === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((record) => record.data);
}

export function saveRecipeForUser(userId, recipe) {
  if (!recipe || typeof recipe !== "object") {
    throw new Error("Recipe payload is required.");
  }

  const safeRecipe = JSON.parse(JSON.stringify(recipe));
  const now = new Date().toISOString();
  if (!safeRecipe.meta || typeof safeRecipe.meta !== "object") {
    safeRecipe.meta = {};
  }
  if (!safeRecipe.meta.id) {
    safeRecipe.meta.id = buildId();
  }
  safeRecipe.meta.updatedAt = now;
  if (!safeRecipe.meta.createdAt) {
    safeRecipe.meta.createdAt = now;
  }

  const store = readStore();
  const existingIndex = store.recipes.findIndex(
    (record) => record.userId === userId && record.id === safeRecipe.meta.id
  );

  if (existingIndex >= 0) {
    const existing = store.recipes[existingIndex];
    store.recipes[existingIndex] = {
      ...existing,
      data: safeRecipe,
      updatedAt: now,
    };
  } else {
    store.recipes.push({
      id: safeRecipe.meta.id,
      userId,
      createdAt: now,
      updatedAt: now,
      data: safeRecipe,
    });
  }

  writeStore(store);
  return safeRecipe;
}

export function deleteRecipeForUser(userId, recipeId) {
  if (!recipeId) {
    throw new Error("Recipe id is required.");
  }
  const store = readStore();
  const before = store.recipes.length;
  store.recipes = store.recipes.filter((record) => !(record.userId === userId && record.id === recipeId));
  const deleted = store.recipes.length !== before;
  if (deleted) {
    writeStore(store);
  }
  return deleted;
}

function readStore() {
  initStore();
  const raw = fs.readFileSync(STORE_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [],
    };
  } catch {
    return { users: [], sessions: [], recipes: [] };
  }
}

function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function cleanupExpiredSessions(store) {
  const now = Date.now();
  store.sessions = store.sessions.filter((session) => {
    const expiresAt = Date.parse(session.expiresAt || "");
    return Number.isFinite(expiresAt) && expiresAt > now;
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, hashValue) {
  const [salt, expectedHash] = String(hashValue || "").split(":");
  if (!salt || !expectedHash) {
    return false;
  }
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const actualBuffer = Buffer.from(actualHash, "hex");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function buildSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function buildId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return "";
  }
  const email = value.trim().toLowerCase();
  if (!email.includes("@")) {
    return "";
  }
  return email;
}

function sanitizeName(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, 80);
}

function sanitizePassword(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function omitSensitiveUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
  };
}
