import { supabase } from '#lib/server/supabase.js';

export async function load() {
	// Consultamos la BD ordenando por el mayor match primero
	const { data: oportunidades, error } = await supabase
		.from('oportunidades')
		.select('*')
		.order('porcentaje_compatibilidad', { ascending: false });

	if (error) {
		console.error('Error cargando BD:', error);
		return { oportunidades: [] };
	}

	return { oportunidades };
}
