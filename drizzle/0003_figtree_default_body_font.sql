-- The shop's default body font is now Figtree (a free font close to Ismail Farid's Whitney Light); Jost was only the old default.
UPDATE `site_settings` SET `body_font_family` = 'Figtree' WHERE `body_font_family` = 'Jost';
