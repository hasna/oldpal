-- Migration: Rename legacy agent_* table/columns to assistant_* naming
-- Keeps compatibility with existing databases while aligning schema with assistants terminology.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'agent_messages'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'assistant_messages'
  ) THEN
    EXECUTE 'ALTER TABLE agent_messages RENAME TO assistant_messages';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'assistant_messages'
      AND column_name = 'from_agent_id'
  ) THEN
    EXECUTE 'ALTER TABLE assistant_messages RENAME COLUMN from_agent_id TO from_assistant_id';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'agent_messages'
      AND column_name = 'from_agent_id'
  ) THEN
    EXECUTE 'ALTER TABLE agent_messages RENAME COLUMN from_agent_id TO from_assistant_id';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'assistant_messages'
      AND column_name = 'to_agent_id'
  ) THEN
    EXECUTE 'ALTER TABLE assistant_messages RENAME COLUMN to_agent_id TO to_assistant_id';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'agent_messages'
      AND column_name = 'to_agent_id'
  ) THEN
    EXECUTE 'ALTER TABLE agent_messages RENAME COLUMN to_agent_id TO to_assistant_id';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'sessions'
      AND column_name = 'agent_id'
  ) THEN
    EXECUTE 'ALTER TABLE sessions RENAME COLUMN agent_id TO assistant_id';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'schedules'
      AND column_name = 'agent_id'
  ) THEN
    EXECUTE 'ALTER TABLE schedules RENAME COLUMN agent_id TO assistant_id';
  END IF;
END $$;
