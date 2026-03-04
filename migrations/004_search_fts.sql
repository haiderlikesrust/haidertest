ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS search_document tsvector;

UPDATE pages p
SET search_document =
  setweight(to_tsvector('english', COALESCE(p.title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(p.short_description, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(r.content, '')), 'C')
FROM revisions r
WHERE r.id = p.current_revision_id;

CREATE INDEX IF NOT EXISTS idx_pages_search_document
  ON pages USING GIN (search_document);
