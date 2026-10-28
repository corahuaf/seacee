import { json } from '@sveltejs/kit';
import { supabase } from '#lib/server/supabase.js';
import { ai } from '#lib/server/gemini.js';

const SYSTEM_INSTRUCTION = `Actúa como un evaluador experto en selección y contratación para el Estado Peruano (CAS, Locación de Servicios, Órdenes de Servicio en SEACE/SERVIR).
Evalúa los Términos de Referencia (TDR) o bases de la convocatoria frente al siguiente perfil profesional:
- Especialista en Sistemas de Información Geográfica (SIG), ArcGIS, QGIS, bases de datos espaciales (PostGIS).
- Desarrollador Frontend y Fullstack: Angular, TypeScript, Svelte, Node.js, Python.
- Experiencia en el sector público peruano (JNE, Ministerios, Gobiernos Regionales/Locales).

REGLAS DE SALIDA: Devuelve ÚNICAMENTE un objeto JSON válido con la siguiente estructura:
{
  "porcentaje_compatibilidad": number (de 0 a 100),
  "cumple_perfil_minimo": boolean,
  "puntos_fuertes": string[] (lista de requisitos o funciones que coinciden con el perfil),
  "brechas_o_faltantes": string[] (lista de requisitos, certificaciones o años de experiencia faltantes),
  "resumen_evaluacion": string (síntesis de 2 a 3 oraciones con la recomendación)
}`;

export async function POST({ request }) {
	try {
		const body = await request.json();
		const { titulo, entidad, fecha_cierre, enlace_bases, texto_tdr } = body;

		if (!texto_tdr) {
			return json({ success: false, error: 'texto_tdr es requerido' }, { status: 400 });
		}

		// Evaluamos el TDR con Gemini forzando respuesta JSON
		const response = await ai.models.generateContent({
			model: 'gemini-2.0-flash',
			contents: `Evalúa los siguientes TDR o bases de convocatoria:\n${texto_tdr}`,
			config: {
				systemInstruction: SYSTEM_INSTRUCTION,
				responseMimeType: 'application/json'
			}
		});

		const rawText = response.text || '{}';
		// Limpiamos en caso venga envuelto en bloques de código markdown
		const cleanedText = rawText.replace(/```(?:json)?/gi, '').trim();
		const evaluacion = JSON.parse(cleanedText);

		// Guardamos todo consolidado en Supabase
		const { error } = await supabase.from('oportunidades').insert({
			titulo: titulo || 'Sin título',
			entidad: entidad || 'Entidad no especificada',
			fecha_cierre: fecha_cierre || null,
			enlace_bases: enlace_bases || '',
			porcentaje_compatibilidad: Number(evaluacion.porcentaje_compatibilidad) || 0,
			cumple_perfil_minimo: Boolean(evaluacion.cumple_perfil_minimo),
			puntos_fuertes: Array.isArray(evaluacion.puntos_fuertes) ? evaluacion.puntos_fuertes : [],
			brechas_o_faltantes: Array.isArray(evaluacion.brechas_o_faltantes)
				? evaluacion.brechas_o_faltantes
				: [],
			resumen_evaluacion: evaluacion.resumen_evaluacion || ''
		});

		if (error) throw error;

		return json({ success: true, message: 'Oportunidad evaluada y guardada exitosamente' });
	} catch (error) {
		console.error('Error en evaluación:', error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return json({ success: false, error: errorMessage }, { status: 500 });
	}
}
