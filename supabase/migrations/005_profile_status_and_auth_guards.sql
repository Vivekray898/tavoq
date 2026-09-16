-- Taskora — Migration 005
-- Explicit profile lifecycle state and server-side authorization helpers.
-- Existing profile and auth IDs are preserved.

CREATE TYPE profile_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

ALTER TABLE profiles
  ALTER COLUMN role DROP NOT NULL,
  ADD COLUMN status profile_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN approved_at TIMESTAMPTZ,
  ADD COLUMN approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Existing users retain their current role and access state.
UPDATE profiles
SET status = CASE WHEN active THEN 'ACTIVE'::profile_status ELSE 'SUSPENDED'::profile_status END,
    approved_at = CASE WHEN active THEN COALESCE(approved_at, created_at) ELSE approved_at END
WHERE status = 'PENDING';

CREATE INDEX idx_profiles_status ON profiles(status);
CREATE INDEX idx_profiles_status_role ON profiles(status, role);
CREATE INDEX idx_profiles_approved_by ON profiles(approved_by);

CREATE OR REPLACE FUNCTION public.is_active_user(user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = user_id
      AND status = 'ACTIVE'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_admin(user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = user_id
      AND status = 'ACTIVE'
      AND role = 'ADMIN'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_admin(UUID) TO authenticated, service_role;

-- New OAuth users begin pending and never receive a client-controlled role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, status)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    NULL,
    'PENDING'
  );
  RETURN NEW;
END;
$$;

-- Prevent a normal user from changing authorization fields on their profile.
CREATE OR REPLACE FUNCTION public.protect_profile_authorization_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() = OLD.id
     AND NOT public.is_active_admin(auth.uid())
     AND (
       NEW.role IS DISTINCT FROM OLD.role
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     ) THEN
    RAISE EXCEPTION 'Only an active admin may change profile authorization fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_protect_profile_authorization_fields ON profiles;
CREATE TRIGGER trigger_protect_profile_authorization_fields
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_authorization_fields();

-- Tighten the profile policies while retaining self-read for pending/suspended users.
DROP POLICY IF EXISTS "Admin can read all profiles" ON profiles;
CREATE POLICY "Active admins can read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (public.is_active_admin());

DROP POLICY IF EXISTS "Admin can update any profile" ON profiles;
CREATE POLICY "Active admins can update any profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (public.is_active_admin())
  WITH CHECK (public.is_active_admin());

DROP POLICY IF EXISTS "Admin can insert profiles" ON profiles;
CREATE POLICY "Active admins can insert profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_active_admin());
