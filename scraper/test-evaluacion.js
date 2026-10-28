// Script de prueba rápida para verificar Backend + Gemini + Supabase
const backendUrl = process.env.ENDPOINT_URL || 'http://localhost:5173/api/evaluar';

async function probarEvaluacion() {
	console.log(`🚀 Enviando convocatoria de prueba a: ${backendUrl}\n`);

	const convocatoriaPrueba = {
		titulo:
			'CAS N° 012-2026: Especialista en Desarrollo Web y Sistemas de Información Geográfica (SIG)',
		entidad: 'Jurado Nacional de Elecciones (JNE)',
		fecha_cierre: '15/11/2026',
		enlace_bases: 'https://www.jne.gob.pe/convocatorias',
		texto_tdr: `
PERFIL DEL PUESTO:
- Formación académica: Título universitario en Ingeniería de Sistemas, Informática, Computación, Geográfica o afines.
- Experiencia laboral: Mínimo tres (03) años de experiencia general en el sector público o privado.
- Experiencia específica: Mínimo dos (02) años en puestos equivalentes como desarrollador de software o analista SIG en entidades del Estado.
- Conocimientos técnicos:
  * Desarrollo frontend con Angular, TypeScript o frameworks reactivos modernos.
  * Manejo de bases de datos espaciales (PostgreSQL/PostGIS) y software SIG (ArcGIS, QGIS).
  * Consumo y diseño de APIs RESTful con Node.js o Python.
- Habilidades: Trabajo en equipo, proactividad y orientación a resultados.
        `.trim()
	};

	try {
		const res = await fetch(backendUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(convocatoriaPrueba)
		});

		const data = await res.json();

		if (res.ok && data.success) {
			console.log('✅ ¡ÉXITO TOTAL!');
			console.log('La IA evaluó los TDR y Supabase guardó el resultado correctamente.');
			console.log('Respuesta del servidor:', data);
			console.log(
				'\n👉 Ahora entra a tu navegador (http://localhost:5173 o tu web en Vercel) y recarga la página.'
			);
			console.log('Deberías ver la tarjeta con el porcentaje de match y el análisis detallado.');
		} else {
			console.error('❌ El servidor respondió con error:', data);
		}
	} catch (error) {
		console.error('❌ Error conectando con el backend:', error.message);
		console.log(
			"💡 Tip: Si estás probando en local, asegúrate de tener 'npm run dev' corriendo en otra terminal."
		);
	}
}

probarEvaluacion();
