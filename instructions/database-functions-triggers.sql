-- Database Functions and Triggers for Claude Watch

-- Function: update_session_metrics
-- Purpose: Automatically updates session_metrics table when new metrics are inserted
CREATE OR REPLACE FUNCTION update_session_metrics()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert or update session_metrics based on the metric type
    INSERT INTO session_metrics (session_id, user_id, user_email, organization_id)
    VALUES (NEW.session_id, NEW.user_id, NEW.user_email, NEW.organization_id)
    ON CONFLICT (session_id) DO UPDATE SET
        last_updated = NOW(),
        models_used = CASE 
            WHEN NEW.model IS NOT NULL AND NOT (session_metrics.models_used @> ARRAY[NEW.model]) 
            THEN array_append(session_metrics.models_used, NEW.model)
            ELSE session_metrics.models_used
        END;
    
    -- Update cumulative values based on metric type
    IF NEW.metric_name = 'claude_code.cost.usage' THEN
        UPDATE session_metrics 
        SET total_cost = total_cost + NEW.metric_value
        WHERE session_id = NEW.session_id;
        
    ELSIF NEW.metric_name = 'claude_code.token.usage' THEN
        -- Update token type totals
        IF NEW.token_type = 'input' THEN
            UPDATE session_metrics 
            SET total_tokens_input = total_tokens_input + NEW.metric_value::INTEGER
            WHERE session_id = NEW.session_id;
        ELSIF NEW.token_type = 'output' THEN
            UPDATE session_metrics 
            SET total_tokens_output = total_tokens_output + NEW.metric_value::INTEGER
            WHERE session_id = NEW.session_id;
        ELSIF NEW.token_type = 'cacheRead' THEN
            UPDATE session_metrics 
            SET total_tokens_cache_read = total_tokens_cache_read + NEW.metric_value::INTEGER
            WHERE session_id = NEW.session_id;
        ELSIF NEW.token_type = 'cacheCreation' THEN
            UPDATE session_metrics 
            SET total_tokens_cache_creation = total_tokens_cache_creation + NEW.metric_value::INTEGER
            WHERE session_id = NEW.session_id;
        END IF;
        
        -- Update tokens by model
        IF NEW.model IS NOT NULL THEN
            UPDATE session_metrics
            SET tokens_by_model = 
                CASE 
                    WHEN tokens_by_model ? NEW.model 
                    THEN jsonb_set(
                        tokens_by_model, 
                        ARRAY[NEW.model], 
                        to_jsonb(COALESCE((tokens_by_model->NEW.model)::INTEGER, 0) + NEW.metric_value::INTEGER)
                    )
                    ELSE tokens_by_model || jsonb_build_object(NEW.model, NEW.metric_value::INTEGER)
                END
            WHERE session_id = NEW.session_id;
        END IF;
        
    ELSIF NEW.metric_name = 'claude_code.lines_of_code.count' THEN
        -- Update total lines count
        UPDATE session_metrics 
        SET total_lines_of_code = total_lines_of_code + NEW.metric_value::INTEGER
        WHERE session_id = NEW.session_id;
        
        -- Also update added/removed based on lines_type
        IF NEW.lines_type = 'added' THEN
            UPDATE session_metrics 
            SET total_lines_added = total_lines_added + NEW.metric_value::INTEGER
            WHERE session_id = NEW.session_id;
        ELSIF NEW.lines_type = 'removed' THEN
            UPDATE session_metrics 
            SET total_lines_removed = total_lines_removed + NEW.metric_value::INTEGER
            WHERE session_id = NEW.session_id;
        END IF;
        
    ELSIF NEW.metric_name = 'claude_code.session.count' THEN
        UPDATE session_metrics 
        SET session_count = NEW.metric_value::INTEGER
        WHERE session_id = NEW.session_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: trigger_update_session_metrics
-- Purpose: Fires after each insert on metrics table to update session aggregates
CREATE TRIGGER trigger_update_session_metrics
AFTER INSERT ON metrics
FOR EACH ROW
EXECUTE FUNCTION update_session_metrics();