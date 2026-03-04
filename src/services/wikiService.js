const { diffLines } = require("diff");
const sanitizeHtml = require("sanitize-html");
const { query } = require("../db");
const { makeSlug, extractCategories, parseRedirect } = require("./wikiRenderer");

async function getTemplatesMap() {
  const result = await query(
    "SELECT title, p.slug, r.content FROM pages p LEFT JOIN revisions r ON r.id = p.current_revision_id WHERE p.title ILIKE 'Template:%'"
  );
  const map = {};
  for (const row of result.rows) {
    const key = row.title.replace(/^Template:/i, "").trim();
    map[key] = row.content || "";
  }
  return map;
}

async function getPageBySlug(slug) {
  const pageResult = await query(
    `SELECT p.*, u.username AS created_by_username, r.content AS current_content
     FROM pages p
     LEFT JOIN users u ON u.id = p.created_by_user_id
     LEFT JOIN revisions r ON r.id = p.current_revision_id
     WHERE p.slug = $1`,
    [slug]
  );
  if (!pageResult.rowCount) return null;
  const page = pageResult.rows[0];

  const categoryResult = await query(
    `SELECT c.name FROM categories c
     JOIN page_categories pc ON pc.category_id = c.id
     WHERE pc.page_id = $1
     ORDER BY c.name`,
    [page.id]
  );

  return {
    ...page,
    categories: categoryResult.rows.map((row) => row.name),
  };
}

async function getPageByTitle(title) {
  return getPageBySlug(makeSlug(title));
}

