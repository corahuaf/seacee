<script>
	let { data } = $props();
	let oportunidades = $derived(data.oportunidades);
</script>

<div class="grid gap-6">
	{#each oportunidades as trabajo}
		<div
			class="rounded-xl border-l-4 bg-white p-5 shadow-sm
            {trabajo.porcentaje_compatibilidad >= 80 ? 'border-green-500' : 'border-amber-400'}"
		>
			<div class="flex items-start justify-between gap-4">
				<div>
					<h2 class="text-lg font-bold text-slate-800">{trabajo.titulo}</h2>
					<p class="text-sm font-medium text-slate-500">{trabajo.entidad}</p>
					<p class="mt-1 text-xs text-slate-400">Cierra: {trabajo.fecha_cierre}</p>
				</div>
				<div class="min-w-[80px] text-center">
					<span
						class="text-3xl font-black
                        {trabajo.porcentaje_compatibilidad >= 80
							? 'text-green-600'
							: 'text-amber-500'}"
					>
						{trabajo.porcentaje_compatibilidad}%
					</span>
					<p class="mt-1 text-[10px] tracking-wider text-slate-400 uppercase">Match</p>
				</div>
			</div>

			<div class="mt-4 rounded bg-slate-50 p-3 text-sm text-slate-700">
				<p><strong>Evaluación de IA:</strong> {trabajo.resumen_evaluacion}</p>
			</div>

			<div class="mt-4 flex flex-wrap gap-2">
				{#each trabajo.brechas_o_faltantes || [] as falta}
					<span class="rounded-full bg-red-100 px-2 py-1 text-xs text-red-700">Falta: {falta}</span>
				{/each}
			</div>

			<div class="mt-5 border-t pt-4">
				<a
					href={trabajo.enlace_bases}
					target="_blank"
					class="inline-block rounded bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
				>
					Ver Bases Completas
				</a>
			</div>
		</div>
	{:else}
		<div class="p-10 text-center text-slate-500">
			No se han scrapeado ni evaluado oportunidades recientes.
		</div>
	{/each}
</div>
