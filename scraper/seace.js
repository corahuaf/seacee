// Ejemplo de cliente para enviar datos extraídos al endpoint de SvelteKit
const backendUrl = process.env.ENDPOINT_URL || 'http://localhost:5173/api/evaluar';

export async function enviarAEndpoint(datosExtraidos) {
	try {
		const respuesta = await fetch(backendUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				titulo: datosExtraidos.titulo,
				entidad: datosExtraidos.entidad,
				fecha_cierre: datosExtraidos.fecha,
				enlace_bases: datosExtraidos.url,
				texto_tdr: datosExtraidos.texto_pdf
			})
		});

		const resultado = await respuesta.json();
		console.log('Procesado:', resultado);
		return resultado;
	} catch (error) {
		console.error('Error conectando con el backend:', error);
		return { success: false, error: error.message };
	}
}
