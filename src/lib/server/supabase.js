import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY } from '$app/env/private';
import { PUBLIC_SUPABASE_URL } from '$app/env/public';

/**
 * @param {string | undefined | null} [rawUrl]
 * @returns {string}
 */
function cleanUrl(rawUrl) {
	if (!rawUrl) return 'https://placeholder.supabase.co';
	let url = rawUrl
		.trim()
		.replace(/^["']|["']$/g, '')
		.trim();
	if (!url) return 'https://placeholder.supabase.co';
	if (!url.startsWith('http://') && !url.startsWith('https://')) {
		url = `https://${url}`;
	}
	return url;
}

/**
 * @param {string | undefined | null} [rawKey]
 * @returns {string}
 */
function cleanKey(rawKey) {
	if (!rawKey) return 'placeholder-key';
	return (
		rawKey
			.trim()
			.replace(/^["']|["']$/g, '')
			.trim() || 'placeholder-key'
	);
}

const supabaseUrl = cleanUrl(PUBLIC_SUPABASE_URL);
const supabaseKey = cleanKey(SUPABASE_SERVICE_ROLE_KEY);

// Usamos el service_role_key para poder insertar registros desde el scraper
// sin necesidad de autenticación de usuario (RLS Bypass)
export const supabase = createClient(supabaseUrl, supabaseKey);
