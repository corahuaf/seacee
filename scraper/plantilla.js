import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { PDFParse } from 'pdf-parse';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

// Permitir certificados SSL de entidades gubernamentales (.gob.pe) que no incluyen cadena intermedia completa
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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

const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const SYSTEM_INSTRUCTION = `Actúa como un evaluador experto en selección y contratación para el Estado Peruano (CAS, Locación de Servicios, Órdenes de Servicio en SEACE/SERVIR/IGN/IGP).
Evalúa los Términos de Referencia (TDR) o bases de la convocatoria frente al siguiente perfil profesional:
- Especialista en Sistemas de Información Geográfica (SIG), ArcGIS, QGIS, bases de datos espaciales (PostGIS).
- Desarrollador Frontend y Fullstack: Angular, TypeScript, Svelte, Node.js, Python.
- Experiencia en el sector público peruano (JNE, Ministerios, Gobiernos Regionales/Locales, IGN, IGP).

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

async function extraerTextoPDF(urlPdf) {
	let parser = null;
	try {
		console.log(`  📄 Descargando y leyendo PDF: ${urlPdf}`);
		const response = await fetch(urlPdf, {
			headers: { 'User-Agent': USER_AGENT }
		});

		if (!response.ok) throw new Error(`HTTP status: ${response.status}`);

		const contentType = (response.headers.get('content-type') || '').toLowerCase();
		if (
			!contentType.includes('pdf') &&
			!urlPdf.toLowerCase().endsWith('.pdf') &&
			!urlPdf.includes('Documento.aspx')
		) {
			return null;
		}

		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		parser = new PDFParse({ data: buffer });
		const data = await parser.getText();
		return data.text?.trim() || null;
	} catch (error) {
		console.log(`  ⚠️ No se pudo extraer PDF directo (${error.message}).`);
		return null;
	} finally {
		if (parser) {
			await parser.destroy();
		}
	}
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
				contents: `Evalúa los siguientes TDR o bases de convocatoria:\nPuesto/Servicio: ${datos.titulo}\nEntidad: ${datos.entidad}\nRequisitos/TDR:\n${datos.texto_tdr}`,
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

async function enviarOportunidad(payload, backendUrl) {
	let guardado = false;
	try {
		const respuesta = await fetch(backendUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const resultado = await respuesta.json();
		if (respuesta.ok && resultado.success) {
			console.log(`  ✅ Guardado vía API: ${resultado.message || 'OK'}`);
			guardado = true;
			return true;
		}
	} catch {
		// Fallback a guardado directo si está en local o falló conexión al endpoint
	}

	if (!guardado && process.env.GEMINI_API_KEY && process.env.PUBLIC_SUPABASE_URL) {
		try {
			const resDirecto = await evaluarYGuardarDirecto(payload);
			console.log(
				`  ✅ Evaluado y guardado en Supabase (${resDirecto.message || `Match: ${resDirecto.match}%`}).`
			);
			return true;
		} catch (directErr) {
			console.error(`  ❌ Error evaluando/guardando:`, directErr.message);
		}
	}
	return false;
}

// ============================================================================
// 1. SCRAPER: SEACE (https://prod6.seace.gob.pe/buscador-publico/contrataciones)
// ============================================================================
async function scrapearSEACE() {
	console.log('\n🌐 [1/4] Consultando SEACE (Buscador Público de Contrataciones <= 8 UIT)...');
	const oportunidades = [];
	const palabras = ['SIG', 'GEOGRAFICA', 'SISTEMAS'];

	for (const palabra of palabras) {
		try {
			const url = `https://prod6.seace.gob.pe/v1/s8uit-services/buscadorpublico/contrataciones/buscador?anio=2026&palabra_clave=${encodeURIComponent(palabra)}&orden=2&page=1&page_size=5`;
			const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
			if (!res.ok) continue;

			const json = await res.json();
			const lista = json.data || [];

			for (const item of lista) {
				if (item.nomEstadoContrato && item.nomEstadoContrato !== 'Vigente') continue;
				const desc = item.desObjetoContrato || '';
				// Filtrar que sea realmente de SIG, Sistemas, Software o Desarrollo (usando \bsig\b para no coincidir con "asignada")
				if (
					!/\bsig\b|geogr|sistema|software|programador|desarrollador|informátic|informatic|base de datos|catastro/i.test(
						desc
					)
				) {
					continue;
				}
				oportunidades.push({
					titulo: `${item.desContratacion}: ${desc.slice(0, 110)}`,
					entidad: item.nomEntidad || 'Entidad en SEACE',
					fecha_cierre: item.fecFinCotizacion || 'Vigente',
					enlace_bases: 'https://prod6.seace.gob.pe/buscador-publico/contrataciones',
					texto_tdr: `Contratación SEACE: ${item.desContratacion}\nTipo: ${item.nomObjetoContrato}\nEntidad: ${item.nomEntidad}\nInicio cotización: ${item.fecIniCotizacion}\nFin cotización: ${item.fecFinCotizacion}\nDescripción completa del requerimiento:\n${desc}`
				});
			}
		} catch (err) {
			console.log(`  ⚠️ Error en SEACE (${palabra}):`, err.message);
		}
	}
	console.log(`  📌 SEACE: ${oportunidades.length} contrataciones relevantes encontradas.`);
	return oportunidades.slice(0, 4);
}

