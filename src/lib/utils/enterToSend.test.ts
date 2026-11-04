import { describe, expect, it } from 'vitest';
import { shouldEnterSubmit, type EnterSubmitState } from './enterToSend';

const base: EnterSubmitState = {
	isEnterKey: true,
	isComposing: false,
	shiftKey: false,
	ctrlOrMetaKey: false,
	mobile: false,
	touchCapable: false,
	ctrlEnterToSend: false,
	enterToSendMobile: false
};

const enter = (overrides: Partial<EnterSubmitState> = {}) =>
	shouldEnterSubmit({ ...base, ...overrides });

describe('shouldEnterSubmit', () => {
	describe('desktop (non-touch)', () => {
		it('sends on plain Enter by default', () => {
			expect(enter()).toBe(true);
		});

		it('keeps Shift+Enter as a newline (no send)', () => {
			expect(enter({ shiftKey: true })).toBe(false);
		});

		it('still sends on Ctrl/Cmd+Enter in the default mode', () => {
			expect(enter({ ctrlOrMetaKey: true })).toBe(true);
		});

		it('requires Ctrl/Cmd+Enter when ctrlEnterToSend is enabled', () => {
			expect(enter({ ctrlEnterToSend: true })).toBe(false);
			expect(enter({ ctrlEnterToSend: true, ctrlOrMetaKey: true })).toBe(true);
		});

		it('does not send on Shift+Ctrl/Cmd+Enter in ctrlEnterToSend mode', () => {
			expect(enter({ ctrlEnterToSend: true, ctrlOrMetaKey: true, shiftKey: true })).toBe(false);
		});

		it('sends on Enter even on a touch-capable device when not in mobile layout', () => {
			expect(enter({ touchCapable: true })).toBe(true);
		});
	});

	describe('IME protection', () => {
		it('never sends while composing', () => {
			expect(enter({ isComposing: true })).toBe(false);
		});

		it('never sends while composing even with enterToSendMobile enabled', () => {
			expect(
				enter({ mobile: true, touchCapable: true, enterToSendMobile: true, isComposing: true })
			).toBe(false);
		});

		it('ignores non-Enter keys', () => {
			expect(enter({ isEnterKey: false })).toBe(false);
		});
	});

	describe('mobile (touch) default stays upstream behavior', () => {
		it('does not send on Enter by default on a touch device', () => {
			expect(enter({ mobile: true, touchCapable: true })).toBe(false);
		});

		it('does not send on Ctrl+Enter by default on a touch device', () => {
			expect(enter({ mobile: true, touchCapable: true, ctrlOrMetaKey: true })).toBe(false);
		});

		it('still does not send when the setting is explicitly absent (undefined -> false)', () => {
			expect(enter({ mobile: true, touchCapable: true, enterToSendMobile: false })).toBe(false);
		});

		it('sends on mobile layout when the device has no touch capability', () => {
			// Narrow desktop window: keep desktop Enter behavior.
			expect(enter({ mobile: true, touchCapable: false })).toBe(true);
		});
	});

	describe('enterToSendMobile opt-in', () => {
		it('sends on Enter when enabled on a touch device', () => {
			expect(enter({ mobile: true, touchCapable: true, enterToSendMobile: true })).toBe(true);
		});

		it('keeps Shift+Enter as a newline when enabled', () => {
			expect(enter({ mobile: true, touchCapable: true, enterToSendMobile: true, shiftKey: true })).toBe(
				false
			);
		});

		it('honors ctrlEnterToSend when enabled on a touch device', () => {
			expect(
				enter({ mobile: true, touchCapable: true, enterToSendMobile: true, ctrlEnterToSend: true })
			).toBe(false);
			expect(
				enter({
					mobile: true,
					touchCapable: true,
					enterToSendMobile: true,
					ctrlEnterToSend: true,
					ctrlOrMetaKey: true
				})
			).toBe(true);
		});
	});
});