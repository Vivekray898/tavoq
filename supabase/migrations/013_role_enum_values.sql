-- ============================================================
-- Taskora — Migration 013
-- user_role enum values only.
--
-- WHY THIS FILE EXISTS SEPARATELY
--
-- This migration does nothing but widen the enum. That is deliberate.
--
-- Postgres refuses to USE an enum value in the same transaction that
-- created it:
--
--   ERROR: 55P04: unsafe use of new value "MANAGER" of enum type
--          user_role
--   HINT:  New enum values must be committed before they can be used.
--
-- So a single migration cannot both ADD VALUE 'MANAGER' and create a
-- policy that filters on role = 'MANAGER'. The value has to be
-- committed by the end of one migration before the next one may
-- reference it. This file is that commit boundary: it adds ALL the
-- values and stops. Everything that uses them lives in
-- 014_role_hierarchy.sql.
--
-- Two values are added here, and both are consumed in 014:
--   user_role.MANAGER                       (used by is_active_manager)
--   admin_audit_action.ROLE_REQUIRES_SUPER_ADMIN  (inserted by the
--                                             lifecycle RPC)
--
-- Adding the second one here rather than in 014 is deliberate: 014
-- inserts it, so it must not also create it.
--
-- Run AFTER 012_google_calendar_integration.sql.
-- Order: 001 → 013 → 014.
--
-- Idempotent: safe to run repeatedly.
--
-- ────────────────────────────────────────────────────────────
-- DOWN MIGRATION
--
-- Postgres cannot remove an enum value. To revert:
--
--   BEGIN;
--   ALTER TYPE public.user_role RENAME VALUE 'SUPER_ADMIN' TO 'ADMIN';
--   -- 'MANAGER' can only be dropped by recreating the type, which
--   -- means rebuilding all four dependent columns:
--   --   profiles.role, invitations.role,
--   --   admin_audit_log.previous_role, admin_audit_log.next_role
--   -- plus the manage_profile_lifecycle() signature. Drop 014 first.
--   COMMIT;
--
-- Any MANAGER rows must be mapped to EMPLOYEE before the rename, or
-- they will be left holding an undefined label.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'MANAGER', 'EMPLOYEE');
  END IF;
END $$;

-- ADMIN -> SUPER_ADMIN.
--
-- RENAME VALUE rather than drop-and-recreate: recreating the type
-- would break profiles.role, invitations.role,
-- admin_audit_log.previous_role, admin_audit_log.next_role and the
-- manage_profile_lifecycle(UUID, admin_audit_action, user_role)
-- signature, each of which would need rebuilding and re-granting.
-- Renaming in place keeps every dependent object valid and moves no
-- data — every existing admin simply starts reading SUPER_ADMIN.
--
-- RENAME VALUE is allowed inside a transaction (unlike ADD VALUE on
-- older servers), so it is safe here.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'ADMIN'
  ) THEN
    ALTER TYPE public.user_role RENAME VALUE 'ADMIN' TO 'SUPER_ADMIN';
  END IF;
END $$;

-- Add the manager tier. This statement is the last thing in this
-- migration on purpose: nothing in this file may reference 'MANAGER'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'MANAGER'
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'MANAGER';
  END IF;
END $$;

-- New audit action for a refused privilege escalation. 014 writes this
-- value into admin_audit_log.action, so like MANAGER it must be added
-- here and committed before 014 runs. It is never referenced in this
-- file.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'admin_audit_action' AND e.enumlabel = 'ROLE_REQUIRES_SUPER_ADMIN'
  ) THEN
    ALTER TYPE public.admin_audit_action ADD VALUE 'ROLE_REQUIRES_SUPER_ADMIN';
  END IF;
END $$;