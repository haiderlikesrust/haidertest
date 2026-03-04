CREATE TABLE IF NOT EXISTS media_uploads (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  original_name TEXT NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  file_size INTEGER NOT NULL,
  uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_uploads_created_at ON media_uploads(created_at DESC);
