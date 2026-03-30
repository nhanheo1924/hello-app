ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address VARCHAR(255);

UPDATE users
SET first_name = NULLIF(TRIM(full_name), '')
WHERE first_name IS NULL
  AND full_name IS NOT NULL
  AND NULLIF(TRIM(full_name), '') IS NOT NULL;
