import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const themeScript = fs.readFileSync(
	fileURLToPath(new URL('../../../static/static/refyne-theme.js', import.meta.url)),
	'utf8'
);
const themeCss = fs.readFileSync(
	fileURLToPath(new URL('../../../static/static/refyne-theme.css', import.meta.url)),
	'utf8'
);

// --refyne-background as the bundled CSS resolves it per appearance (used by the meta mock).
const resolvedBackground = (classes: Set<string>): string => {
	if (classes.has('oled-dark')) return '#000000';
	if (classes.has('her')) return '#983724';
	return classes.has('dark') ? '#18111b' : '#eee9ff';
};

interface ThemeHarness {
	classes: Set<string>;
	inlineStyles: Map<string, string>;
	metaContent: string;
	mediaDark: boolean;
	storage: Map<string, string>;
	styleCalls: string[];
	apply: (preference?: string) => void;
	emitMediaChange: () => void;
	setStoredTheme: (value: string | null) => void;
}

/** Evaluates the real static script in a vm context with the minimal DOM/media/storage surface it touches. */
function loadThemeScript({
	theme = null,
	mediaDark = true
}: { theme?: string | null; mediaDark?: boolean } = {}): ThemeHarness {
	const classes = new Set<string>();
	const inlineStyles = new Map<string, string>();
	const styleCalls: string[] = [];
	const storage = new Map<string, string>();
	if (theme !== null) storage.set('theme', theme);

	const mediaListeners: Array<() => void> = [];
	const harness: ThemeHarness = {
		classes,
		inlineStyles,
		metaContent: '',
		mediaDark,
		storage,
		styleCalls,
		apply: () => {},
		emitMediaChange: () => mediaListeners.forEach((listener) => listener()),
		setStoredTheme: (value) => {
			if (value === null) storage.delete('theme');
			else storage.set('theme', value);
		}
	};

	const root = {
		classList: {
			add: (...names: string[]) => names.forEach((name) => classes.add(name)),
			remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
			contains: (name: string) => classes.has(name)
		},
		style: {
			removeProperty: (name: string) => {
				styleCalls.push(name);
				inlineStyles.delete(name);
			}
		}
	};

	const meta = {
		setAttribute: (name: string, value: string) => {
			if (name === 'content') harness.metaContent = value;
		}
	};

	const windowMock = {
		matchMedia: (_query: string) => ({
			get matches() {
				return harness.mediaDark;
			},
			addEventListener: (_type: string, listener: () => void) => mediaListeners.push(listener)
		}),
		applyRefyneTheme: undefined as unknown
	};

	const context = vm.createContext({
		window: windowMock,
		document: {
			documentElement: root,
			querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? meta : null)
		},
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value)
		},
		getComputedStyle: () => ({
			getPropertyValue: (property: string) =>
				property === '--refyne-background' ? resolvedBackground(classes) : ''
		})
	});
	vm.runInContext(themeScript, context);

	harness.apply = (preference?: string) => {
		const apply = windowMock.applyRefyneTheme as (preference?: string) => void;
		apply(preference);
	};
	return harness;
}

describe('refyne-theme.js first paint', () => {
	it('paints explicit light even when the system is dark', () => {
		const h = loadThemeScript({ theme: 'light', mediaDark: true });
		expect(h.classes.has('light')).toBe(true);
		expect(h.classes.has('dark')).toBe(false);
	});

	it('paints explicit dark even when the system is light', () => {
		const h = loadThemeScript({ theme: 'dark', mediaDark: false });
		expect(h.classes.has('dark')).toBe(true);
		expect(h.classes.has('light')).toBe(false);
	});

	it('defaults to system when localStorage.theme is absent (dark media)', () => {
		const h = loadThemeScript({ theme: null, mediaDark: true });
		expect(h.classes.has('dark')).toBe(true);
		expect(h.storage.get('theme')).toBe('system');
	});

	it('defaults to system when localStorage.theme is absent (light media)', () => {
		const h = loadThemeScript({ theme: null, mediaDark: false });
		expect(h.classes.has('light')).toBe(true);
	});

	it('treats explicit "system" like the absent default', () => {
		expect(loadThemeScript({ theme: 'system', mediaDark: true }).classes.has('dark')).toBe(true);
		expect(loadThemeScript({ theme: 'system', mediaDark: false }).classes.has('light')).toBe(true);
	});
});

describe('refyne-theme.js live system-appearance changes', () => {
	it('re-applies the theme on media changes while in system mode', () => {
		const h = loadThemeScript({ theme: null, mediaDark: false });
		expect(h.classes.has('light')).toBe(true);

		h.mediaDark = true;
		h.emitMediaChange();
		expect(h.classes.has('dark')).toBe(true);
		expect(h.classes.has('light')).toBe(false);

		h.mediaDark = false;
		h.emitMediaChange();
		expect(h.classes.has('light')).toBe(true);
		expect(h.classes.has('dark')).toBe(false);
	});

	it('ignores media changes when an explicit mode is stored', () => {
		const h = loadThemeScript({ theme: 'light', mediaDark: false });
		h.mediaDark = true;
		h.emitMediaChange();
		expect(h.classes.has('light')).toBe(true);
		expect(h.classes.has('dark')).toBe(false);

		const explicitDark = loadThemeScript({ theme: 'oled-dark', mediaDark: true });
		explicitDark.mediaDark = false;
		explicitDark.emitMediaChange();
		expect(explicitDark.classes.has('oled-dark')).toBe(true);
		expect(explicitDark.classes.has('dark')).toBe(true);
	});
});