async function listRecentPages(limit = 25) {
  const result = await query(
    `SELECT p.title, p.slug, p.updated_at
     FROM pages p
     ORDER BY p.updated_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function searchPages(term) {
  const like = `%${term}%`;
  const result = await query(
    `WITH q AS (
       SELECT plainto_tsquery('english', $1) AS tsq
     )
     SELECT
       p.title,
       p.slug,
       p.updated_at,
       r.content,
       (p.title ILIKE $2) AS title_match,
       ts_rank_cd(
         COALESCE(p.search_document, to_tsvector('english', COALESCE(p.title, ''))),
         q.tsq
       ) AS rank,
       ts_headline(
         'english',
         COALESCE(r.content, ''),
         q.tsq,
         'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MinWords=6,MaxWords=24,FragmentDelimiter= ... '
       ) AS highlighted_snippet
     FROM pages p
     LEFT JOIN revisions r ON r.id = p.current_revision_id
     CROSS JOIN q
     WHERE
       (q.tsq <> ''::tsquery AND p.search_document @@ q.tsq)
       OR p.title ILIKE $2
       OR r.content ILIKE $2
     ORDER BY title_match DESC, rank DESC, p.updated_at DESC
     LIMIT 50`,
    [term, like]
  );

  return result.rows.map((row) => {
    const fallback = (row.content || "").slice(0, 220);
    const highlightedSnippet = sanitizeHtml(
      row.highlighted_snippet || fallback,
      {
        allowedTags: ["mark"],
        allowedAttributes: {},
      }
    );
    return {
      ...row,
      snippet: fallback,
      highlightedSnippet,
    };
  });
}

async function updateSearchDocument(pageId, title, shortDescription, content) {
  await query(
    `UPDATE pages
     SET search_document =
       setweight(to_tsvector('english', COALESCE($1, '')), 'A') ||
       setweight(to_tsvector('english', COALESCE($2, '')), 'B') ||
       setweight(to_tsvector('english', COALESCE($3, '')), 'C')
     WHERE id = $4`,
    [title || "", shortDescription || "", content || "", pageId]
  );
}

async function upsertCategories(pageId, content, explicitCategories = []) {
  const fromContent = extractCategories(content);
  const names = Array.from(new Set([...explicitCategories, ...fromContent]));
  await query("DELETE FROM page_categories WHERE page_id = $1", [pageId]);
  for (const name of names) {
    const cleaned = name.trim();
    if (!cleaned) continue;
    const category = await query(
      "INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id",
      [cleaned]
    );
    await query(
      "INSERT INTO page_categories (page_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [pageId, category.rows[0].id]
    );
  }
}

async function createPage({
  title,
  shortDescription,
  content,
  summary,
  categories,
  userId,
  source = "web",
}) {
  const slug = makeSlug(title);
  const redirectToSlug = parseRedirect(content);
  const pageResult = await query(
    `INSERT INTO pages (title, slug, short_description, redirect_to_slug, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [title, slug, shortDescription || null, redirectToSlug, userId]
  );
  const page = pageResult.rows[0];

  const revisionResult = await query(
    `INSERT INTO revisions (page_id, content, summary, created_by_user_id, source)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [page.id, content, summary || "Initial creation", userId, source]
  );
  const revision = revisionResult.rows[0];

  await query(
    "UPDATE pages SET current_revision_id = $1, updated_at = NOW() WHERE id = $2",
    [revision.id, page.id]
  );
  await updateSearchDocument(page.id, title, shortDescription, content);
  await upsertCategories(page.id, content, categories || []);
  return getPageBySlug(slug);
}

async function updatePage({
  pageId,
  title,
  shortDescription,
  content,
  summary,
  categories,
  userId,
  source = "web",
}) {
  const slug = makeSlug(title);
  const redirectToSlug = parseRedirect(content);
  await query(
    `UPDATE pages
     SET title = $1, slug = $2, short_description = $3, redirect_to_slug = $4, updated_at = NOW()
     WHERE id = $5`,
    [title, slug, shortDescription || null, redirectToSlug, pageId]
  );

  const revisionResult = await query(
    `INSERT INTO revisions (page_id, content, summary, created_by_user_id, source)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [pageId, content, summary || "Updated page", userId, source]
  );
  const revision = revisionResult.rows[0];
  await query("UPDATE pages SET current_revision_id = $1 WHERE id = $2", [
    revision.id,
    pageId,
  ]);
  await updateSearchDocument(pageId, title, shortDescription, content);
  await upsertCategories(pageId, content, categories || []);
  return getPageBySlug(slug);
}

async function deletePage(pageId) {
  await query("DELETE FROM pages WHERE id = $1", [pageId]);
}

async function getRevisions(pageId) {
  const result = await query(
    `SELECT r.*, u.username
     FROM revisions r
     LEFT JOIN users u ON u.id = r.created_by_user_id
     WHERE r.page_id = $1
     ORDER BY r.created_at DESC`,
    [pageId]
  );
  return result.rows;
}

async function getRevisionById(revisionId) {
  const result = await query(
    `SELECT r.*, u.username
     FROM revisions r
     LEFT JOIN users u ON u.id = r.created_by_user_id
     WHERE r.id = $1`,
    [revisionId]
  );
  return result.rows[0] || null;
}

async function getDiff(pageId, revAId, revBId) {
  const revA = await query(
    "SELECT content FROM revisions WHERE id = $1 AND page_id = $2",
    [revAId, pageId]
  );
  const revB = await query(
    "SELECT content FROM revisions WHERE id = $1 AND page_id = $2",
    [revBId, pageId]
  );
  if (!revA.rowCount || !revB.rowCount) return null;
  return diffLines(revA.rows[0].content || "", revB.rows[0].content || "");
}

async function getCategory(name) {
  const result = await query(
    `SELECT p.title, p.slug
     FROM categories c
     JOIN page_categories pc ON pc.category_id = c.id
     JOIN pages p ON p.id = pc.page_id
     WHERE c.name = $1
     ORDER BY p.title`,
    [name]
  );
  return result.rows;
}

async function getTalkPosts(pageId) {
  const result = await query(
    `SELECT t.*, u.username
     FROM talk_posts t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.page_id = $1
     ORDER BY t.created_at ASC`,
    [pageId]
  );
  return result.rows;
}

async function addTalkPost(pageId, userId, content) {
  await query(
    "INSERT INTO talk_posts (page_id, user_id, content) VALUES ($1, $2, $3)",
    [pageId, userId, content]
  );
}

async function randomPageSlug() {
  const result = await query(
    "SELECT slug FROM pages ORDER BY RANDOM() LIMIT 1"
  );
  return result.rows[0]?.slug || null;
}

module.exports = {
  getTemplatesMap,
  getPageBySlug,
  getPageByTitle,
  listRecentPages,
  searchPages,
  createPage,
  updatePage,
  deletePage,
  getRevisions,
  getRevisionById,
  getDiff,
  getCategory,
  getTalkPosts,
  addTalkPost,
  randomPageSlug,
};
