import puppeteer from 'puppeteer';
import { PDFParse } from 'pdf-parse';

// Función para descargar y leer el PDF en memoria
async function extraerTextoPDF(urlPdf) {
	let parser = null;
	try {
		console.log(`Descargando PDF desde: ${urlPdf}`);
		const response = await fetch(urlPdf);

		if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

		// Convertimos la respuesta a un ArrayBuffer y luego a un Buffer de Node
		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		// pdf-parse v2 procesa el buffer mediante la clase PDFParse
		parser = new PDFParse({ data: buffer });
		const data = await parser.getText();
		return data.text;
	} catch (error) {
		console.error(`Error leyendo el PDF de ${urlPdf}:`, error.message);
		return null; // Retornamos null si el PDF falla o está corrupto
	} finally {
		if (parser) {
			await parser.destroy();
		}
	}
}

async function iniciarScraping() {
	console.log('Iniciando navegador invisible...');
	// headless: true ejecuta el navegador sin interfaz gráfica
	const browser = await puppeteer.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox']
	});

	try {
		const page = await browser.newPage();

		// 1. NAVEGACIÓN
		// URL hipotética (reemplazar por el portal real del municipio o SERVIR)
		const URL_OBJETIVO = 'https://ejemplo-entidad.gob.pe/convocatorias';

		await page.goto(URL_OBJETIVO, { waitUntil: 'networkidle2' });
		console.log('Página cargada. Extrayendo datos...');

		// 2. EXTRACCIÓN (Web Scraping del DOM)
		// page.evaluate se ejecuta dentro del contexto del navegador (como la consola de Chrome)
		const oportunidades = await page.evaluate(() => {
			// Selector hipotético de las filas de la tabla de convocatorias
			const filas = document.querySelectorAll('.tabla-convocatorias tr.item');
			const data = [];

			filas.forEach((fila) => {
				data.push({
					titulo: fila.querySelector('.col-titulo')?.innerText?.trim() || 'Sin título',
					entidad: 'Municipalidad Ejemplo', // O extraerlo si la web es un agregador
					fecha: fila.querySelector('.col-fecha')?.innerText?.trim() || 'Sin fecha',
					url: fila.querySelector('a.btn-descargar-bases')?.href || '',
					// Para esta plantilla, asumimos que extraemos el resumen de la web.
					// En la realidad, tendrías que descargar el PDF de la 'url' y parsearlo.
					texto_tdr: fila.querySelector('.col-requisitos')?.innerText?.trim() || ''
				});
			});

			return data;
		});

		console.log(`Se extrajeron ${oportunidades.length} oportunidades. Evaluando con Gemini...`);

		// 3. ENVÍO A TU BACKEND (SvelteKit + Gemini + Supabase)
		for (const op of oportunidades) {
			if (!op.url) {
				console.log(`Omitiendo ${op.titulo}: No tiene enlace a las bases.`);
				continue;
			}

			// 3.1 Extraemos el texto real del documento PDF
			const textoCompletoTDR = await extraerTextoPDF(op.url);

			if (!textoCompletoTDR) {
				console.log(`Omitiendo ${op.titulo}: No se pudo extraer texto del PDF.`);
				continue;
			}

			try {
				// 3.2 Enviamos los datos con el texto extraído del PDF
				const backendUrl = process.env.ENDPOINT_URL || 'http://localhost:5173/api/evaluar';
				const respuesta = await fetch(backendUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						titulo: op.titulo,
						entidad: op.entidad,
						fecha_cierre: op.fecha,
						enlace_bases: op.url,
						// Enviamos el texto del PDF a Gemini
						texto_tdr: textoCompletoTDR
					})
				});

				const resultado = await respuesta.json();

				if (resultado.success) {
					console.log(`✅ Evaluado y guardado: ${op.titulo}`);
				} else {
					console.log(`⚠️ Error en BD para ${op.titulo}:`, resultado.error);
				}
			} catch (error) {
				console.error(`❌ Error de conexión con SvelteKit para ${op.titulo}:`, error.message);
			}
		}
	} catch (error) {
		console.error('Error durante el scraping:', error.message);
	} finally {
		await browser.close();
		console.log('Navegador cerrado. Proceso finalizado.');
	}
}

iniciarScraping();
