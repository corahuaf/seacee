// Ejemplo simplificado de cómo se comunicaría el scraper con tu SvelteKit
async function enviarAEndpoint(datosExtraidos) {
	try {
		const respuesta = await fetch('http://localhost:5173/api/evaluar', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				titulo: datosExtraidos.titulo,
				entidad: datosExtraidos.entidad,
				fecha_cierre: datosExtraidos.fecha,
				enlace_bases: datosExtraidos.url,
				texto_tdr: datosExtraidos.texto_pdf // Texto ya parseado del PDF
			})
		});

		const resultado = await respuesta.json();
		console.log('Procesado:', resultado);
	} catch (error) {
		console.error('Error conectando con el backend:', error);
	}
}
