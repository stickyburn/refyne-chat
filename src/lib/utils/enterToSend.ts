export interface EnterSubmitState {
	/** Whether the key event is an Enter press (`e.key === 'Enter' || e.keyCode === 13`). */
	isEnterKey: boolean;
	/** Whether an IME composition is active or just finished (e.g. `inOrNearComposition`). */
	isComposing: boolean;
	/** Whether Shift is held (Shift+Enter inserts a newline). */
	shiftKey: boolean;
	/** Whether Ctrl (or Cmd on macOS) is held. */
	ctrlOrMetaKey: boolean;
	/** Whether the UI is in the mobile layout (`$mobile`). */
	mobile: boolean;
	/** Whether the device reports touch capability (on-screen keyboard likely). */
	touchCapable: boolean;
	/** Setting: send only with Ctrl/Cmd+Enter instead of plain Enter. */
	ctrlEnterToSend: boolean;
	/** Setting: allow Enter to send on mobile. Off by default (upstream behavior). */
	enterToSendMobile: boolean;
}

/**
 * Shared composer decision: should this keydown submit the message?
 *
 * - IME composition must never submit (CJK keyboards confirm candidates with Enter).
 * - Shift+Enter never submits (newline).
 * - `ctrlEnterToSend` swaps the send trigger to Ctrl/Cmd+Enter.
 * - Touch devices do not submit on Enter unless the user opts in via
 *   `enterToSendMobile` (upstream default: the send button is the expected action).
 */
export const shouldEnterSubmit = (state: EnterSubmitState): boolean => {
	if (!state.isEnterKey || state.isComposing) {
		return false;
	}

	if (state.mobile && state.touchCapable && !state.enterToSendMobile) {
		return false;
	}

	if (state.shiftKey) {
		return false;
	}

	return state.ctrlEnterToSend ? state.ctrlOrMetaKey : true;
};

/** Whether the browser reports touch capability (used to detect on-screen keyboards). */
export const isTouchCapableDevice = (): boolean =>
	'ontouchstart' in window ||
	navigator.maxTouchPoints > 0 ||
	(navigator as Navigator & { msMaxTouchPoints?: number }).msMaxTouchPoints! > 0;