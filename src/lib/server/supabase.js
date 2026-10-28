import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$app/env/private';
import { PUBLIC_SUPABASE_URL } from '$app/env/public';

// Usamos el service_role_key para poder insertar registros desde el scraper
// sin necesidad de autenticación de usuario (RLS Bypass)
export const supabase = createClient(
	PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
	SUPABASE_SERVICE_ROLE_KEY || 'placeholder'
);
