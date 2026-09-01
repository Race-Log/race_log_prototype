ALTER TABLE users
ADD COLUMN IF NOT EXISTS sex VARCHAR(10) NOT NULL DEFAULT 'male';

ALTER TABLE users
ADD CONSTRAINT users_sex_check CHECK (sex IN ('male', 'female'));

CREATE TABLE IF NOT EXISTS rank_catalog (
    code VARCHAR(32) PRIMARY KEY,
    label VARCHAR(64) NOT NULL,
    rank_order SMALLINT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS disciplines (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(32) NOT NULL,
    distance_meters INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE OR REPLACE FUNCTION parse_mark_to_seconds(mark TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    normalized TEXT;
    parts TEXT[];
BEGIN
    normalized := replace(trim(mark), ',', '.');
    parts := string_to_array(normalized, ':');

    IF array_length(parts, 1) = 1 THEN
        RETURN normalized::NUMERIC;
    END IF;

    IF array_length(parts, 1) = 2 THEN
        RETURN (parts[1]::NUMERIC * 60) + parts[2]::NUMERIC;
    END IF;

    IF array_length(parts, 1) = 3 THEN
        RETURN (parts[1]::NUMERIC * 3600) + (parts[2]::NUMERIC * 60) + parts[3]::NUMERIC;
    END IF;

    RAISE EXCEPTION 'Unsupported mark format: %', mark;
END;
$$;

CREATE TABLE IF NOT EXISTS rank_standards (
    id BIGSERIAL PRIMARY KEY,
    discipline_id BIGINT NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
    sex VARCHAR(10) NOT NULL CHECK (sex IN ('male', 'female')),
    age_group VARCHAR(32) NOT NULL DEFAULT 'adult',
    timing_type VARCHAR(16) NOT NULL CHECK (timing_type IN ('manual', 'auto')),
    track_length_meters INTEGER NULL CHECK (track_length_meters IN (200, 400)),
    water_pit BOOLEAN NULL,
    rank_code VARCHAR(32) NOT NULL REFERENCES rank_catalog(code),
    mark_display VARCHAR(32) NOT NULL,
    result_seconds NUMERIC(10, 2) NOT NULL,
    valid_from DATE NOT NULL,
    source_title TEXT NOT NULL,
    source_url TEXT NOT NULL,
    notes TEXT NULL
);

ALTER TABLE rank_standards
ADD CONSTRAINT rank_standards_unique_variant
UNIQUE NULLS NOT DISTINCT (
    discipline_id,
    sex,
    age_group,
    timing_type,
    track_length_meters,
    water_pit,
    rank_code,
    valid_from
);

CREATE TABLE IF NOT EXISTS results (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    discipline_id BIGINT NOT NULL REFERENCES disciplines(id),
    result_date DATE NOT NULL,
    competition_name VARCHAR(200),
    performance_label VARCHAR(32) NOT NULL,
    performance_seconds NUMERIC(10, 2) NOT NULL,
    timing_type VARCHAR(16) NOT NULL CHECK (timing_type IN ('manual', 'auto')),
    track_length_meters INTEGER NULL CHECK (track_length_meters IN (200, 400)),
    water_pit BOOLEAN NULL,
    detected_rank_code VARCHAR(32) NULL REFERENCES rank_catalog(code),
    manual_rank_code VARCHAR(32) NULL REFERENCES rank_catalog(code),
    effective_rank_code VARCHAR(32) NULL REFERENCES rank_catalog(code),
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_rank_history (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    discipline_id BIGINT NOT NULL REFERENCES disciplines(id) ON DELETE CASCADE,
    result_id BIGINT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
    rank_code VARCHAR(32) NOT NULL REFERENCES rank_catalog(code),
    source_type VARCHAR(16) NOT NULL CHECK (source_type IN ('auto', 'manual')),
    achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_current BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_rank_standards_lookup
    ON rank_standards (discipline_id, sex, age_group, timing_type, track_length_meters, water_pit);

CREATE INDEX IF NOT EXISTS idx_results_user_date
    ON results (user_id, result_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rank_history_user_discipline
    ON user_rank_history (user_id, discipline_id, is_current);