describe('refyne-theme.js class and inline-style cleanup', () => {
	it('clears oled-dark when switching to dark', () => {
		const h = loadThemeScript({ theme: 'oled-dark' });
		expect(h.classes.has('oled-dark')).toBe(true);
		h.apply('dark');
		expect(h.classes.has('oled-dark')).toBe(false);
		expect(h.classes.has('dark')).toBe(true);
	});

	it('clears oled-dark when switching to light', () => {
		const h = loadThemeScript({ theme: 'oled-dark' });
		h.apply('light');
		expect(h.classes.has('oled-dark')).toBe(false);
		expect(h.classes.has('light')).toBe(true);
	});

	it('removes stale inline gray overrides on every apply', () => {
		const h = loadThemeScript({ theme: 'dark' });
		for (const shade of [800, 850, 900, 950]) {
			h.inlineStyles.set(`--color-gray-${shade}`, '#123456');
		}
		h.apply('light');
		for (const shade of [800, 850, 900, 950]) {
			expect(h.inlineStyles.has(`--color-gray-${shade}`)).toBe(false);
			expect(h.styleCalls).toContain(`--color-gray-${shade}`);
		}
	});

	it('clears her when switching to a normal mode', () => {
		// 'her' is a light-based appearance: the script paints the light base class plus 'her'.
		const h = loadThemeScript({ theme: 'her' });
		expect(h.classes.has('her')).toBe(true);
		expect(h.classes.has('light')).toBe(true);

		h.apply('dark');
		expect(h.classes.has('her')).toBe(false);
		expect(h.classes.has('dark')).toBe(true);

		h.apply('light');
		expect(h.classes.has('her')).toBe(false);
		expect(h.classes.has('light')).toBe(true);
	});
});

describe('refyne-theme.js meta theme-color', () => {
	it('follows --refyne-background resolved through getComputedStyle', () => {
		for (const [preference, expected] of [
			['dark', '#18111b'],
			['light', '#eee9ff'],
			['oled-dark', '#000000'],
			['her', '#983724']
		] as const) {
			const h = loadThemeScript({ theme: preference });
			expect(h.metaContent, preference).toBe(expected);
		}
	});

	it('updates the meta tag on live system changes', () => {
		const h = loadThemeScript({ theme: null, mediaDark: true });
		expect(h.metaContent).toBe('#18111b');
		h.mediaDark = false;
		h.emitMediaChange();
		expect(h.metaContent).toBe('#eee9ff');
	});
});

// -- CSS palette: canonical Hyprway roles, resolved from the bundled file only (no host config). --

type VarScope = Map<string, string>;

const parseScopes = (): { light: VarScope; dark: VarScope } => {
	const rootVars: VarScope = new Map();
	const darkVars: VarScope = new Map();
	const ast = postcss.parse(themeCss);
	ast.walkRules((rule) => {
		const target = rule.selector === ':root' ? rootVars : rule.selector === ':root.dark' ? darkVars : null;
		if (!target) return;
		rule.walkDecls((decl) => {
			if (decl.prop.startsWith('--')) target.set(decl.prop, decl.value.trim());
		});
	});
	return { light: rootVars, dark: darkVars };
};

const resolveVar = (scope: VarScope, fallback: VarScope, name: string): string => {
	const value = scope.get(name) ?? fallback.get(name);
	expect(value, `missing custom property ${name}`).toBeDefined();
	const ref = (value as string).match(/^var\((--[\w-]+)\)$/);
	return ref ? resolveVar(fallback, fallback, ref[1]) : (value as string).trim().toLowerCase();
};

describe('refyne-theme.css palette roles', () => {
	const { light, dark } = parseScopes();

	it('keeps the canonical dark Hyprway roles', () => {
		const roles: Array<[string, string]> = [
			['--refyne-background', '#18111b'],
			['--refyne-panel', '#1d1522'],
			['--refyne-text', '#d8d0ea'],
			['--refyne-text-muted', '#9d92b0'],
			['--refyne-border', '#2a1d31'],
			['--refyne-focus', '#c79eff'],
			['--refyne-accent', '#ff91c3']
		];
		for (const [name, expected] of roles) {
			expect(resolveVar(dark, light, name), name).toBe(expected);
		}
	});

	it('keeps the canonical light Hyprway roles', () => {
		const roles: Array<[string, string]> = [
			['--refyne-background', '#eee9ff'],
			['--refyne-panel', '#e0caf6'],
			['--refyne-text', '#1f1221'],
			['--refyne-text-muted', '#2a1d31'],
			['--refyne-border', '#7740aa'],
			['--refyne-focus', '#7740aa'],
			['--refyne-accent', '#a62d68']
		];
		for (const [name, expected] of roles) {
			expect(resolveVar(light, light, name), name).toBe(expected);
		}
	});
});