// ============================================================================
// 2. SCRAPER: IGN - Instituto Geográfico Nacional (https://app8.ign.gob.pe/convocatoria/)
// ============================================================================
async function scrapearIGN(browser) {
	console.log('\n🗺️ [2/4] Consultando IGN (Instituto Geográfico Nacional)...');
	const page = await browser.newPage();
	const oportunidades = [];

	try {
		await page.setUserAgent(USER_AGENT);
		await page.goto('https://app8.ign.gob.pe/convocatoria/', {
			waitUntil: 'domcontentloaded',
			timeout: 30000
		});

		const filas = await page.evaluate(() => {
			const trs = [...document.querySelectorAll('table tr')];
			const items = [];
			for (const tr of trs) {
				const link = tr.querySelector('a');
				const text = tr.innerText.replace(/\s+/g, ' ').trim();
				// Tomar solo CONVOCATORIAS (no actas de resultados pasados)
				if (link && text.toUpperCase().startsWith('CONVOCATORIA')) {
					items.push({
						titulo: link.innerText.replace(/\s+/g, ' ').trim(),
						urlPdf: link.href
					});
				}
			}
			return items;
		});

		console.log(`  📌 IGN: ${filas.length} convocatorias encontradas.`);

		for (const fila of filas.slice(0, 2)) {
			const textoPdf = await extraerTextoPDF(fila.urlPdf);
			oportunidades.push({
				titulo: fila.titulo,
				entidad: 'Instituto Geográfico Nacional (IGN)',
				fecha_cierre: 'Según cronograma en bases',
				enlace_bases: fila.urlPdf,
				texto_tdr: textoPdf
					? textoPdf.slice(0, 15000)
					: `Convocatoria IGN: ${fila.titulo}. Revisar PDF adjunto en ${fila.urlPdf}`
			});
		}
	} catch (err) {
		console.log(`  ⚠️ Error en IGN:`, err.message);
	} finally {
		await page.close();
	}

	return oportunidades;
}

