const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcrypt");
const { query, pool } = require("./db");
const config = require("./config");
const { requireAuth, requireRole, canEdit } = require("./middleware/auth");
const { renderWiki, makeSlug } = require("./services/wikiRenderer");
const wikiService = require("./services/wikiService");
const aiService = require("./services/aiService");

const app = express();
const uploadsDir = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
app.disable("x-powered-by");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.static(path.join(__dirname, "..", "public")));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many login/register attempts. Please wait a bit.",
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many API requests. Slow down for a minute.",
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (_, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safe}`);
    },
  }),
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }
    cb(null, true);
  },
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

function imageToMarkdown(url, originalName, altText, caption) {
  const alt = String(altText || originalName || "image").replace(/\]/g, "");
  const title = caption ? ` "${String(caption).replace(/"/g, "'")}"` : "";
  const imageLine = `![${alt}](${url}${title})`;
  if (!caption) return imageLine;
  return `${imageLine}\n*${caption}*`;
}

app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    secret: config.siteSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);

const csrfExemptPrefixes = ["/api/bot/", "/webhook"];
function isCsrfExempt(pathname) {
  return csrfExemptPrefixes.some((prefix) => pathname.startsWith(prefix));
}

function sameOriginProtection(req, res, next) {
  const unsafe = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (!unsafe || isCsrfExempt(req.path)) {
    return next();
  }

  const origin = req.get("origin");
  const referer = req.get("referer");
  const host = req.get("host");

  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.host !== host) {
        return res.status(403).render("error", {
          title: "Blocked request",
          message: "Cross-site request blocked.",
        });
      }
      return next();
    } catch {
      return res.status(403).render("error", {
        title: "Blocked request",
        message: "Invalid request origin.",
      });
    }
  }

  if (referer) {
    try {
      const parsed = new URL(referer);
      if (parsed.host !== host) {
        return res.status(403).render("error", {
          title: "Blocked request",
          message: "Cross-site request blocked.",
        });
      }
      return next();
    } catch {
      return res.status(403).render("error", {
        title: "Blocked request",
        message: "Invalid request referer.",
      });
    }
  }

  return res.status(403).render("error", {
    title: "Blocked request",
    message: "Missing request origin metadata.",
  });
}

app.use(sameOriginProtection);

app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.canEdit = canEdit(req.session.user);
  res.locals.siteName = config.siteName;
  next();
});

function apiAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== config.botApiToken) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

async function ensureMainPage() {
  const main = await wikiService.getPageBySlug("main-page");
  if (main) return;
  const admin = await query("SELECT id FROM users ORDER BY id ASC LIMIT 1");
  if (!admin.rowCount) return;
  await wikiService.createPage({
    title: "Main Page",
    shortDescription: "Welcome to NARFwiki",
    content:
      "Welcome to **NARFwiki**.\n\n## Getting started\n\nUse the search box to find articles.\n\n[[Category:General]]",
    summary: "Bootstrap main page",
    categories: ["General"],
    userId: admin.rows[0].id,
    source: "web",
  });
}

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  return res.render("login", { error: null });
});

app.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const result = await query(
    "SELECT id, username, role, password_hash FROM users WHERE username = $1",
    [username]
  );
  if (!result.rowCount) {
    return res.status(401).render("login", { error: "Invalid credentials." });
  }
  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).render("login", { error: "Invalid credentials." });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role };
  return res.redirect("/");
});

app.get("/register", (req, res) => {
  if (req.session.user) return res.redirect("/");
  return res.render("register", { error: null, formData: { username: "", inviteCode: "" } });
});

