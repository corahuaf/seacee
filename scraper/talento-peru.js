import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { PDFParse } from 'pdf-parse';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

// Cargar variables de .env si existe localmente
if (fs.existsSync('.env')) {
	const envContent = fs.readFileSync('.env', 'utf-8');
	for (const line of envContent.split('\n')) {
		const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
		if (match) {
			const key = match[1];
			let val = (match[2] || '').trim().replace(/^["']|["']$/g, '');
			if (!process.env[key]) process.env[key] = val;
		}
	}
}

// URL oficial de la categoría de Ingeniería de Sistemas / Informática / Computación
const BUSQUEDA_URL =
	'https://www.convocatoriasdetrabajo.com/ofertas-de-empleo-para-INGENIEROS-DE-SISTEMAS-9.html';
const MAX_CONVOCATORIAS_A_EVALUAR = 5;

const PALABRAS_CLAVE_PRIORIDAD = [
	'sistema',
	'informática',
	'informatica',
	'software',
	'desarrollador',
	'programador',
	'sig',
	'gis',
	'geográfica',
	'geografica',
	'geomática',
	'base de datos',
	'datos',
	'seguridad de la información',
	'seguridad de la informacion',
	'redes',
	'web',
	'tecnologías de la información',
	'tecnologias de la informacion',
	'soc',
	'computación',
	'computacion',
	'digitador'
];

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

function normalizarEndpointUrl(rawUrl) {
	if (!rawUrl || !rawUrl.trim()) return 'http://localhost:5173/api/evaluar';
	let url = rawUrl
		.trim()
		.replace(/^["']|["']$/g, '')
		.replace(/\/+$/, '');
	if (!url.startsWith('http://') && !url.startsWith('https://')) {
		url = `https://${url}`;
	}
	if (!url.endsWith('/api/evaluar')) {
		url = `${url}/api/evaluar`;
	}
	return url;
}

async function evaluarYGuardarDirecto(datos) {
	const supaUrl = process.env.PUBLIC_SUPABASE_URL;
	const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const geminiKey = process.env.GEMINI_API_KEY;

	if (!supaUrl || !supaKey || !geminiKey) {
		throw new Error('No hay credenciales directas en el entorno para usar el modo de respaldo.');
	}

	const supabase = createClient(supaUrl, supaKey);
	const ai = new GoogleGenAI({ apiKey: geminiKey });

	// Verificar si ya existe para no duplicar
	const { data: existente } = await supabase
		.from('oportunidades')
		.select('id')
		.eq('titulo', datos.titulo)
		.eq('entidad', datos.entidad)
		.maybeSingle();

	if (existente) {
		return { success: true, message: 'Ya registrada previamente (omitida)' };
	}

	const MODELOS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
	let response = null;
	let lastErr = null;
	for (const model of MODELOS) {
		try {
			response = await ai.models.generateContent({
				model,
				contents: `Evalúa los siguientes TDR o bases de convocatoria:\nPuesto: ${datos.titulo}\nEntidad: ${datos.entidad}\nRequisitos:\n${datos.texto_tdr}`,
				config: {
					systemInstruction: SYSTEM_INSTRUCTION,
					responseMimeType: 'application/json',
					thinkingConfig: { thinkingBudget: 0 }
				}
			});
			break;
		} catch (e) {
			lastErr = e;
		}
	}
	if (!response) throw lastErr;

	const cleanedText = (response.text || '{}').replace(/```(?:json)?/gi, '').trim();
	const evaluacion = JSON.parse(cleanedText);

	const { error } = await supabase.from('oportunidades').insert({
		titulo: datos.titulo,
		entidad: datos.entidad,
		fecha_cierre: datos.fecha_cierre,
		enlace_bases: datos.enlace_bases,
		porcentaje_compatibilidad: Number(evaluacion.porcentaje_compatibilidad) || 0,
		cumple_perfil_minimo: Boolean(evaluacion.cumple_perfil_minimo),
		puntos_fuertes: Array.isArray(evaluacion.puntos_fuertes) ? evaluacion.puntos_fuertes : [],
		brechas_o_faltantes: Array.isArray(evaluacion.brechas_o_faltantes)
			? evaluacion.brechas_o_faltantes
			: [],
		resumen_evaluacion: evaluacion.resumen_evaluacion || ''
	});

	if (error) throw error;
	return { success: true, match: evaluacion.porcentaje_compatibilidad };
}

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
	const backendUrl = normalizarEndpointUrl(process.env.ENDPOINT_URL);
	console.log(`📡 Endpoint de evaluación configurado en: ${backendUrl}`);

	const launchOptions = {
		headless: true,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--disable-accelerated-2d-canvas',
			'--disable-gpu'
		]
	};

	// En macOS local, usar Google Chrome del sistema si existe
	const macChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
	if (process.platform === 'darwin' && fs.existsSync(macChromePath)) {
		launchOptions.executablePath = macChromePath;
	}

	const browser = await puppeteer.launch(launchOptions);
	let exitosos = 0;

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

		console.log(
			`📋 Se encontraron ${listaConvocatorias.length} convocatorias vigentes en la página.`
		);

		// Priorizar puestos cuyo título contenga palabras clave de TI / Sistemas / SIG
		const ordenadas = [...listaConvocatorias].sort((a, b) => {
			const tituloA = a.titulo.toLowerCase();
			const tituloB = b.titulo.toLowerCase();
			const matchA = PALABRAS_CLAVE_PRIORIDAD.some((k) => tituloA.includes(k)) ? 1 : 0;
			const matchB = PALABRAS_CLAVE_PRIORIDAD.some((k) => tituloB.includes(k)) ? 1 : 0;
			return matchB - matchA;
		});

		const seleccion = ordenadas.slice(0, MAX_CONVOCATORIAS_A_EVALUAR);

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
					if (enlaceBases.toLowerCase().endsWith('.pdf')) {
						const textoPdf = await extraerTextoPDF(enlaceBases);
						if (textoPdf && textoPdf.length > 100) {
							textoTdr = textoPdf.slice(0, 15000);
						}
					}
				}
			} catch (err) {
				console.log(
					`  ⚠️ No se pudo cargar detalle completo (${err.message}). Usando datos del listado.`
				);
			}

			if (!textoTdr || textoTdr.length < 15) {
				console.log(`  ⏩ Omitiendo: No se pudo obtener información de requisitos para evaluar.`);
				continue;
			}

			const payload = {
				titulo: item.titulo,
				entidad: item.entidad,
				fecha_cierre: item.fechaCierre,
				enlace_bases: enlaceBases,
				texto_tdr: textoTdr
			};

			// Intentar enviar al backend configurado (ENDPOINT_URL) y si falla usar respaldo directo
			let guardado = false;
			try {
				console.log(`  🧠 Evaluando con Gemini...`);
				const respuesta = await fetch(backendUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload)
				});

				const resultado = await respuesta.json();
				if (respuesta.ok && resultado.success) {
					console.log(`  ✅ Guardado vía API (${backendUrl}): ${resultado.message || 'OK'}`);
					guardado = true;
					exitosos++;
				} else {
					console.log(`  ⚠️ Respuesta de API con error:`, resultado.error || respuesta.status);
				}
			} catch (err) {
				console.log(`  ⚠️ No se pudo conectar a ${backendUrl} (${err.message}).`);
			}

			if (!guardado && process.env.GEMINI_API_KEY && process.env.PUBLIC_SUPABASE_URL) {
				try {
					const resDirecto = await evaluarYGuardarDirecto(payload);
					console.log(
						`  ✅ Evaluado y guardado directamente en Supabase (${resDirecto.message || `Match: ${resDirecto.match}%`}).`
					);
					exitosos++;
				} catch (directErr) {
					console.error(`  ❌ Error en guardado directo:`, directErr.message);
				}
			}

			await new Promise((r) => setTimeout(r, 1500));
		}
	} catch (error) {
		console.error('❌ Error durante el scraping:', error.message);
	} finally {
		await browser.close();
		console.log(`\n🏁 Proceso finalizado. Oportunidades procesadas con éxito: ${exitosos}`);
	}
}

iniciarScraping();