// ============================================================================
// 3. SCRAPER: IGP - Instituto Geofísico del Perú (https://www.igp.gob.pe/convocatorias/)
// ============================================================================
async function scrapearIGP() {
	console.log('\n🌋 [3/4] Consultando IGP (Instituto Geofísico del Perú)...');
	const oportunidades = [];

	try {
		const res = await fetch('https://www.igp.gob.pe/api/convocatorias/v1/convocatorias', {
			headers: { 'User-Agent': USER_AGENT }
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);

		const data = await res.json();
		const lista = data.convocatoria || [];

		// Filtrar vigentes o recientes relacionadas a Sistemas, Geoespacio, TI o Ingeniería
		const vigentes = lista.filter(
			(c) =>
				c.estadoConvocatoria === 'Vigente' &&
				/sistema|geoespacio|geof|comput|informátic|informatic|datos|software|electr|ingenier/i.test(
					`${c.descripcion} ${c.formacionAcademica} ${c.dependencia}`
				)
		);

		console.log(`  📌 IGP: ${vigentes.length} convocatorias vigentes afines encontradas.`);

		for (const c of vigentes.slice(0, 2)) {
			const urlBases = c.pdfViewer
				? `https://www.igp.gob.pe/convocatorias${c.pdfViewer}`
				: 'https://www.igp.gob.pe/convocatorias/';

			oportunidades.push({
				titulo: `${c.nombre}: ${(c.descripcion || '').replace(/\s+/g, ' ').trim()}`,
				entidad: `Instituto Geofísico del Perú (IGP) - ${c.dependencia || ''}`,
				fecha_cierre: c.fechaFinConvocatoria || 'Vigente',
				enlace_bases: urlBases,
				texto_tdr: `Convocatoria: ${c.nombre}\nModalidad: ${c.tipoContrato}\nDependencia: ${c.dependencia}\nSede: ${c.sede}\nSubvención/Remuneración: S/ ${c.subvencion} (${c.subvencionText})\nDescripción: ${c.descripcion}\nFormación Académica y Requisitos: ${c.formacionAcademica}`
			});
		}
	} catch (err) {
		console.log(`  ⚠️ Error en IGP:`, err.message);
	}

	return oportunidades;
}

// ============================================================================
// 4. SCRAPER: SERVIR Talento Perú (https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml)
// ============================================================================
async function scrapearSERVIR(browser) {
	console.log('\n🏛️ [4/4] Consultando SERVIR - Talento Perú...');
	const page = await browser.newPage();
	const oportunidades = [];

	try {
		await page.setUserAgent(USER_AGENT);
		await page.goto(
			'https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml',
			{ waitUntil: 'networkidle2', timeout: 35000 }
		);

		// Buscar por puesto "SISTEMAS"
		await page.type('[id="frmLstOfertsLabo:txtPuesto"]', 'SISTEMAS');
		await page.click('[id="frmLstOfertsLabo:j_idt46"]');
		await new Promise((r) => setTimeout(r, 4000));

		const cuadros = await page.evaluate(() => {
			const items = [];
			const vacantes = document.querySelectorAll('.cuadro-vacantes');
			vacantes.forEach((box) => {
				const texto = box.innerText.replace(/\s+/g, ' ').trim();
				const lineas = box.innerText
					.split('\n')
					.map((l) => l.trim())
					.filter(Boolean);
				const titulo = lineas[0] || 'Convocatoria SERVIR';
				const entidad = lineas[1] || 'Entidad del Estado';
				const matchFecha = texto.match(/Fecha Fin de Publicación:\s*([0-9/]+)/i);
				const matchRemun = texto.match(/Remuneración:\s*([^F]+)/i);

				items.push({
					titulo,
					entidad,
					fecha_cierre: matchFecha ? matchFecha[1] : 'Vigente',
					remuneracion: matchRemun ? matchRemun[1].trim() : '',
					resumen: texto
				});
			});
			return items;
		});

		console.log(`  📌 SERVIR: ${cuadros.length} ofertas encontradas en la primera vista.`);

		for (const item of cuadros.slice(0, 2)) {
			oportunidades.push({
				titulo: item.titulo,
				entidad: item.entidad,
				fecha_cierre: item.fecha_cierre,
				enlace_bases:
					'https://app.servir.gob.pe/DifusionOfertasExterno/faces/consultas/ofertas_laborales.xhtml',
				texto_tdr: `Oferta Laboral SERVIR Talento Perú:\nPuesto: ${item.titulo}\nEntidad: ${item.entidad}\nDetalle:\n${item.resumen}`
			});
		}
	} catch (err) {
		console.log(`  ⚠️ Error en SERVIR:`, err.message);
	} finally {
		await page.close();
	}

	return oportunidades;
}

// ============================================================================
// ORQUESTADOR PRINCIPAL
// ============================================================================
async function iniciarScrapingMultiPortal() {
	console.log('🚀 Iniciando Scraper Multi-Portal (SEACE + IGN + IGP + SERVIR)...');
	const backendUrl = normalizarEndpointUrl(process.env.ENDPOINT_URL);
	console.log(`📡 Endpoint configurado: ${backendUrl}`);

	const launchOptions = {
		headless: true,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--ignore-certificate-errors',
			'--disable-blink-features=AutomationControlled'
		]
	};

	const macChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
	if (process.platform === 'darwin' && fs.existsSync(macChromePath)) {
		launchOptions.executablePath = macChromePath;
	}

	const browser = await puppeteer.launch(launchOptions);
	let totalProcesadas = 0;

	try {
		const [opSeace, opIgn, opIgp, opServir] = await Promise.all([
			scrapearSEACE(),
			scrapearIGN(browser),
			scrapearIGP(),
			scrapearSERVIR(browser)
		]);

		const todas = [...opIgn, ...opSeace, ...opIgp, ...opServir];
		console.log(`\n📦 Total de oportunidades recolectadas de los 4 portales: ${todas.length}`);

		for (const op of todas) {
			console.log(`\n➡️ Evaluando: ${op.titulo} (${op.entidad})`);
			const ok = await enviarOportunidad(op, backendUrl);
			if (ok) totalProcesadas++;
			await new Promise((r) => setTimeout(r, 1500));
		}
	} catch (error) {
		console.error('❌ Error general en el scraper:', error.message);
	} finally {
		await browser.close();
		console.log(`\n🏁 Scraping Multi-Portal finalizado. Procesadas con éxito: ${totalProcesadas}`);
	}
}

iniciarScrapingMultiPortal();