app.post("/register", loginLimiter, async (req, res) => {
  if (req.session.user) return res.redirect("/");
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const inviteCode = String(req.body.inviteCode || "").trim();

  if (!username || !password || !inviteCode) {
    return res.status(400).render("register", {
      error: "Username, password, and invite code are required.",
      formData: { username, inviteCode },
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inviteResult = await client.query(
      `SELECT id, role, used_at, expires_at
       FROM invite_codes
       WHERE code = $1
       FOR UPDATE`,
      [inviteCode]
    );
    if (!inviteResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).render("register", {
        error: "Invalid invite code.",
        formData: { username, inviteCode },
      });
    }
    const invite = inviteResult.rows[0];
    if (invite.used_at) {
      await client.query("ROLLBACK");
      return res.status(400).render("register", {
        error: "Invite code was already used.",
        formData: { username, inviteCode },
      });
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(400).render("register", {
        error: "Invite code has expired.",
        formData: { username, inviteCode },
      });
    }

    const hash = await bcrypt.hash(password, 12);
    const newUser = await client.query(
      "INSERT INTO users (username, role, password_hash) VALUES ($1, $2, $3) RETURNING id, username, role",
      [username, invite.role, hash]
    );

    await client.query(
      "UPDATE invite_codes SET used_at = NOW(), used_by_user_id = $1 WHERE id = $2",
      [newUser.rows[0].id, invite.id]
    );

    await client.query("COMMIT");
    req.session.user = newUser.rows[0];
    return res.redirect("/");
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(400).render("register", {
      error: "Registration failed. Username may already exist.",
      formData: { username, inviteCode },
    });
  } finally {
    client.release();
  }
});

app.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", requireAuth, async (req, res) => {
  const recent = await wikiService.listRecentPages(15);
  return res.render("home", { recent });
});

app.get("/wiki/random", requireAuth, async (req, res) => {
  const slug = await wikiService.randomPageSlug();
  if (!slug) return res.redirect("/");
  return res.redirect(`/wiki/${slug}`);
});

app.get("/wiki/new", requireRole(["admin", "editor"]), (req, res) => {
  res.render("edit", {
    mode: "create",
    page: null,
    preview: null,
    formData: {
      title: "",
      shortDescription: "",
      categories: "",
      content: "",
      summary: "",
    },
  });
});

