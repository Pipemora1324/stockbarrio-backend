-- Day (Bogota) when the AI last wrote the discount explanations of a store: at most one call per store per day.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS ai_reasons_on DATE;
