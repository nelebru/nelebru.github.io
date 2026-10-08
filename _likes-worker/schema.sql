-- one row per course (or "recipe:<id>"): just the total, nothing about who liked it
CREATE TABLE IF NOT EXISTS likes (
  course TEXT PRIMARY KEY,
  count  INTEGER NOT NULL DEFAULT 0
);
