import {
  AppError,
  db,
  bucket,
  identity,
  membership,
  ownSession,
  text,
  body,
  checkOrigin,
  limitedBytes,
  now,
  id,
  json,
} from "@/lib/server";
import { handleMarkdownShare, digest } from "@/lib/markdown-share";
import { sharedTranscript, sharedMarkdown } from "@/lib/shared-transcript.mjs";
import { excerptSummary } from "@/lib/conversations";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/api\//, "").split("/");
    const action = parts[0];
    const itemId = parts[1];
    const user = await identity();
    if (request.method !== "GET") checkOrigin(request);
    if (action === "markdown-share" && request.method === "POST") {
      const projectId = text(url.searchParams.get("projectId"), "工作区", 100);
      await membership(projectId, user.userId);
      return handleMarkdownShare(request, {
        project_id: projectId,
        user_id: user.userId,
      }, itemId);
    }
    if (action === "posts" && itemId && parts.length === 2 && request.method === "DELETE") {
      const post = await db().prepare("SELECT * FROM posts WHERE id=?").bind(itemId).first<any>();
      if (!post) throw new AppError("共享对话不存在。", 404);
      await membership(post.project_id, user.userId);
      if (post.user_id !== user.userId) throw new AppError("只能删除自己上传的共享对话。", 403);
      if (post.kind === "deleted") return json({ postId: itemId, deleted: true });
      const input = await body(request);
      if (input.revision !== await digest(post.transcript)) throw new AppError("这条对话已更新，请刷新后再删除。", 409);
      // Keep only a receipt tombstone so a lost upload response cannot republish deleted content.
      // Both statements use the same version guard and run in one transaction; file bytes remain intact.
      const results = await db().batch([
        db().prepare("UPDATE files SET post_id=NULL WHERE post_id=? AND EXISTS (SELECT 1 FROM posts WHERE id=? AND user_id=? AND transcript=? AND kind<>'deleted')").bind(itemId, itemId, user.userId, post.transcript),
        db().prepare("UPDATE posts SET kind='deleted',title='',summary='',next_steps='',transcript='[]',file_ids='[]',tool=NULL,task_id=NULL WHERE id=? AND user_id=? AND transcript=? AND kind<>'deleted'").bind(itemId, user.userId, post.transcript),
      ]);
      if (!results[1].meta.changes) throw new AppError("对话刚被其他页面修改，请刷新后再删除。", 409);
      return json({ postId: itemId, deleted: true });
    }
    if (action === "posts" && itemId && parts[2] === "messages" && request.method === "DELETE") {
      const post = await db().prepare("SELECT * FROM posts WHERE id=?").bind(itemId).first<any>();
      if (!post || post.kind === "deleted") throw new AppError("共享对话不存在。", 404);
      const member = await membership(post.project_id, user.userId);
      if (post.user_id !== user.userId && member.role !== "owner") throw new AppError("只能删除自己发布的对话，工作区创建者可以管理全部内容。", 403);
      const input = await body(request);
      if (input.revision !== await digest(post.transcript)) throw new AppError("这段对话已更新，请刷新后再删除。", 409);
      const messages = sharedTranscript(post);
      if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= messages.length) throw new AppError("这段消息已不存在，请刷新。", 409);
      const references = messages[0]?.references;
      const deletedTitle = messages[input.index].content.split("\n")[0].replace(/^[#\s]+/, "").slice(0, 150);
      const title = post.title === deletedTitle ? "共享对话" : post.title;
      const remaining = messages.filter((_, index) => index !== input.index).map(({ sourceMarkdown, references, snapshotVersion, ...message }) => message);
      if (remaining.length) Object.assign(remaining[0], { sourceMarkdown: sharedMarkdown(title, remaining), references, snapshotVersion: 2 });
      const transcript = JSON.stringify(remaining), summary = excerptSummary(remaining as any);
      const result = await db().prepare("UPDATE posts SET transcript=?,summary=?,title=? WHERE id=? AND transcript=?").bind(transcript, summary, title, itemId, post.transcript).run();
      if (!result.meta.changes) throw new AppError("对话刚被其他页面修改，请刷新后再删除。", 409);
      return json({ postId: itemId, transcript, summary, title });
    }
    if (action === "projects" && request.method === "GET") {
      const rows = await db()
        .prepare(
          "SELECT p.id,p.name,p.description,p.owner_id,p.created_at FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=? ORDER BY p.created_at DESC",
        )
        .bind(user.userId)
        .all();
      return json({ projects: rows.results });
    }
    if (action === "projects" && request.method === "POST") {
      const input = await body(request);
      const pid = id();
      const code = id().replaceAll("-", "");
      const date = now();
      await db().batch([
        db()
          .prepare(
            "INSERT INTO projects(id,name,description,owner_id,invite_code,created_at) VALUES (?,?,?,?,?,?)",
          )
          .bind(
            pid,
            text(input.name, "项目名称", 100),
            text(input.description || "", "项目说明", 3000, false),
            user.userId,
            code,
            date,
          ),
        db()
          .prepare(
            "INSERT INTO members(project_id,user_id,name,role,joined_at) VALUES (?,?,?,?,?)",
          )
          .bind(pid, user.userId, user.name, "owner", date),
      ]);
      return json({ id: pid }, 201);
    }
    if (action === "join" && request.method === "POST") {
      const input = await body(request);
      const code = text(input.code, "邀请码", 100);
      const project = await db()
        .prepare("SELECT id FROM projects WHERE invite_code=?")
        .bind(code)
        .first<any>();
      if (!project) throw new AppError("邀请码无效。", 404);
      await db()
        .prepare(
          "INSERT OR IGNORE INTO members(project_id,user_id,name,role,joined_at) VALUES (?,?,?,?,?)",
        )
        .bind(project.id, user.userId, user.name, "member", now())
        .run();
      return json({ id: project.id });
    }
    if (action === "room" && request.method === "GET") {
      const pid = url.searchParams.get("projectId") || "";
      await membership(pid, user.userId);
      const [project, members, tasks, sessions, posts, files] =
        await Promise.all([
          db().prepare("SELECT * FROM projects WHERE id=?").bind(pid).first(),
          db()
            .prepare(
              "SELECT user_id,name,role FROM members WHERE project_id=? ORDER BY joined_at",
            )
            .bind(pid)
            .all(),
          db()
            .prepare(
              "SELECT t.*,m.name AS assignee_name FROM tasks t LEFT JOIN members m ON m.project_id=t.project_id AND m.user_id=t.assignee WHERE t.project_id=? ORDER BY t.created_at DESC",
            )
            .bind(pid)
            .all(),
          db()
            .prepare(
              "SELECT s.*, (SELECT count(*) FROM messages m WHERE m.session_id=s.id AND m.id>s.published_through) AS pending_count FROM sessions s WHERE s.project_id=? AND s.user_id=? ORDER BY s.created_at DESC",
            )
            .bind(pid, user.userId)
            .all(),
          db()
            .prepare(
              "SELECT p.*,m.name AS author FROM posts p LEFT JOIN members m ON m.project_id=p.project_id AND m.user_id=p.user_id WHERE p.project_id=? AND p.kind<>'deleted' ORDER BY p.created_at DESC LIMIT 100",
            )
            .bind(pid)
            .all(),
          db()
            .prepare(
                "SELECT f.id,f.name,f.size,f.created_at,f.post_id,m.name AS author FROM files f LEFT JOIN members m ON m.project_id=f.project_id AND m.user_id=f.user_id WHERE f.project_id=? ORDER BY f.created_at DESC LIMIT 5000",
            )
            .bind(pid)
            .all(),
        ]);
      return json({
        project,
        members: members.results,
        tasks: tasks.results,
        sessions: sessions.results,
        posts: posts.results,
        files: files.results,
      });
    }
    if (action === "sessions" && request.method === "POST") {
      const input = await body(request);
      const pid = text(input.projectId, "项目", 100);
      await membership(pid, user.userId);
      const sid = id();
      await db()
        .prepare(
          "INSERT INTO sessions(id,project_id,user_id,title,tool,created_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          sid,
          pid,
          user.userId,
          text(input.title, "对话名称", 150),
          text(input.tool, "AI 工具", 80),
          now(),
        )
        .run();
      return json({ id: sid }, 201);
    }
    if (action === "messages" && request.method === "GET") {
      const session = await ownSession(
        url.searchParams.get("sessionId") || "",
        user.userId,
      );
      const rows = await db()
        .prepare(
          "SELECT * FROM messages WHERE session_id=? ORDER BY id LIMIT 1000",
        )
        .bind(session.id)
        .all();
      return json({ session, messages: rows.results });
    }
    if (action === "messages" && request.method === "POST") {
      const input = await body(request);
      const session = await ownSession(
        text(input.sessionId, "对话", 100),
        user.userId,
      );
      if (
        !Array.isArray(input.messages) ||
        !input.messages.length ||
        input.messages.length > 100
      )
        throw new AppError("每次可录入 1—100 条消息。");
      const count = await db()
        .prepare("SELECT count(*) AS n FROM messages WHERE session_id=?")
        .bind(session.id)
        .first<any>();
      if (count.n + input.messages.length > 1000)
        throw new AppError("这段对话已达到 1000 条，请新建会话。");
      const entries = input.messages.map((m: any) => {
        if (m.role !== "user" && m.role !== "assistant")
          throw new AppError("消息角色不正确。");
        return db()
          .prepare(
            "INSERT INTO messages(session_id,role,content,created_at) VALUES (?,?,?,?)",
          )
          .bind(session.id, m.role, text(m.content, "消息", 20_000), now());
      });
      await db().batch(entries);
      return json({ added: entries.length });
    }
    if (action === "publish" && request.method === "POST") {
      const input = await body(request);
      const session = await ownSession(
        text(input.sessionId, "对话", 100),
        user.userId,
      );
      if (input.start !== session.published_through)
        throw new AppError("这段对话已在其他页面发布，请刷新后重新预览。", 409);
      if (
        !Number.isSafeInteger(input.end) ||
        input.end <= session.published_through
      )
        throw new AppError("没有可发布的新对话。");
      const rows = (
        await db()
          .prepare(
            "SELECT id,role,content,created_at FROM messages WHERE session_id=? AND id>? AND id<=? ORDER BY id",
          )
          .bind(session.id, input.start, input.end)
          .all<any>()
      ).results;
      if (!rows.length || rows.at(-1)?.id !== input.end)
        throw new AppError("发布范围无效，请重新预览。");
      if (
        !Array.isArray(input.messages) ||
        !input.messages.length ||
        input.messages.length > rows.length
      )
        throw new AppError("请至少选择一条新消息。");
      const allowed = new Map(rows.map((m) => [m.id, m]));
      const seen = new Set<number>();
      const transcript = input.messages
        .map((m: any) => {
          const original = allowed.get(m.id);
          if (!original || seen.has(m.id))
            throw new AppError("消息范围重复或无效。");
          seen.add(m.id);
          return {
            id: m.id,
            role: original.role,
            content: text(m.content, "对话", 20_000),
            created_at: original.created_at,
          };
        })
        .sort((a: any, b: any) => a.id - b.id);
      const fileIds = input.fileIds || [];
      if (
        !Array.isArray(fileIds) ||
        fileIds.length > 10 ||
        fileIds.some((x: any) => typeof x !== "string")
      )
        throw new AppError("附件格式不正确。");
      for (const fid of fileIds) {
        const file = await db()
          .prepare("SELECT id FROM files WHERE id=? AND project_id=?")
          .bind(fid, session.project_id)
          .first();
        if (!file) throw new AppError("附件不属于这个项目。");
      }
      const taskId = input.taskId || null;
      if (
        taskId &&
        !(await db()
          .prepare("SELECT id FROM tasks WHERE id=? AND project_id=?")
          .bind(taskId, session.project_id)
          .first())
      )
        throw new AppError("关联任务不存在。");
      const evidence = text(input.evidenceType || "待复核", "成果类型", 20);
      if (!["实测记录", "仿真结果", "AI 推断", "待复核"].includes(evidence))
        throw new AppError("成果类型不正确。");
      const postId = id();
      await db().batch([
        db()
          .prepare(
            "INSERT INTO posts(id,project_id,user_id,kind,title,summary,next_steps,evidence_type,session_id,start_seq,end_seq,tool,transcript,task_id,file_ids,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            postId,
            session.project_id,
            user.userId,
            "progress",
            text(input.title, "进度标题", 150),
            text(input.summary || "", "进度摘要", 6000, false),
            text(input.nextSteps || "", "待解决事项", 3000, false),
            evidence,
            session.id,
            input.start,
            input.end,
            session.tool,
            JSON.stringify(transcript),
            taskId,
            JSON.stringify(fileIds),
            now(),
          ),
        db()
          .prepare(
            "UPDATE sessions SET published_through=? WHERE id=? AND published_through=?",
          )
          .bind(input.end, session.id, input.start),
      ]);
      return json({ id: postId, published: transcript.length }, 201);
    }
    if (action === "posts" && request.method === "POST") {
      const input = await body(request);
      await membership(text(input.projectId, "项目", 100), user.userId);
      await db()
        .prepare(
          "INSERT INTO posts(id,project_id,user_id,kind,title,summary,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          id(),
          input.projectId,
          user.userId,
          "message",
          "团队讨论",
          text(input.content, "消息", 5000),
          now(),
        )
        .run();
      return json({ ok: true });
    }
    if (action === "tasks" && request.method === "POST") {
      const input = await body(request);
      await membership(text(input.projectId, "项目", 100), user.userId);
      await db()
        .prepare(
          "INSERT INTO tasks(id,project_id,title,created_at) VALUES (?,?,?,?)",
        )
        .bind(id(), input.projectId, text(input.title, "任务名称", 150), now())
        .run();
      return json({ ok: true });
    }
    if (action === "tasks" && itemId && request.method === "PATCH") {
      const input = await body(request);
      const task = await db()
        .prepare("SELECT * FROM tasks WHERE id=?")
        .bind(itemId)
        .first<any>();
      if (!task) throw new AppError("任务不存在。", 404);
      const member = await membership(task.project_id, user.userId);
      if (input.action === "claim") {
        const result = await db()
          .prepare(
            "UPDATE tasks SET assignee=?,status=? WHERE id=? AND assignee IS NULL AND status=?",
          )
          .bind(user.userId, "doing", itemId, "open")
          .run();
        if (!result.meta.changes)
          throw new AppError("任务已被领取，请刷新查看负责人。", 409);
      } else if (input.action === "complete") {
        if (task.assignee !== user.userId && member.role !== "owner")
          throw new AppError("只有负责人或组长可以完成任务。", 403);
        await db()
          .prepare("UPDATE tasks SET status=? WHERE id=?")
          .bind("done", itemId)
          .run();
      } else throw new AppError("操作不正确。");
      return json({ ok: true });
    }
    if (action === "files" && request.method === "POST") {
      const pid = url.searchParams.get("projectId") || "";
      await membership(pid, user.userId);
      const name = text(url.searchParams.get("name"), "文件名称", 200);
      const bytes = await limitedBytes(request, 10 * 1024 * 1024);
      if (!bytes.length) throw new AppError("文件为空。");
      const fid = id();
      const objectKey = pid + "/" + fid;
      await bucket().put(objectKey, bytes, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      try {
        await db()
          .prepare(
            "INSERT INTO files(id,project_id,user_id,name,size,object_key,created_at) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(fid, pid, user.userId, name, bytes.length, objectKey, now())
          .run();
      } catch (error) {
        await bucket().delete(objectKey);
        throw error;
      }
      return json({ id: fid, name, size: bytes.length }, 201);
    }
    if (action === "files" && itemId && request.method === "GET") {
      const file = await db()
        .prepare("SELECT * FROM files WHERE id=?")
        .bind(itemId)
        .first<any>();
      if (!file) throw new AppError("附件不存在。", 404);
      await membership(file.project_id, user.userId);
      if (parts[2] === "context") {
        const post = file.post_id
          ? await db()
              .prepare(
                "SELECT p.*,m.name AS author FROM posts p LEFT JOIN members m ON m.project_id=p.project_id AND m.user_id=p.user_id WHERE p.id=? AND p.project_id=? AND p.kind<>'deleted'",
              )
              .bind(file.post_id, file.project_id)
              .first()
          : null;
        return json({ post });
      }
      const storage = bucket() as unknown as { signedDownload?: (key: string, name: string) => Promise<string> };
      if (storage.signedDownload) return new Response(null, { status:302, headers:{ Location:await storage.signedDownload(file.object_key,file.name), "Cache-Control":"private, no-store", "Referrer-Policy":"no-referrer" } });
      const object = await bucket().get(file.object_key);
      if (!object) throw new AppError("附件暂时不可用。", 404);
      return new Response(object.body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition":
            "attachment; filename=\"download\"; filename*=UTF-8''" +
            encodeURIComponent(file.name),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    throw new AppError("未找到这个操作。", 404);
  } catch (error) {
    if (error instanceof AppError)
      return json({ error: error.message }, error.status);
    console.error("gongyan API error", error);
    if (String(error).includes("UNIQUE constraint failed: posts.session_id"))
      return json({ error: "这段进度已经发布，请刷新。" }, 409);
    return json({ error: "保存或读取失败，输入仍然保留，请稍后重试。" }, 503);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
