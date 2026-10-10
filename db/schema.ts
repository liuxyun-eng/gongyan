import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  salt: text("salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at").notNull(),
});
export const loginSessions = sqliteTable("login_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => accounts.id),
  expiresAt: integer("expires_at").notNull(),
}, t => [index("login_sessions_user").on(t.userId), index("login_sessions_expiry").on(t.expiresAt)]);
export const authAttempts = sqliteTable("auth_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    ownerId: text("owner_id").notNull(),
    inviteCode: text("invite_code").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("projects_invite_code").on(t.inviteCode)],
);
export const members = sqliteTable(
  "members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    joinedAt: text("joined_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("members_user").on(t.userId),
  ],
);
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    tool: text("tool").notNull(),
    publishedThrough: integer("published_through").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("sessions_project_user").on(t.projectId, t.userId)],
);
export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("messages_session_id").on(t.sessionId, t.id)],
);
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    title: text("title").notNull(),
    status: text("status").notNull().default("open"),
    assignee: text("assignee"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("tasks_project").on(t.projectId)],
);
export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    nextSteps: text("next_steps").notNull().default(""),
    evidenceType: text("evidence_type").notNull().default("待复核"),
    sessionId: text("session_id"),
    startSeq: integer("start_seq"),
    endSeq: integer("end_seq"),
    tool: text("tool"),
    transcript: text("transcript").notNull().default("[]"),
    taskId: text("task_id"),
    fileIds: text("file_ids").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("posts_project_created").on(t.projectId, t.createdAt),
    uniqueIndex("posts_session_start").on(t.sessionId, t.startSeq),
  ],
);
export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    objectKey: text("object_key").notNull(),
    postId: text("post_id").references(() => posts.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("files_project").on(t.projectId)],
);

export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    userId: text("user_id").notNull(),
    requestId: text("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("delivery_request").on(t.projectId, t.userId, t.requestId),
  ],
);

// Historical tables are retained only for migration compatibility; no runtime routes use them.
export const legacyConnections = sqliteTable("codex_connections", {
  id: text("id").primaryKey(), projectId: text("project_id").notNull().references(() => projects.id),
  userId: text("user_id").notNull(), tokenHash: text("token_hash").notNull().unique(),
  createdAt: text("created_at").notNull(), expiresAt: text("expires_at").notNull(), revokedAt: text("revoked_at"),
});
export const legacyCursors = sqliteTable("codex_cursors", {
  projectId: text("project_id").notNull().references(() => projects.id), userId: text("user_id").notNull(),
  threadId: text("thread_id").notNull(), position: integer("position").notNull(), lastKey: text("last_key").notNull(),
}, t => [primaryKey({ columns: [t.projectId, t.userId, t.threadId] })]);