app.post("/wiki/new", requireRole(["admin", "editor"]), async (req, res) => {
  const { title, shortDescription, categories, content, summary, action } =
    req.body;
  const formData = {
    title,
    shortDescription,
    categories,
    content,
    summary,
  };
  const templateMap = await wikiService.getTemplatesMap();
  if (action === "preview") {
    const preview = renderWiki(content || "", { templateMap });
    return res.render("edit", {
      mode: "create",
      page: null,
      preview,
      formData,
    });
  }
  const existing = await wikiService.getPageBySlug(makeSlug(title));
  if (existing) {
    return res.status(400).render("edit", {
      mode: "create",
      page: null,
      preview: null,
      formData,
      error: "A page with this title already exists.",
    });
  }
  const page = await wikiService.createPage({
    title,
    shortDescription,
    content,
    summary: summary || "Page created",
    categories: (categories || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    userId: req.session.user.id,
  });
  return res.redirect(`/wiki/${page.slug}`);
});

app.get("/wiki/:slug/edit", requireRole(["admin", "editor"]), async (req, res) => {
  const page = await wikiService.getPageBySlug(req.params.slug);
  if (!page) return res.status(404).render("error", { title: "Not found", message: "Page not found." });
  return res.render("edit", {
    mode: "edit",
    page,
    preview: null,
    formData: {
      title: page.title,
      shortDescription: page.short_description || "",
      categories: (page.categories || []).join(", "),
      content: page.current_content || "",
      summary: "",
    },
  });
});

app.post("/wiki/:slug/edit", requireRole(["admin", "editor"]), async (req, res) => {
  const page = await wikiService.getPageBySlug(req.params.slug);
  if (!page) return res.status(404).render("error", { title: "Not found", message: "Page not found." });
  const { title, shortDescription, categories, content, summary, action } =
    req.body;
  const formData = { title, shortDescription, categories, content, summary };
  const templateMap = await wikiService.getTemplatesMap();
  if (action === "preview") {
    const preview = renderWiki(content || "", { templateMap });
    return res.render("edit", {
      mode: "edit",
      page,
      preview,
      formData,
    });
  }
  const updated = await wikiService.updatePage({
    pageId: page.id,
    title,
    shortDescription,
    content,
    summary: summary || "Page updated",
    categories: (categories || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    userId: req.session.user.id,
  });
  return res.redirect(`/wiki/${updated.slug}`);
});

app.post("/wiki/:slug/delete", requireRole(["admin"]), async (req, res) => {
  const page = await wikiService.getPageBySlug(req.params.slug);
  if (!page) return res.status(404).render("error", { title: "Not found", message: "Page not found." });
  await wikiService.deletePage(page.id);
  return res.redirect("/");
});

app.get("/wiki/:slug/history", requireAuth, async (req, res) => {
  const page = await wikiService.getPageBySlug(req.params.slug);
  if (!page) return res.status(404).render("error", { title: "Not found", message: "Page not found." });
  const revisions = await wikiService.getRevisions(page.id);
  res.render("history", { page, revisions });
});

app.get("/wiki/:slug/diff", requireAuth, async (req, res) => {
  const page = await wikiService.getPageBySlug(req.params.slug);
  if (!page) return res.status(404).render("error", { title: "Not found", message: "Page not found." });
  const revA = Number(req.query.a);
  const revB = Number(req.query.b);
  if (!revA || !revB) {
    return res.status(400).render("error", {
      title: "Bad request",
      message: "Provide ?a=<revision>&b=<revision>.",
    });
  }
  const diff = await wikiService.getDiff(page.id, revA, revB);
  if (!diff) {
    return res.status(404).render("error", {
      title: "Not found",
      message: "Could not load revision diff.",
    });
  }
  return res.render("diff", { page, revA, revB, diff });
});

app.get("/wiki/:slug/talk", requireAuth, async (req, res) => {
  const page = await wikiService.getPageBySlug(req.params.slug);
  if (!page) return res.status(404).render("error", { title: "Not found", message: "Page not found." });
  const posts = (await wikiService.getTalkPosts(page.id)).map((post) => ({
    ...post,
    renderedHtml: renderWiki(post.content || "").html,
  }));
  return res.render("talk", { page, posts });
});

app.post("/wiki/:slug/talk", requireRole(["admin", "editor"]), async (req, res) => {
  const page = await wikiService.getPageBySlug(req.params.slug);
  if (!page) return res.status(404).render("error", { title: "Not found", message: "Page not found." });
  if (req.body.content?.trim()) {
    await wikiService.addTalkPost(page.id, req.session.user.id, req.body.content.trim());
  }
  return res.redirect(`/wiki/${page.slug}/talk`);
});

app.get("/wiki/:slug", requireAuth, async (req, res) => {
  const page = await wikiService.getPageBySlug(req.params.slug);
  if (!page) {
    return res.status(404).render("error", {
      title: "Not found",
      message: "Page not found.",
    });
  }
  if (page.redirect_to_slug) {
    return res.redirect(`/wiki/${page.redirect_to_slug}`);
  }

  const templateMap = await wikiService.getTemplatesMap();
  const rendered = renderWiki(page.current_content || "", { templateMap });
  const posts = await wikiService.getTalkPosts(page.id);
  return res.render("page", {
    page,
    rendered,
    talkCount: posts.length,
  });
});

app.get("/search", requireAuth, async (req, res) => {
  const queryText = String(req.query.q || "").trim();
  const results = queryText ? await wikiService.searchPages(queryText) : [];
  return res.render("search", { queryText, results });
});

app.get("/category/:name", requireAuth, async (req, res) => {
  const name = req.params.name;
  const pages = await wikiService.getCategory(name);
  return res.render("category", { name, pages });
});

app.get("/admin/users", requireRole(["admin"]), async (req, res) => {
  const users = await query("SELECT id, username, role, created_at FROM users ORDER BY username");
  const invites = await query(
    `SELECT ic.code, ic.role, ic.created_at, ic.used_at, ic.expires_at,
            creator.username AS created_by_username,
            used.username AS used_by_username
     FROM invite_codes ic
     LEFT JOIN users creator ON creator.id = ic.created_by_user_id
     LEFT JOIN users used ON used.id = ic.used_by_user_id
     ORDER BY ic.created_at DESC
     LIMIT 50`
  );
  const createdCode = String(req.query.created || "").trim() || null;
  return res.render("users", {
    users: users.rows,
    invites: invites.rows,
    error: null,
    createdCode,
  });
});

app.post("/admin/invites", requireRole(["admin"]), async (req, res) => {
  const role = String(req.body.role || "reader");
  const expiresAt = String(req.body.expiresAt || "").trim();
  const customCode = String(req.body.code || "").trim();
  const code =
    customCode ||
    `NARF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  try {
    await query(
      `INSERT INTO invite_codes (code, role, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [code, role, req.session.user.id, expiresAt || null]
    );
  } catch (error) {
    const users = await query("SELECT id, username, role, created_at FROM users ORDER BY username");
    const invites = await query(
      `SELECT ic.code, ic.role, ic.created_at, ic.used_at, ic.expires_at,
              creator.username AS created_by_username,
              used.username AS used_by_username
       FROM invite_codes ic
       LEFT JOIN users creator ON creator.id = ic.created_by_user_id
       LEFT JOIN users used ON used.id = ic.used_by_user_id
       ORDER BY ic.created_at DESC
       LIMIT 50`
    );
    return res
      .status(400)
      .render("users", {
        users: users.rows,
        invites: invites.rows,
        error: "Invite create failed. Code may already exist.",
        createdCode: null,
      });
  }
  return res.redirect(`/admin/users?created=${encodeURIComponent(code)}`);
});

app.post("/api/ai/rewrite-selection", requireRole(["admin", "editor"]), apiLimiter, async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();
    const task = String(req.body.task || "proofread").trim().toLowerCase();
    if (!text) {
      return res.status(400).json({ error: "Text is required." });
    }
    if (!["proofread", "grammar"].includes(task)) {
      return res.status(400).json({ error: "Invalid task." });
    }
    const result = await aiService.rewriteSelection(text, task);
    return res.json({ ok: true, result });
  } catch (error) {
    console.error("AI rewrite error:", error);
    return res.status(500).json({ error: "AI rewrite failed." });
  }
});

