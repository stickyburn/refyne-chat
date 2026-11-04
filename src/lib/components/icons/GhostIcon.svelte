<script lang="ts">
export let className = 'size-4';
export let strokeWidth = '1.5';
export let active = false;
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	fill="none"
	viewBox="0 0 24 24"
	stroke-width={strokeWidth}
	class={className}
>
	<path
		d="M12 3C7.5 3 4 6.5 4 11V18.5L6 17L8 19L10 17L12 19L14 17L16 19L18 17L20 18.5V11C20 6.5 16.5 3 12 3Z"
		stroke={active ? 'var(--color-accent)' : 'currentColor'}
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-dasharray="2 3"
		fill="none"
	/>
	<circle
		cx="9"
		cy="10"
		r="1.5"
		fill={active ? 'var(--color-accent)' : 'none'}
		stroke={active ? 'var(--color-accent)' : 'currentColor'}
	/>
	<circle
		cx="15"
		cy="10"
		r="1.5"
		fill={active ? 'var(--color-accent)' : 'none'}
		stroke={active ? 'var(--color-accent)' : 'currentColor'}
	/>
</svg>