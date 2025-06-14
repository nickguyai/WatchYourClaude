-- Database Schema for Claude Watch
-- Retrieved from Supabase API

-- Enum types
CREATE TYPE metric_name AS ENUM (
    'claude_code.cost.usage',
    'claude_code.token.usage',
    'claude_code.lines_of_code.count',
    'claude_code.session.count',
    'claude_code.code_edit_tool.decision',
);

CREATE TYPE token_type AS ENUM (
    'input',
    'output',
    'cacheRead',
    'cacheCreation'
);

CREATE TYPE lines_type AS ENUM (
    'added',
    'removed'
);

-- Main metrics table (raw metric data from Claude Code OTLP exports)
CREATE TABLE metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_name metric_name NOT NULL,
    metric_value DOUBLE PRECISION NOT NULL,
    metric_unit TEXT,
    metric_description TEXT,
    start_time_unix_nano BIGINT NOT NULL,
    time_unix_nano BIGINT NOT NULL, -- Unix timestamp in nanoseconds from OTLP
    start_time TIMESTAMP WITH TIME ZONE,
    time TIMESTAMP WITH TIME ZONE, -- Computed timestamp for easier querying
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    organization_id TEXT,
    user_email TEXT,
    model TEXT,
    token_type token_type,
    decision_type TEXT,
    service_name TEXT DEFAULT 'claude-code' NOT NULL,
    service_version TEXT,
    scope_name TEXT DEFAULT 'com.anthropic.claude_code',
    scope_version TEXT,
    raw_data_point JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    lines_type lines_type
);

-- Aggregated metrics per session for quick access
CREATE TABLE session_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_email TEXT,
    organization_id TEXT,
    total_cost DOUBLE PRECISION DEFAULT 0,
    total_tokens_input INTEGER DEFAULT 0,
    total_tokens_output INTEGER DEFAULT 0,
    total_tokens_cache_read INTEGER DEFAULT 0,
    total_tokens_cache_creation INTEGER DEFAULT 0,
    total_lines_of_code INTEGER DEFAULT 0,
    session_count INTEGER DEFAULT 0,
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    models_used TEXT[],
    total_lines_added INTEGER DEFAULT 0, -- Total lines of code added in this session
    total_lines_removed INTEGER DEFAULT 0, -- Total lines of code removed in this session
    tokens_by_model JSONB -- JSON object tracking token usage by model name
);

-- Session lines of code statistics
CREATE TABLE session_loc_statistics (
    session_id TEXT,
    user_id TEXT,
    total_lines_of_code INTEGER,
    total_lines_added INTEGER,
    total_lines_removed INTEGER,
    net_lines_changed INTEGER,
    last_updated TIMESTAMP WITH TIME ZONE
);

-- Views for easier data access

-- Daily summary view
CREATE VIEW daily_summary AS
SELECT 
    date DATE,
    total_cost DOUBLE PRECISION,
    total_tokens DOUBLE PRECISION,
    total_tokens_input DOUBLE PRECISION,
    total_tokens_output DOUBLE PRECISION,
    total_tokens_cache_read DOUBLE PRECISION,
    total_tokens_cache_creation DOUBLE PRECISION,
    total_lines_of_code DOUBLE PRECISION,
    total_lines_added DOUBLE PRECISION,
    total_lines_removed DOUBLE PRECISION,
    max_active_sessions DOUBLE PRECISION,
    unique_sessions BIGINT,
    unique_users BIGINT,
    tokens_by_model TEXT,
    first_metric_time TIMESTAMP WITH TIME ZONE,
    last_metric_time TIMESTAMP WITH TIME ZONE,
    total_metrics_count BIGINT;

-- Hourly summary view
CREATE VIEW hourly_summary AS
SELECT 
    hour TIMESTAMP WITH TIME ZONE,
    user_id TEXT,
    metric_name metric_name,
    metric_count BIGINT,
    total_value DOUBLE PRECISION,
    avg_value DOUBLE PRECISION,
    max_value DOUBLE PRECISION,
    min_value DOUBLE PRECISION;

-- Recent metrics view
CREATE VIEW recent_metrics AS
SELECT 
    metric_name metric_name,
    metric_value DOUBLE PRECISION,
    metric_unit TEXT,
    time TIMESTAMP WITH TIME ZONE,
    user_email TEXT,
    model TEXT,
    token_type token_type,
    decision_type TEXT;

-- Session summary view
CREATE VIEW session_summary AS
SELECT 
    id UUID,
    session_id TEXT,
    user_id TEXT,
    user_email TEXT,
    organization_id TEXT,
    total_cost DOUBLE PRECISION,
    total_tokens_input INTEGER,
    total_tokens_output INTEGER,
    total_tokens_cache_read INTEGER,
    total_tokens_cache_creation INTEGER,
    total_lines_of_code INTEGER,
    session_count INTEGER,
    first_seen TIMESTAMP WITH TIME ZONE,
    last_updated TIMESTAMP WITH TIME ZONE,
    models_used TEXT[],
    total_tokens INTEGER,
    metric_types_count BIGINT,
    last_metric_time TIMESTAMP WITH TIME ZONE;

-- Indexes for better performance (inferred from API endpoints)
CREATE INDEX idx_metrics_time ON metrics(time);
CREATE INDEX idx_metrics_user_id ON metrics(user_id);
CREATE INDEX idx_metrics_session_id ON metrics(session_id);
CREATE INDEX idx_metrics_metric_name ON metrics(metric_name);
CREATE INDEX idx_session_metrics_session_id ON session_metrics(session_id);
CREATE INDEX idx_session_metrics_user_id ON session_metrics(user_id);