-- Supabase Migration: Convert run_id columns from INTEGER to BIGINT
-- This is needed because run IDs now use large timestamp values (e.g., 1778501388882)
-- which exceed PostgreSQL's INTEGER limit (2,147,483,647)

-- 1. Update captured_tiles table
ALTER TABLE captured_tiles ALTER COLUMN run_id TYPE BIGINT;

-- 2. Update route_points table
ALTER TABLE route_points ALTER COLUMN run_id TYPE BIGINT;

-- 3. Update posts table (if it has run_id)
ALTER TABLE posts ALTER COLUMN run_id TYPE BIGINT;

-- 4. Update leaderboard_entries table (if it has run_id)
-- Note: Check if this table exists in your schema
-- ALTER TABLE leaderboard_entries ALTER COLUMN run_id TYPE BIGINT;

-- 5. Update run_attempts table (if it has run_id)
-- ALTER TABLE run_attempts ALTER COLUMN run_id TYPE BIGINT;

-- Verify the changes
SELECT 
    table_name, 
    column_name, 
    data_type 
FROM 
    information_schema.columns 
WHERE 
    column_name = 'run_id' 
    AND table_schema = 'public'
ORDER BY 
    table_name;
