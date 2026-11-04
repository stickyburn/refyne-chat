<script lang="ts">
	import { settings } from '$lib/stores';
	export let id: string | undefined = undefined;
</script>

<div
	{id}
	dir={$settings?.chatDirection === 'RTL'
		? 'rtl'
		: $settings?.chatDirection === 'LTR'
			? 'ltr'
			: 'auto'}
	class="flex-1 flex flex-col relative w-full shadow-sm rounded-2xl border border-edge hover:border-focus/60 focus-within:border-focus transition bg-panel text-content"
>
	<slot />
</div>
