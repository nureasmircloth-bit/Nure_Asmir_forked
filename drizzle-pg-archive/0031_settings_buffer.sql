ALTER TABLE site_settings 
ADD COLUMN IF NOT EXISTS pending_changes text,
ADD COLUMN IF NOT EXISTS pending_apply_at timestamptz,
ADD COLUMN IF NOT EXISTS previous_settings text;
