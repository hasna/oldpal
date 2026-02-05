-- Migration: Rename agents table to assistants
-- This migration renames the 'agents' table to 'assistants' to unify terminology

-- Rename the table
ALTER TABLE IF EXISTS agents RENAME TO assistants;

-- Update any sequences (if auto-generated IDs use sequences)
-- Note: UUID columns typically don't use sequences, but keeping for safety
-- ALTER SEQUENCE IF EXISTS agents_id_seq RENAME TO assistants_id_seq;

-- Update any indexes that may have been auto-named based on table name
-- The ON clause will automatically point to the renamed table
-- No action needed for indexes as they follow the table

-- Update any foreign key constraint names if needed
-- Drizzle manages these automatically, but document for reference
