CREATE TABLE IF NOT EXISTS points_documents (
  collection_name VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload JSON NOT NULL,
  user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  joined_at BIGINT UNSIGNED NULL,
  expires_at BIGINT UNSIGNED NULL,
  PRIMARY KEY (collection_name, document_id),
  INDEX user_history (collection_name, user_id, joined_at, document_id),
  INDEX session_expiry (collection_name, expires_at)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