app.post("/api/ai/generate-article", requireRole(["admin", "editor"]), apiLimiter, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const notes = String(req.body.notes || "").trim();
    const shortDescription = String(req.body.shortDescription || "").trim();
    if (!notes) {
      return res.status(400).json({ error: "Notes are required." });
    }
    const content = await aiService.generateArticle({
      title,
      notes,
      shortDescription,
    });
    return res.json({ ok: true, content });
  } catch (error) {
    console.error("AI generation error:", error);
    return res.status(500).json({ error: "AI generation failed." });
  }
});

app.post("/api/ai/article-chat", requireAuth, apiLimiter, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const content = String(req.body.content || "").trim();
    const question = String(req.body.question || "").trim();
    if (!content || !question) {
      return res.status(400).json({ error: "Article content and question are required." });
    }
    if (question.length > 1200) {
      return res.status(400).json({ error: "Question is too long." });
    }
    const safeContent = content.slice(0, 60000);
    const answer = await aiService.answerArticleQuestion({
      title: title || "Untitled article",
      content: safeContent,
      question,
    });
    return res.json({ ok: true, answer });
  } catch (error) {
    console.error("Article chat error:", error);
    return res.status(500).json({ error: "Article chat failed." });
  }
});

app.post(
  "/api/media/upload",
  requireRole(["admin", "editor"]),
  apiLimiter,
  (req, res, next) => {
    upload.array("images", 12)(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || "Upload failed." });
      }
      return next();
    });
  },
  async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: "No images uploaded." });
    }

    const altText = String(req.body.altText || "").trim();
    const caption = String(req.body.caption || "").trim();
    const uploaded = [];

    for (const file of files) {
      await query(
        `INSERT INTO media_uploads (filename, original_name, mime_type, file_size, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          file.filename,
          file.originalname,
          file.mimetype,
          file.size,
          req.session.user.id,
        ]
      );
      const url = `/media/${file.filename}`;
      uploaded.push({
        filename: file.filename,
        originalName: file.originalname,
        url,
        markdown: imageToMarkdown(url, file.originalname, altText, caption),
      });
    }

    return res.json({ ok: true, files: uploaded });
  }
);

app.get("/api/media/list", requireRole(["admin", "editor"]), apiLimiter, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 80), 1), 200);
  const rows = await query(
    `SELECT m.id, m.filename, m.original_name, m.mime_type, m.file_size, m.created_at, u.username
     FROM media_uploads m
     LEFT JOIN users u ON u.id = m.uploaded_by_user_id
     ORDER BY m.created_at DESC
     LIMIT $1`,
    [limit]
  );
  const files = rows.rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    createdAt: row.created_at,
    uploadedBy: row.username || "unknown",
    url: `/media/${row.filename}`,
    markdown: imageToMarkdown(`/media/${row.filename}`, row.original_name),
  }));
  return res.json({ ok: true, files });
});

app.get("/media/:filename", requireAuth, (req, res) => {
  const safeName = path.basename(String(req.params.filename || ""));
  if (!safeName || safeName !== req.params.filename) {
    return res.status(400).send("Invalid file path.");
  }
  const filePath = path.join(uploadsDir, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found.");
  }
  return res.sendFile(filePath);
});

// Bot API
app.get("/api/bot/read", apiAuth, async (req, res) => {
  const title = String(req.query.title || "");
  const page = await wikiService.getPageByTitle(title);
  if (!page) return res.status(404).json({ error: "Page not found" });
  return res.json({
    title: page.title,
    slug: page.slug,
    content: page.current_content || "",
    categories: page.categories || [],
    updatedAt: page.updated_at,
  });
});

app.get("/api/bot/search", apiAuth, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ results: [] });
  const results = await wikiService.searchPages(q);
  return res.json({ results });
});

app.get("/api/bot/history", apiAuth, async (req, res) => {
  const title = String(req.query.title || "");
  const page = await wikiService.getPageByTitle(title);
  if (!page) return res.status(404).json({ error: "Page not found" });
  const revisions = await wikiService.getRevisions(page.id);
  return res.json({ title: page.title, revisions });
});

app.get("/api/bot/diff", apiAuth, async (req, res) => {
  const title = String(req.query.title || "");
  const page = await wikiService.getPageByTitle(title);
  if (!page) return res.status(404).json({ error: "Page not found" });
  const revA = Number(req.query.revA);
  const revB = Number(req.query.revB);
  const diff = await wikiService.getDiff(page.id, revA, revB);
  if (!diff) return res.status(404).json({ error: "Diff not found" });
  return res.json({ title: page.title, diff });
});

app.get("/api/bot/categories", apiAuth, async (req, res) => {
  const title = String(req.query.title || "");
  const page = await wikiService.getPageByTitle(title);
  if (!page) return res.status(404).json({ error: "Page not found" });
  return res.json({ title: page.title, categories: page.categories || [] });
});

app.post("/api/bot/create", apiAuth, async (req, res) => {
  const { title, content, summary, userId = null } = req.body;
  const existing = await wikiService.getPageByTitle(title);
  if (existing) return res.status(400).json({ error: "Page already exists" });
  const fallbackUser = await query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const page = await wikiService.createPage({
    title,
    shortDescription: "",
    content,
    summary: summary || "WhatsApp update",
    categories: [],
    userId: userId || fallbackUser.rows[0]?.id || null,
    source: "whatsapp",
  });
  return res.json({ ok: true, page });
});

app.post("/api/bot/update", apiAuth, async (req, res) => {
  const { title, content, summary, mode = "replace", userId = null } = req.body;
  const page = await wikiService.getPageByTitle(title);
  if (!page) return res.status(404).json({ error: "Page not found" });
  const fallbackUser = await query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const updatedContent =
    mode === "append" ? `${page.current_content || ""}\n\n${content}` : content;
  const updated = await wikiService.updatePage({
    pageId: page.id,
    title: page.title,
    shortDescription: page.short_description || "",
    content: updatedContent,
    summary: summary || "WhatsApp update",
    categories: page.categories || [],
    userId: userId || fallbackUser.rows[0]?.id || null,
    source: "whatsapp",
  });
  return res.json({ ok: true, page: updated });
});

app.post("/api/bot/delete", apiAuth, async (req, res) => {
  const { title } = req.body;
  const page = await wikiService.getPageByTitle(title);
  if (!page) return res.status(404).json({ error: "Page not found" });
  await wikiService.deletePage(page.id);
  return res.json({ ok: true });
});

app.post("/api/bot/setcategory", apiAuth, async (req, res) => {
  const { title, category, userId = null } = req.body;
  const page = await wikiService.getPageByTitle(title);
  if (!page) return res.status(404).json({ error: "Page not found" });
  const fallbackUser = await query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const categories = Array.from(new Set([...(page.categories || []), category]));
  const updated = await wikiService.updatePage({
    pageId: page.id,
    title: page.title,
    shortDescription: page.short_description || "",
    content: page.current_content || "",
    summary: "WhatsApp category update",
    categories,
    userId: userId || fallbackUser.rows[0]?.id || null,
    source: "whatsapp",
  });
  return res.json({ ok: true, categories: updated.categories });
});

app.use((_, res) => {
  res.status(404).render("error", {
    title: "Not found",
    message: "Page not found.",
  });
});

async function start() {
  await ensureMainPage();
  app.listen(config.port, () => {
    console.log(`${config.siteName} web listening on port ${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
