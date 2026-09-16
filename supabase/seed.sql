-- ============================================================
-- Taskora — Seed Data for Development
-- ============================================================
-- Run migrations first (supabase/migrations), then this seed.
--
-- 1. Run: supabase/migrations/001_initial_schema.sql
-- 2. Run: supabase/migrations/002_realtime_rls_storage.sql
-- 3. Run: supabase/migrations/003_status_simplify.sql
-- 4. Run: supabase/migrations/004_task_management_upgrades.sql
--    (labels, subtasks, saved filters, activity stream, task ordering)
-- 5. Run: supabase/migrations/005_profile_status_and_auth_guards.sql
-- 6. Run: supabase/migrations/006_admin_lifecycle_audit.sql
-- 7. Run: supabase/migrations/007_active_admin_rls.sql
-- 8. Run: supabase/migrations/008_security_consolidation.sql
--    (auth model consolidation — idempotent, fixes activity triggers,
--     adds invitations + push_subscriptions)
-- 9. Create auth users (Supabase Dashboard → Authentication),
--    then promote exactly one to admin explicitly:
--        UPDATE profiles
--        SET role = 'ADMIN', status = 'ACTIVE', active = true,
--            approved_at = now()
--        WHERE email = '<admin-email>';
-- 10. Add project members (required for employees to see projects):
--        INSERT INTO project_members (project_id, user_id)
--        VALUES ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', '<employee-uuid>');
-- 11. Run this seed, then the sample task inserts at the bottom
--     with real user UUIDs.
--
-- New signups are always PENDING with no role — approve them in the
-- app (Team → Pending) or via invitations.
-- ============================================================

-- Sample Client
INSERT INTO clients (id, name, company_name, email, phone, website, notes, active)
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'Brilliant Coaching',
  'Brilliant Coaching Academy',
  'contact@brilliantcoaching.com',
  '+91 98765 43210',
  'https://brilliantcoaching.com',
  'Premium coaching institute. Focus on NEET and JEE preparation.',
  true
);

-- Sample Project
INSERT INTO projects (id, client_id, name, description, status, start_date, end_date, created_by)
VALUES (
  'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'September Social Media',
  'Complete social media management for September — Instagram posts, reels, stories, and meta ads.',
  'ACTIVE',
  '2026-09-01',
  '2026-09-30',
  NULL  -- Will be set to admin user ID after auth user creation
);

-- Sample Project Resources
INSERT INTO project_resources (project_id, title, url, description, resource_type, created_by)
VALUES
  (
    'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    'Client Assets',
    'https://drive.google.com/drive/folders/example1',
    'Brand logos, images, and raw assets from the client',
    'DRIVE',
    NULL
  ),
  (
    'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    'September Templates',
    'https://canva.com/design/example2',
    'Canva templates for September social media posts',
    'CANVA',
    NULL
  ),
  (
    'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    'Content Calendar',
    'https://docs.google.com/spreadsheets/example3',
    'September content calendar with post schedule',
    'GOOGLE_SHEET',
    NULL
  );

-- NOTE: To add sample tasks, you need to first:
-- 1. Create auth users for admin and employees
-- 2. The trigger will auto-create profiles
-- 3. Then insert tasks with the correct assigned_to and created_by UUIDs
--
-- Example (replace UUIDs with actual user IDs):
--
-- INSERT INTO tasks (project_id, assigned_to, title, description, status, priority, deadline, payout_amount, payment_status, created_by)
-- VALUES (
--   'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
--   '<employee-uuid>',
--   'Create 5 Instagram Posts',
--   'Create five admission-related Instagram posts. Use the provided Canva templates. Make sure brand colors are followed, logo is included, CTA is included, spelling is checked.',
--   'TODO',
--   'HIGH',
--   '2026-09-18T18:00:00Z',
--   500,
--   'PENDING',
--   '<admin-uuid>'
-- ),
-- (
--   'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
--   '<employee-uuid>',
--   'Edit September Reel',
--   'Edit the September promotional reel with client branding.',
--   'IN_PROGRESS',
--   'MEDIUM',
--   '2026-09-20T20:00:00Z',
--   300,
--   'NOT_APPLICABLE',
--   '<admin-uuid>'
-- ),
-- (
--   'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
--   '<employee-uuid>',
--   'Create Story Set',
--   'Create a set of 3 Instagram stories for the week.',
--   'TODO',
--   'LOW',
--   '2026-09-22T18:00:00Z',
--   200,
--   'NOT_APPLICABLE',
--   '<admin-uuid>'
-- );
