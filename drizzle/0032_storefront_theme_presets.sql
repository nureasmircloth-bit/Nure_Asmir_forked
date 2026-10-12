ALTER TABLE site_settings 
ADD COLUMN IF NOT EXISTS theme_preset text NOT NULL DEFAULT 'signature',
ADD COLUMN IF NOT EXISTS theme_background_color text NOT NULL DEFAULT '#ffffff',
ADD COLUMN IF NOT EXISTS theme_text_color text NOT NULL DEFAULT '#111111',
ADD COLUMN IF NOT EXISTS theme_surface_color text NOT NULL DEFAULT '#faf9f6',
ADD COLUMN IF NOT EXISTS theme_radius text NOT NULL DEFAULT 'subtle',
ADD COLUMN IF NOT EXISTS body_font_family text NOT NULL DEFAULT 'Jost';
