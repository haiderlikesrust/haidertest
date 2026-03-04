CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'editor', 'reader')),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  title TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  short_description TEXT,
  current_revision_id INTEGER,
  redirect_to_slug TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS revisions (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source VARCHAR(16) NOT NULL CHECK (source IN ('web', 'whatsapp'))
);

ALTER TABLE pages
  DROP CONSTRAINT IF EXISTS pages_current_revision_id_fkey;

ALTER TABLE pages
  ADD CONSTRAINT pages_current_revision_id_fkey
  FOREIGN KEY (current_revision_id) REFERENCES revisions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS page_categories (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, category_id)
);

CREATE TABLE IF NOT EXISTS talk_posts (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_sessions (
  phone_number TEXT PRIMARY KEY,
  active_title TEXT NOT NULL,
  mode VARCHAR(16) NOT NULL CHECK (mode IN ('create', 'update', 'append')),
  buffer TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);
CREATE INDEX IF NOT EXISTS idx_pages_title ON pages(title);
CREATE INDEX IF NOT EXISTS idx_revisions_page_id ON revisions(page_id);
CREATE INDEX IF NOT EXISTS idx_talk_posts_page_id ON talk_posts(page_id);
