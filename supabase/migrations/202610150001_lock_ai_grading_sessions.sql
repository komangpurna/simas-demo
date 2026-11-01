-- D1 is the single cloud source. Historical fallback data remains intact.
-- Firebase identity cannot be verified by the former public PostgREST policies.
ALTER TABLE public.ai_grading_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read ai_grading_sessions" ON public.ai_grading_sessions;
DROP POLICY IF EXISTS "Allow anon write ai_grading_sessions" ON public.ai_grading_sessions;
REVOKE ALL ON TABLE public.ai_grading_sessions FROM anon, authenticated;
