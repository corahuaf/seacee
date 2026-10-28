<script>
	import './layout.css'; // Archivo base de Tailwind
	let { children } = $props();
</script>

<div class="min-h-screen bg-slate-50">
	<nav class="bg-indigo-900 p-4 text-white shadow-md">
		<h1 class="text-xl font-bold tracking-wide">Mis Oportunidades - Estado Peruano</h1>
	</nav>
	<main class="mx-auto max-w-5xl p-6">
		{@render children()}
	</main>
</div>
