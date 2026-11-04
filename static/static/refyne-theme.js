// Shared by the first paint, Settings, and live system-appearance changes.
(() => {
	const root = document.documentElement;
	const systemAppearance = window.matchMedia('(prefers-color-scheme: dark)');
	if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'system');

	window.applyRefyneTheme = (preference = localStorage.getItem('theme') || 'system') => {
		const dark = preference === 'system' ? systemAppearance.matches : !['light', 'her'].includes(preference);
		root.classList.remove('light', 'dark', 'oled-dark', 'her');
		root.classList.add(dark ? 'dark' : 'light');
		if (preference === 'oled-dark' || preference === 'her') root.classList.add(preference);

		// Older versions wrote these inline and masked the user's palette after switching themes.
		for (const shade of [800, 850, 900, 950]) {
			root.style.removeProperty(`--color-gray-${shade}`);
		}

		const background = getComputedStyle(root).getPropertyValue('--refyne-background').trim();
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
	};

	window.applyRefyneTheme();
	systemAppearance.addEventListener('change', () => {
		if ((localStorage.getItem('theme') || 'system') === 'system') window.applyRefyneTheme();
	});
})();
