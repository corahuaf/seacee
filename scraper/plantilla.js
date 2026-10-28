import puppeteer from 'puppeteer';
import { PDFParse } from 'pdf-parse';

// URL de búsqueda de convocatorias en el sector público (Sistemas, Informática, SIG, TI)
const BUSQUEDA_URL = 'https://www.convocatoriasdetrabajo.com/buscar-empleo.php?q=sistemas';
const MAX_CONVOCATORIAS_A_EVALUAR = 5; // Límite para no exceder cuotas de IA ni tiempos de ejecución

// Función para descargar y leer PDF en memoria
async function extraerTextoPDF(urlPdf) {
	let parser = null;
	try {
		console.log(`  📄 Intentando descargar bases PDF: ${urlPdf}`);
		const response = await fetch(urlPdf, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
			}
		});

		if (!response.ok) throw new Error(`HTTP status: ${response.status}`);

		const contentType = response.headers.get('content-type') || '';
		if (!contentType.includes('pdf') && !urlPdf.toLowerCase().endsWith('.pdf')) {
			// No es un PDF directo (suele ser una página web intermedia de la entidad)
			return null;
		}

		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		parser = new PDFParse({ data: buffer });
		const data = await parser.getText();
		return data.text?.trim() || null;
	} catch (error) {
		console.log(
			`  ⚠️ No se pudo parsear PDF directo (${error.message}). Se usará el resumen de requisitos de la web.`
		);
		return null;
	} finally {
		if (parser) {
			await parser.destroy();
		}
	}
}

async function iniciarScraping() {
	console.log('🤖 Iniciando Scraper de Convocatorias del Estado Peruano...');
	const backendUrl = process.env.ENDPOINT_URL || 'http://localhost:5173/api/evaluar';
	console.log(`📡 Endpoint de evaluación configurado en: ${backendUrl}`);

	const browser = await puppeteer.launch({
		headless: true,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--disable-accelerated-2d-canvas',
			'--disable-gpu'
		]
	});

	try {
		const page = await browser.newPage();
		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
		);

		console.log(`🔍 Navegando a portal de convocatorias: ${BUSQUEDA_URL}`);
		await page.goto(BUSQUEDA_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

		// Extraemos la lista de convocatorias de la página de resultados
		const listaConvocatorias = await page.evaluate(() => {
			const items = [];
			const titulos = document.querySelectorAll('h2.convocatoria__title a');

			titulos.forEach((a) => {
				const card =
					a.closest('.convocatoria, article, div.relative') || a.parentElement?.parentElement;
				const entidadEl =
					card?.querySelector('.convocatoria__logo h3') || card?.querySelector('h3');
				const infoEls = card?.querySelectorAll('.convocatoria__info p');

				let fechaCierre = 'No especificada';
				let requisitosResumen = '';

				infoEls?.forEach((p) => {
					const text = p.innerText.trim();
					if (text.toLowerCase().includes('vigente hasta')) {
						fechaCierre = text.replace(/vigente hasta:?/i, '').trim();
					} else if (!requisitosResumen && text.length > 20) {
						requisitosResumen = text;
					}
				});

				if (a.href) {
					items.push({
						titulo: a.innerText.trim(),
						urlDetalle: a.href,
						entidad: entidadEl?.innerText.trim() || 'Entidad del Estado',
						fechaCierre,
						requisitosResumen
					});
				}
			});

			return items;
		});

		console.log(`📋 Se encontraron ${listaConvocatorias.length} convocatorias vigentes.`);
		const seleccion = listaConvocatorias.slice(0, MAX_CONVOCATORIAS_A_EVALUAR);

		// Visitamos cada convocatoria para obtener las bases completas
		for (const item of seleccion) {
			console.log(`\n➡️ Analizando: ${item.titulo} (${item.entidad})`);

			let textoTdr = item.requisitosResumen;
			let enlaceBases = item.urlDetalle;

			try {
				const detallePage = await browser.newPage();
				await detallePage.setUserAgent(
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
				);

				await detallePage.goto(item.urlDetalle, { waitUntil: 'domcontentloaded', timeout: 30000 });

				const detalleInfo = await detallePage.evaluate(() => {
					const requisitosDiv = document.querySelector(
						'.requisitos, #requisitos + div, div[id*="requisitos"]'
					);
					const basesLink = document.querySelector(
						'.bases a, .bases-card a, a[href*="pdf"], a[href*="bases"]'
					);

					return {
						textoRequisitos: requisitosDiv?.innerText?.trim() || '',
						urlBases: basesLink?.href || ''
					};
				});

				await detallePage.close();

				if (detalleInfo.textoRequisitos && detalleInfo.textoRequisitos.length > textoTdr.length) {
					textoTdr = detalleInfo.textoRequisitos;
				}

				if (detalleInfo.urlBases) {
					enlaceBases = detalleInfo.urlBases;
					// Si el enlace a las bases es un PDF directo, intentamos extraer su texto completo
					if (enlaceBases.toLowerCase().endsWith('.pdf')) {
						const textoPdf = await extraerTextoPDF(enlaceBases);
						if (textoPdf && textoPdf.length > 100) {
							textoTdr = textoPdf.slice(0, 15000); // Límite seguro de caracteres para Gemini
						}
					}
				}
			} catch (err) {
				console.log(
					`  ⚠️ No se pudo cargar detalle completo: ${err.message}. Usando datos del listado.`
				);
			}

			if (!textoTdr || textoTdr.length < 15) {
				console.log(`  ⏩ Omitiendo: No se pudo obtener información de requisitos para evaluar.`);
				continue;
			}

			// Enviar al backend para evaluación con IA y guardado en Supabase
			try {
				console.log(`  🧠 Enviando a Gemini para evaluación de compatibilidad...`);
				const respuesta = await fetch(backendUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						titulo: item.titulo,
						entidad: item.entidad,
						fecha_cierre: item.fechaCierre,
						enlace_bases: enlaceBases,
						texto_tdr: textoTdr
					})
				});

				const resultado = await respuesta.json();
				if (resultado.success) {
					console.log(`  ✅ Oportunidad evaluada y guardada en Supabase.`);
				} else {
					console.log(`  ⚠️ El backend devolvió error:`, resultado.error);
				}
			} catch (err) {
				console.error(`  ❌ Error de conexión con el backend:`, err.message);
			}

			// Breve pausa para no saturar
			await new Promise((r) => setTimeout(r, 2000));
		}
	} catch (error) {
		console.error('❌ Error durante el scraping:', error.message);
	} finally {
		await browser.close();
		console.log('\n🏁 Proceso de scraping finalizado.');
	}
}

iniciarScraping();
